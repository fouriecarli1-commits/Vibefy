/**
 * The authorisation was withdrawn and the mark stayed up.
 *
 * Issuance asks `app_is_authorised_for_testing` on the *application* rather than
 * on the assessment, and the comment beside that line says exactly why: "a badge
 * must not issue for an application whose authorisation has since been
 * withdrawn." Nothing asked the question again afterwards.
 *
 * Measured on 2026-10-22 against the database. With a live badge on an
 * authorised application, inserting the superseding `revoked` row the console's
 * own withdrawal writes:
 *
 *   · `app_is_authorised_for_testing` turns false immediately;
 *   · `sweepBadgeLifecycle` reported `{ expired: 0, suspended: 0 }`;
 *   · the badge stayed `active`, for the rest of its term — up to a year;
 *   · `badge_effective_status` went on answering `active` to the verification
 *     page and to the mark served on the customer's own site;
 *   · the re-assessment sweep skips the application, so not even drift was
 *     being looked for behind the mark;
 *   · and the liveness sweep went on fetching their origin every few minutes.
 *
 * The console told them "any run in flight stops, and no new run will start",
 * which was true and was not the whole of it. A withdrawal is the customer
 * saying stop; the mark says we are still checking.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sweepBadgeLifecycle } from '../apps/worker/src/badge.ts';
import { sweepLiveness } from '../apps/worker/src/monitoring.ts';
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

const badge = async (appId: string) =>
  (
    await db.query<{ status: string; suspension_reason: string | null }>(
      `select status::text as status, suspension_reason from public.badges where app_id = $1`,
      [appId],
    )
  ).rows[0]!;

const authorised = async (appId: string) =>
  (
    await db.query<{ ok: boolean }>('select public.app_is_authorised_for_testing($1) as ok', [
      appId,
    ])
  ).rows[0]!.ok;

/**
 * Withdrawal, written the way the console writes it.
 *
 * `authorisations` is append-only for a status change — an `update` is refused —
 * so a withdrawal is a superseding row with an empty scope, which is what
 * `app_is_authorised_for_testing` reads.
 */
async function withdraw(appId: string): Promise<void> {
  const { rows } = await db.query<{ id: string; organisation_id: string; granted_by: string }>(
    `select id, organisation_id, granted_by from public.authorisations
      where app_id = $1 order by created_at desc limit 1`,
    [appId],
  );
  const current = rows[0]!;
  await db.query(
    `insert into public.authorisations
       (app_id, organisation_id, supersedes_id, status, method, scope_domains, scope_exclusions,
        warranty_text_version, warranty_text_sha256, granted_by, revocation_reason)
     select $1, $2, $3, 'revoked', method, '{}'::text[], scope_exclusions,
            warranty_text_version, warranty_text_sha256, $4,
            'Testing this application is no longer wanted.'
       from public.authorisations where id = $3`,
    [appId, current.organisation_id, current.id, current.granted_by],
  );
}

/**
 * And authorising again, inside the same badge term.
 *
 * The scope and the target are copied from the row that was verified before the
 * withdrawal rather than invented: `authorisations_scope_within_verified_target`
 * requires the scope to sit under the host that was proved, so a hand-written
 * domain is refused — which is the constraint doing its job and not something a
 * fixture should route around.
 */
async function reauthorise(appId: string): Promise<void> {
  const { rows } = await db.query<{ id: string; latest: string }>(
    `select v.id,
            (select id from public.authorisations
              where app_id = $1 order by created_at desc limit 1) as latest
       from public.authorisations v
      where v.app_id = $1 and v.status = 'verified'
      order by v.created_at desc limit 1`,
    [appId],
  );
  const verified = rows[0]!;
  await db.query(
    `insert into public.authorisations
       (app_id, organisation_id, supersedes_id, status, method, scope_domains, scope_exclusions,
        warranty_text_version, warranty_text_sha256, granted_by, verification_target,
        verification_token, verified_at)
     select app_id, organisation_id, $2, 'verified', method, scope_domains, scope_exclusions,
            warranty_text_version, warranty_text_sha256, granted_by, verification_target,
            'tok-' || gen_random_uuid(), now()
       from public.authorisations where id = $1`,
    [verified.id, verified.latest],
  );
}

describe('a badge whose authorisation has been withdrawn', () => {
  let appId: string;

  beforeAll(async () => {
    ({ appId } = await seedBadgedApp(db, 'withdrawn-mark'));
    expect(await authorised(appId)).toBe(true);
    expect((await badge(appId)).status).toBe('active');
    await withdraw(appId);
  }, 60_000);

  it('is the application the gate now refuses', async () => {
    // The premise, asked of the database rather than assumed: without this the
    // readings below would pass for the wrong reason.
    expect(await authorised(appId)).toBe(false);
  });

  it('comes down, with a reason a stranger can read', async () => {
    const result = await sweepBadgeLifecycle(pool, () => undefined);
    expect(result.unauthorised).toBeGreaterThanOrEqual(1);

    const row = await badge(appId);
    expect(row.status).toBe('suspended');
    expect(row.suspension_reason).toMatch(/authorisation to test this application/i);
    // Not a finding about their software, said in the sentence itself: the
    // verification page shows this text to anybody who looks.
    expect(row.suspension_reason).toMatch(/not a finding/i);
  }, 60_000);

  it('tells the customer, because the licence asks them to act', async () => {
    const { rows } = await db.query<{ kind: string; severity: string; body: string }>(
      `select kind::text as kind, severity::text as severity, body
         from public.alerts a
         join public.badges b on b.id = a.badge_id
        where b.app_id = $1`,
      [appId],
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.map((row) => row.kind)).toContain('badge_suspended');
    // Delivered, rather than visible only to somebody who happens to log in:
    // both channels filter `info` out.
    expect(rows.some((row) => ['warning', 'critical'].includes(row.severity))).toBe(true);
  });

  it('goes back up when they authorise again inside the term', async () => {
    await reauthorise(appId);
    expect(await authorised(appId)).toBe(true);

    const result = await sweepBadgeLifecycle(pool, () => undefined);
    expect(result.reauthorised).toBeGreaterThanOrEqual(1);

    const row = await badge(appId);
    expect(row.status).toBe('active');
    expect(row.suspension_reason).toBeNull();
  }, 60_000);
});

describe('what the liveness sweep touches', () => {
  /*
   * A withdrawal is the customer saying stop.
   *
   * The re-assessment sweep in `monitoring.ts` has always asked
   * `app_is_authorised_for_testing` before it queues anything. The liveness
   * sweep did not, and went on issuing a GET against the customer's own origin
   * every half hour for the rest of the badge's term.
   *
   * Monitoring is switched on and a plan with a liveness cadence is put in
   * force here deliberately: a seeded badged application has
   * `monitoring_enabled` false and no subscription at all, so the sweep skips
   * it for two other reasons and a test that only withdrew the authorisation
   * would pass without the gate existing. The first reading below is what makes
   * the second one mean something.
   */
  let appId: string;
  let origin: string;

  const probeFor = async (): Promise<string[]> => {
    const probed: string[] = [];
    await sweepLiveness(
      pool,
      async (target: string) => {
        probed.push(target);
        return { status: 200 };
      },
      () => undefined,
      new Date(),
      50,
      null,
    );
    return probed;
  };

  beforeAll(async () => {
    ({ appId } = await seedBadgedApp(db, 'liveness-withdrawn'));
    const { rows } = await db.query<{ organisation_id: string; certified_origin: string }>(
      `select app.organisation_id, b.certified_origin
         from public.apps app join public.badges b on b.app_id = app.id
        where app.id = $1`,
      [appId],
    );
    origin = rows[0]!.certified_origin;
    await db.query('update public.apps set monitoring_enabled = true where id = $1', [appId]);
    await db.query(
      `insert into public.subscriptions (organisation_id, plan, status)
       values ($1, 'certified', 'active')`,
      [rows[0]!.organisation_id],
    );
  }, 60_000);

  it('an authorised application, which is the premise', async () => {
    expect(await authorised(appId)).toBe(true);
    expect(await probeFor()).toContain(origin);
  }, 60_000);

  it('and not one whose authorisation has been withdrawn', async () => {
    await withdraw(appId);
    expect(await authorised(appId)).toBe(false);
    // `last_seen_at` was stamped by the probe above, so the row is not due for
    // another half hour. Cleared, because "not due" and "not authorised" are
    // the two answers this must tell apart.
    await db.query('update public.apps set last_seen_at = null where id = $1', [appId]);
    expect(await probeFor()).not.toContain(origin);
  }, 60_000);
});

describe('what it leaves alone', () => {
  it('an application that is still authorised', async () => {
    const { appId } = await seedBadgedApp(db, 'authorised-mark');
    await sweepBadgeLifecycle(pool, () => undefined);
    expect((await badge(appId)).status).toBe('active');
  }, 60_000);

  it('a suspension somebody else made, when the authorisation comes back', async () => {
    /*
     * The restore matches on the reason this branch wrote, exactly as the
     * liveness sweep's does. A reviewer's suspension and a liveness failure are
     * decisions this sweep has no business reversing — and a withdrawal
     * followed by a re-authorisation is the one case where it would have the
     * chance to.
     */
    const { appId } = await seedBadgedApp(db, 'suspended-by-hand');
    await db.query(
      `update public.badges
          set status = 'suspended', suspended_at = now(),
              suspension_reason = 'A reviewer suspended this while an appeal is open.'
        where app_id = $1`,
      [appId],
    );
    await sweepBadgeLifecycle(pool, () => undefined);

    const row = await badge(appId);
    expect(row.status).toBe('suspended');
    expect(row.suspension_reason).toMatch(/a reviewer suspended this/i);
  }, 60_000);
});

describe('what the console says withdrawing does', () => {
  const actions = readFileSync(join(process.cwd(), 'apps/web/app/console/apps/actions.ts'), 'utf8');

  it('names the mark, not only the runs', () => {
    // The sentence used to stop at the runs, and the runs were the only part of
    // it that was true.
    const notice = actions.slice(actions.indexOf('Authorisation withdrawn.'));
    expect(notice).toMatch(/verification mark/i);
    expect(notice).toMatch(/suspended/i);
    expect(notice).toMatch(/remove it from your site/i);
    expect(notice).toMatch(/Authorising again/i);
  });
});
