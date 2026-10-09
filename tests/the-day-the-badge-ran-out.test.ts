/**
 * The badge expired, and nothing told the customer.
 *
 * `sweepBadgeLifecycle` does two things fifteen lines apart: it suspends a badge
 * whose subscription lapsed, and it expires a badge that reached its date. The
 * suspension branch carries this comment about the defect it was written to
 * close — "A customer's mark came down on their own website — which the licence
 * obliges them to then remove — and the only way to find out was to open the
 * console and look." Every word of it applied to the branch above, which raised
 * nothing.
 *
 * Measured on 2026-10-09 against the database:
 *
 *   · twenty-five days out, one `badge_expiring` alert at severity `info` —
 *     and neither delivery channel carries `info`, both filtering to warning
 *     and critical, so it reaches only somebody who happens to log in;
 *   · three days out, a second at `warning`, which is delivered;
 *   · at expiry, the status changed and the alert count went from two to two.
 *
 * One delivered notice, inside the last week, and silence at the moment the
 * Badge Licence creates the obligation to take the mark down.
 *
 * The public surface was never wrong: `badge_effective_status` computes expiry
 * from `expires_at` on every read, so the verification page and the served mark
 * both say expired whether or not this sweep ever runs. What was missing was
 * telling the person who has to act.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { badgeExpiredAlert } from '../packages/monitoring/src/index.ts';
import { sweepBadgeLifecycle } from '../apps/worker/src/badge.ts';
import { sweepBadgeExpiryWarnings } from '../apps/worker/src/monitoring.ts';
import { findPendingEmails } from '../apps/worker/src/email.ts';
import { connect } from './setup/client.ts';
import { seedBadgedApp } from './setup/seed.ts';

let db: Client;
let pool: Pool;

beforeAll(async () => {
  db = await connect();
  const dsn = new URL(process.env.VIBEFYCODE_TEST_DSN!);
  pool = new Pool({
    host: dsn.searchParams.get('host')!,
    database: dsn.pathname.slice(1),
    user: 'postgres',
  });
});

afterAll(async () => {
  await pool?.end();
  await db?.end();
});

const badgeIdFor = async (slug: string) =>
  (await db.query<{ id: string }>(`select id from public.badges where slug = $1`, [slug])).rows[0]!
    .id;

const alertsFor = async (badgeId: string) =>
  (
    await db.query<{ kind: string; severity: string }>(
      `select kind::text as kind, severity::text as severity
         from public.alerts where badge_id = $1 order by created_at`,
      [badgeId],
    )
  ).rows;

/**
 * Expiry in the past, which the schema will not let you write directly.
 *
 * `badges_expiry_is_bounded` requires `expires_at > issued_at` and at most
 * twelve months between them, so the issue date moves with it. Worth saying
 * because the first version of this measurement set `expires_at` alone, the
 * update matched nothing, and every reading afterwards said "nothing happens" —
 * which is what a measurement that cannot fail always says.
 */
async function expireIt(badgeId: string): Promise<void> {
  await db.query(
    `update public.badges
        set issued_at = now() - interval '11 months', expires_at = now() - interval '1 hour'
      where id = $1`,
    [badgeId],
  );
}

describe('a badge that reached its date', () => {
  let badgeId: string;

  beforeAll(async () => {
    const seeded = await seedBadgedApp(db, 'ran-out');
    badgeId = await badgeIdFor(seeded.slug);
  });

  it('is told about once before, and that once is inside the last week', async () => {
    // The premise. Twenty-five days out raises an `info` alert, which the
    // delivery queries filter out — so nothing is pending for it.
    await db.query(
      `update public.badges set expires_at = now() + interval '25 days' where id = $1`,
      [badgeId],
    );
    await sweepBadgeExpiryWarnings(pool, () => undefined);
    const early = await alertsFor(badgeId);
    expect(early).toHaveLength(1);
    expect(early[0]!.severity).toBe('info');

    const client = await pool.connect();
    try {
      const pending = await findPendingEmails(client);
      expect(pending.map((row) => row.alert_id)).not.toContain(
        (
          await db.query<{ id: string }>(
            `select id from public.alerts where badge_id = $1 and severity = 'info'`,
            [badgeId],
          )
        ).rows[0]!.id,
      );
    } finally {
      client.release();
    }

    // Three days out raises the second, at `warning`, and that one is carried.
    await db.query(
      `update public.badges set expires_at = now() + interval '3 days' where id = $1`,
      [badgeId],
    );
    await sweepBadgeExpiryWarnings(pool, () => undefined);
    const late = await alertsFor(badgeId);
    expect(late).toHaveLength(2);
    expect(late[1]!.severity).toBe('warning');
  }, 60_000);

  it('is told on the day it happens, which it was not', async () => {
    await expireIt(badgeId);
    await sweepBadgeLifecycle(pool, () => undefined);
    // The badge's own status, not the sweep's count. `expired` counts every
    // badge the sweep moved, so another file's badge makes it two and another
    // file's sweep call makes it nought — which is decision 939's mistake, and
    // I made it again here before the full suite caught it.
    const status = await db.query<{ status: string }>(
      `select status::text as status from public.badges where id = $1`,
      [badgeId],
    );
    expect(status.rows[0]!.status).toBe('expired');

    const after = await alertsFor(badgeId);
    const expiry = after.filter((row) => row.kind === 'badge_expired');
    expect(expiry).toHaveLength(1);
    // Delivered, which `info` would not be — and not `critical`, because it was
    // warned about twice and a foreseeable date is not a crisis.
    expect(expiry[0]!.severity).toBe('warning');
  }, 60_000);

  it('says it once however often the sweep runs, because of the status transition', async () => {
    // Measured, and the wording matters. Mutating the dedupe key to something
    // unique per call left this green: the sweep's own `where status = 'active'`
    // means a badge is seen exactly once, on the way out of active, so the key
    // is not what makes this true. Saying "because the key is stable" here
    // would have been an assertion about something this test cannot see.
    await sweepBadgeLifecycle(pool, () => undefined);
    await sweepBadgeLifecycle(pool, () => undefined);
    const after = await alertsFor(badgeId);
    expect(after.filter((row) => row.kind === 'badge_expired')).toHaveLength(1);
  }, 60_000);

  it('has a dedupe key that would hold on its own', async () => {
    // The key tested directly, since the sweep cannot exercise it. It is what
    // holds if a badge's status is ever set back to active, or if a second
    // caller is added — and `alerts_dedupe_idx` is unique per organisation and
    // key, so a stable key is the whole mechanism.
    const draft = badgeExpiredAlert('Kettle', randomUUID(), badgeId, new Date());
    const again = badgeExpiredAlert('Kettle', randomUUID(), badgeId, new Date(Date.now() + 86_400));
    expect(draft.dedupeKey).toBe(again.dedupeKey);
    expect(draft.dedupeKey).toContain(badgeId);
  });

  it('tells them to take the mark down, and what renewal costs them', async () => {
    const { rows } = await db.query<{ title: string; body: string }>(
      `select title, body from public.alerts where badge_id = $1 and kind = 'badge_expired'`,
      [badgeId],
    );
    expect(rows[0]!.title).toMatch(/expired on /i);
    expect(rows[0]!.body).toMatch(/remove the badge from your site/i);
    expect(rows[0]!.body).toMatch(/licence requires it/i);
    // The thing a customer most needs to know and would otherwise assume the
    // other way: renewal is a new measurement, not the old score carried over.
    expect(rows[0]!.body).toMatch(/not carried over/i);
  }, 60_000);
});

describe('what it does not say', () => {
  it('does not call an expiry a suspension', async () => {
    // A suspension is something we did because the facts changed; an expiry is
    // a date arriving, and the remedies differ. `monitoring_blocked` exists for
    // exactly this reason: a notice that says the wrong thing is worse than no
    // notice at all.
    const seeded = await seedBadgedApp(db, 'ran-out-kind');
    const badgeId = await badgeIdFor(seeded.slug);
    await expireIt(badgeId);
    await sweepBadgeLifecycle(pool, () => undefined);
    const kinds = (await alertsFor(badgeId)).map((row) => row.kind);
    expect(kinds).toContain('badge_expired');
    expect(kinds).not.toContain('badge_suspended');
  }, 60_000);

  it('says nothing about a badge that is still current', async () => {
    const seeded = await seedBadgedApp(db, 'ran-out-current');
    const badgeId = await badgeIdFor(seeded.slug);
    await sweepBadgeLifecycle(pool, () => undefined);
    expect((await alertsFor(badgeId)).filter((row) => row.kind === 'badge_expired')).toHaveLength(
      0,
    );
  }, 60_000);
});
