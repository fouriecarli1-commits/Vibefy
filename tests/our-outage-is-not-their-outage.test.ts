/**
 * Every application failing at once is not every application failing.
 *
 * `packages/monitoring/src/liveness.ts` is careful about one application at a
 * time, and says why in its first paragraph: a badge on a dead site is the
 * worst artefact this system can produce, and taking a working customer's badge
 * down over a blip is its own kind of harm. So a suspension needs a run of
 * consecutive failures, and a refusal — a check we declined to make — never
 * counts as an outage.
 *
 * None of that can see the case that matters most, because `applyProbe` is
 * handed one row at a time. The worker loses outbound HTTPS — a broken egress
 * proxy, a dead resolver, a certificate bundle — and every probe comes back
 * `{ status: null, error: 'fetch failed' }`, which classifies as `down`. Every
 * sweep advances every counter, and six sweeps later every monitored customer's
 * badge is suspended within minutes of the others, each with an alert and an
 * email saying their application stopped responding. It had not. The system
 * accuses all of its customers of an outage that is ours.
 *
 * Two layers, because each covers the other's blind spot:
 *
 *   · **A control.** One probe to an address of ours, through the same guard,
 *     dispatcher and fetch, before any customer's. If that fails, the sweep
 *     could not reach anything. This is the only layer that works on a
 *     deployment with one monitored application.
 *   · **A floor.** Three or more applications, all failing in the same sweep,
 *     is far more likely to be us. This is the layer that works when the
 *     control host happens to be reachable and the wider internet is not — a
 *     proxy allowlist, a partial route.
 *
 * An inconclusive sweep writes nothing at all: no counter, no status, no
 * suspension, no alert. The rows stay due, so the next sweep re-checks them.
 * The only record is a log line, which is the honest place for it — every
 * customer-facing surface would be a false accusation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { sweepLiveness } from '../apps/worker/src/monitoring.ts';
import { SHARED_CAUSE_MINIMUM, sharedCause } from '../packages/monitoring/src/index.ts';
import { connect } from './setup/client.ts';
import {
  acceptBadgeLicence,
  approveAssessment,
  issueBadge,
  makeReviewer,
  seedAccount,
  seedApp,
  seedAssessment,
  seedAuthorisation,
  type SeededAccount,
} from './setup/seed.ts';

describe('what a whole sweep saw', () => {
  const down = Array<'up' | 'down' | 'refused'>(SHARED_CAUSE_MINIMUM).fill('down');

  it('is ours when the control could not be reached either', () => {
    expect(sharedCause({ control: 'down', outcomes: ['down'] })).toMatch(/control address/i);
    // Even with one application, which is the case no count can catch.
    expect(sharedCause({ control: 'down', outcomes: [] })).not.toBeNull();
  });

  it('is ours when everything failed together and there was enough of it', () => {
    expect(sharedCause({ control: 'up', outcomes: down })).toMatch(/all 3 applications/i);
  });

  it('is theirs when one of them answered', () => {
    expect(sharedCause({ control: 'up', outcomes: ['down', 'down', 'up'] })).toBeNull();
  });

  it('is theirs when there are too few to tell', () => {
    // Two applications both down is an ordinary coincidence, and treating it as
    // ours would be a way of never suspending a badge on a small deployment.
    expect(sharedCause({ control: 'up', outcomes: ['down', 'down'] })).toBeNull();
    expect(sharedCause({ control: null, outcomes: ['down'] })).toBeNull();
  });

  it('does not count a refusal towards it, in either direction', () => {
    // A refusal is already not an outage. Three of them are not an outage of
    // ours either — they are three customers whose origin now points somewhere
    // the authorisation does not cover, and each of them is told so.
    expect(sharedCause({ control: 'up', outcomes: ['refused', 'refused', 'refused'] })).toBeNull();
    expect(sharedCause({ control: 'refused', outcomes: down })).toMatch(/all 3/i);
  });

  it('says why, rather than saying inconclusive', () => {
    const reason = sharedCause({ control: 'down', outcomes: down });
    // It goes into a log line somebody reads at two in the morning, and
    // "inconclusive" alone would send them to look at the customers' sites.
    expect(reason).toMatch(/No counter was advanced and no badge was suspended/);
  });
});

// ---------------------------------------------------------------------------
// The sweep itself, against the database
// ---------------------------------------------------------------------------

interface Workspace {
  readonly owner: SeededAccount;
  readonly appId: string;
}

let db: Client;
let pool: Pool;

async function liveBadgeFor(label: string): Promise<Workspace & { badgeId: string }> {
  const owner = await seedAccount(db, label);
  const appId = await seedApp(db, owner, 'Kettle');
  await seedAuthorisation(db, owner, appId);
  const { assessmentId } = await seedAssessment(db, owner, { appId, depth: 'continuous' });
  // Through the helper, because the status machine insists on `awaiting_review`
  // first and a test that writes `approved` straight in is a test that proves a
  // badge can exist without a review having happened.
  await approveAssessment(db, owner, assessmentId, reviewerId, {
    certificationEligible: true,
    score: 80,
  });
  const consentId = await acceptBadgeLicence(db, owner);
  const badgeId = await issueBadge(db, owner, { appId, assessmentId, consentId });
  await db.query(
    `insert into public.subscriptions (organisation_id, plan, status, current_period_start, current_period_end)
     values ($1, 'certified', 'active', now(), now() + interval '30 days')`,
    [owner.organisationId],
  );
  return { owner, appId, badgeId };
}

let reviewerId: string;

beforeAll(async () => {
  db = await connect();
  const reviewer = await seedAccount(db, 'shared-cause-reviewer');
  await makeReviewer(db, reviewer.userId);
  reviewerId = reviewer.userId;
  // Built the way `tests/monitoring.test.ts` builds it: the test DSN names a
  // socket directory and no user, so a connection string alone arrives with no
  // user name in the startup packet.
  const dsn = new URL(process.env.VIBEFYCODE_TEST_DSN!);
  pool = new Pool({
    host: dsn.searchParams.get('host')!,
    database: dsn.pathname.slice(1),
    user: 'postgres',
  });
}, 60_000);

afterAll(async () => {
  await pool?.end();
  await db?.end();
});

/** Points the sweep at exactly these applications. */
async function onlyMonitor(appIds: readonly string[]): Promise<void> {
  await db.query('update public.apps set monitoring_enabled = (id = any($1::uuid[]))', [appIds]);
}

const unreachable = async () => ({ status: null, error: 'fetch failed' });

describe('a sweep that could not reach anything', () => {
  it('suspends nobody and advances no counter, with one application and a control', async () => {
    const one = await liveBadgeFor('shared-cause-one');
    await onlyMonitor([one.appId]);

    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const result = await sweepLiveness(
        pool,
        unreachable,
        undefined,
        new Date(`2026-09-0${attempt}T00:00:00Z`),
        50,
        'https://vibefycode.com',
      );
      expect(result.inconclusive, `sweep ${attempt}`).toMatch(/control address/i);
      expect(result.suspended).toBe(0);
    }

    const after = await db.query<{ status: string; failures: number }>(
      `select b.status::text as status, app.consecutive_liveness_failures as failures
         from public.badges b join public.apps app on app.id = b.app_id where b.id = $1`,
      [one.badgeId],
    );
    expect(after.rows[0]!.status).toBe('active');
    // Not merely "not suspended": the counter was not advanced either, so the
    // first genuine failure after the outage starts from zero rather than from
    // eight sweeps of our own making.
    expect(Number(after.rows[0]!.failures)).toBe(0);
  }, 60_000);

  it('suspends nobody when three fail together and no control was configured', async () => {
    const spaces = [
      await liveBadgeFor('shared-cause-a'),
      await liveBadgeFor('shared-cause-b'),
      await liveBadgeFor('shared-cause-c'),
    ];
    await onlyMonitor(spaces.map((space) => space.appId));

    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const result = await sweepLiveness(
        pool,
        unreachable,
        undefined,
        new Date(`2026-09-1${attempt % 10}T00:00:00Z`),
      );
      expect(result.inconclusive, `sweep ${attempt}`).toMatch(/all 3 applications/i);
    }

    const { rows } = await db.query<{ status: string }>(
      `select status::text as status from public.badges where id = any($1::uuid[])`,
      [spaces.map((space) => space.badgeId)],
    );
    expect(rows.map((row) => row.status)).toEqual(['active', 'active', 'active']);

    // And nobody was told their application was down.
    const alerts = await db.query<{ n: number }>(
      `select count(*)::int as n from public.alerts
        where organisation_id = any($1::uuid[]) and kind::text in ('app_unreachable', 'badge_suspended')`,
      [spaces.map((space) => space.owner.organisationId)],
    );
    expect(alerts.rows[0]!.n).toBe(0);
  }, 90_000);
});

describe('a sweep that could reach the control', () => {
  it('still suspends the one application that is genuinely down', async () => {
    const theirs = await liveBadgeFor('shared-cause-genuine');
    await onlyMonitor([theirs.appId]);

    // The control answers; their origin does not. That is evidence about them.
    const probe = async (url: string) =>
      url.includes('vibefycode.com') ? { status: 200 } : { status: null, error: 'fetch failed' };

    let suspended = 0;
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const result = await sweepLiveness(
        pool,
        probe,
        undefined,
        new Date(`2026-09-2${attempt % 10}T00:00:00Z`),
        50,
        'https://vibefycode.com',
      );
      expect(result.inconclusive).toBeNull();
      suspended += result.suspended;
    }
    expect(suspended).toBe(1);

    const after = await db.query<{ status: string; reason: string }>(
      'select status::text as status, suspension_reason as reason from public.badges where id = $1',
      [theirs.badgeId],
    );
    expect(after.rows[0]!.status).toBe('suspended');
    expect(after.rows[0]!.reason).toMatch(/did not respond to \d+ consecutive checks/);
  }, 90_000);
});
