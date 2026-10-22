/**
 * One assessment nobody could compare, and every other application waiting
 * behind it.
 *
 * `sweepPendingReports` learnt this the hard way and carries the lesson in its
 * own docstring: "The window is twenty rows ordered oldest-review-first, and a
 * row leaves it only by acquiring a report. An assessment that can never
 * acquire one therefore sits at the front of that window and takes a slot every
 * sweep, for ever. Twenty of those and nobody's report is generated again,
 * while the log fills with the same twenty errors and never says the thing that
 * matters: that everyone else is now waiting behind them."
 *
 * `sweepDriftDetection` has the identical window — twenty rows, oldest first,
 * leaving only by acquiring a `drift_reports` row — and had no cap, no count
 * and no record. Measured on 2026-10-22 with a client that refuses the
 * `drift_reports` insert for one assessment: the sweep logged the same error on
 * every pass, for ever, and the assessment behind it was never compared.
 *
 * What that costs is not a missing document. The comparison is what finds a
 * material regression and takes the badge down. A drift sweep that has quietly
 * stopped means every badge goes on standing whatever has happened to the
 * application behind it — which is the one thing this product sells.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool, type PoolClient } from 'pg';
import {
  DRIFT_ABANDONED,
  DRIFT_COMPARISON_ATTEMPTS,
  DRIFT_RECOVERED,
  resetDriftFailureCounts,
  sweepDriftDetection,
} from '../apps/worker/src/monitoring.ts';
import { connect } from './setup/client.ts';
import {
  approveAssessment,
  makeReviewer,
  seedAccount,
  seedApp,
  seedAssessment,
  seedAuthorisation,
  type SeededAccount,
} from './setup/seed.ts';

let db: Client;
let pool: Pool;
let reviewer: SeededAccount;

beforeAll(async () => {
  db = await connect();
  const dsn = new URL(process.env.VIBEFYCODE_TEST_DSN!);
  pool = new Pool({
    host: dsn.searchParams.get('host')!,
    database: dsn.pathname.slice(1),
    user: 'postgres',
  });
  reviewer = await seedAccount(db, 'comparison-reviewer');
  await makeReviewer(db, reviewer.userId);
});

afterAll(async () => {
  await pool?.end();
  await db?.end();
});

interface Workspace {
  readonly owner: SeededAccount;
  readonly appId: string;
  readonly authorisationId: string;
}

async function workspace(label: string): Promise<Workspace> {
  const owner = await seedAccount(db, label);
  const appId = await seedApp(db, owner, 'Kettle');
  const authorisationId = await seedAuthorisation(db, owner, appId);
  return { owner, appId, authorisationId };
}

/** One approved assessment, stamped so the sweep's ordering is ours to choose. */
async function assess(space: Workspace, score: number, assessedAt: string): Promise<string> {
  const seeded = await seedAssessment(db, space.owner, {
    appId: space.appId,
    authorisationId: space.authorisationId,
    depth: 'continuous',
  });
  await approveAssessment(db, space.owner, seeded.assessmentId, reviewer.userId, {
    certificationEligible: true,
    score,
  });
  // `dimension_scores` as well as the date: a comparison with nothing to
  // compare per dimension is a different failure from the one being measured
  // here, and the first version of this file measured that one by mistake.
  await db.query(
    `update public.assessments
        set dimension_scores = $3::jsonb, completed_at = $2::timestamptz
      where id = $1`,
    [
      seeded.assessmentId,
      assessedAt,
      JSON.stringify([
        { dimension: 'security_posture', score },
        { dimension: 'data_privacy_practice', score: 78 },
      ]),
    ],
  );
  return seeded.assessmentId;
}

/**
 * A pool whose client refuses to write one assessment's comparison.
 *
 * The injection seam the sweep already has. A deterministic failure is the
 * case that matters: a transient one clears itself on the next pass, and it is
 * the row that will never succeed which holds a place in the window for ever.
 */
function poolRefusing(assessmentId: string): { connect(): Promise<PoolClient> } {
  return {
    async connect() {
      const client = await pool.connect();
      const real = client.query.bind(client);
      const patched = async (...args: unknown[]) => {
        const first = args[0];
        const text = typeof first === 'string' ? first : String((first as { text?: string })?.text);
        const values = args[1];
        if (
          text.includes('insert into public.drift_reports') &&
          Array.isArray(values) &&
          values.includes(assessmentId)
        ) {
          throw new Error('drift_reports refused this row');
        }
        return (real as (...rest: unknown[]) => Promise<unknown>)(...args);
      };
      return new Proxy(client, {
        get(target, property, receiver) {
          if (property === 'query') return patched;
          return Reflect.get(target, property, receiver);
        },
      });
    },
  };
}

const auditFor = async (assessmentId: string, action: string) =>
  (
    await db.query<{ summary: string }>(
      'select summary from public.audit_log where entity_id = $1 and action = $2',
      [assessmentId, action],
    )
  ).rows;

const comparedCount = async (assessmentId: string) =>
  (
    await db.query<{ n: number }>(
      'select count(*)::int as n from public.drift_reports where assessment_id = $1',
      [assessmentId],
    )
  ).rows[0]!.n;

describe('an assessment the sweep cannot compare', () => {
  let stuck: string;
  let behind: string;
  let refusing: { connect(): Promise<PoolClient> };

  beforeAll(async () => {
    resetDriftFailureCounts();

    // Two applications. The one that cannot be compared is the older, so the
    // sweep's `order by` puts it at the front of the window.
    const first = await workspace('comparison-stuck');
    await assess(first, 80, '2026-01-01T00:00:00Z');
    stuck = await assess(first, 70, '2026-01-02T00:00:00Z');

    const second = await workspace('comparison-behind');
    await assess(second, 81, '2026-02-01T00:00:00Z');
    behind = await assess(second, 76, '2026-02-02T00:00:00Z');

    refusing = poolRefusing(stuck);
  }, 120_000);

  it('holds the whole window while it is being retried', async () => {
    /*
     * A window one row wide, which is the measurement rather than the
     * deployment: the real sweep takes twenty, and twenty rows in this state
     * stop it completely. One makes the same point with one application
     * waiting instead of twenty.
     */
    const said: { message: string; detail?: Record<string, unknown> }[] = [];
    const log = (message: string, detail?: Record<string, unknown>) =>
      said.push({ message, ...(detail ? { detail } : {}) });

    await sweepDriftDetection(refusing, log, 1);
    expect(await comparedCount(stuck)).toBe(0);
    // The premise: the application behind it is genuinely not reached while
    // the stuck row holds the place.
    expect(await comparedCount(behind)).toBe(0);
    expect(said.some((entry) => entry.message === 'drift detection failed')).toBe(true);
  }, 120_000);

  it('is given up on after three attempts, and says what that costs', async () => {
    const said: { message: string; detail?: Record<string, unknown> }[] = [];
    const log = (message: string, detail?: Record<string, unknown>) =>
      said.push({ message, ...(detail ? { detail } : {}) });

    // Attempts two and three. The first was the sweep above.
    for (let pass = 1; pass < DRIFT_COMPARISON_ATTEMPTS; pass += 1) {
      await sweepDriftDetection(refusing, log, 1);
    }

    const gaveUp = said.find(
      (entry) => entry.message === 'drift comparison given up on until this process restarts',
    );
    expect(gaveUp).toBeDefined();
    expect(gaveUp!.detail?.attempts).toBe(DRIFT_COMPARISON_ATTEMPTS);

    // And durably, because a Map a deploy forgets is not an account anybody
    // can act on.
    const recorded = await auditFor(stuck, DRIFT_ABANDONED);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.summary).toMatch(/nothing is looking for a regression behind this badge/i);
    expect(recorded[0]!.summary).toMatch(/drift_reports refused this row/);
  }, 120_000);

  it('lets the window move on, so everybody else is compared', async () => {
    const said: { message: string; detail?: Record<string, unknown> }[] = [];
    const log = (message: string, detail?: Record<string, unknown>) =>
      said.push({ message, ...(detail ? { detail } : {}) });

    const recorded = await sweepDriftDetection(refusing, log, 1);
    expect(recorded).toBeGreaterThanOrEqual(1);
    expect(await comparedCount(behind)).toBe(1);

    /*
     * And the sweep says so when the given-up-on row is all that is left.
     *
     * It is not in the window above at all — the `order by` puts it behind
     * anything with a chance, which is what freed the place. Once there is
     * nothing else waiting it comes back to the front, and then the cap is what
     * stops another attempt: counted and said once, rather than a fourth error
     * in the log.
     */
    const again: { message: string; detail?: Record<string, unknown> }[] = [];
    await sweepDriftDetection(
      refusing,
      (message, detail) => again.push({ message, ...(detail ? { detail } : {}) }),
      1,
    );
    expect(await comparedCount(stuck)).toBe(0);
    const blocked = again.find(
      (entry) => entry.message === 'assessments the sweep can no longer compare',
    );
    expect(blocked).toBeDefined();
    expect(blocked!.detail?.blocked).toBe(1);
    expect(again.some((entry) => entry.message === 'drift detection failed')).toBe(false);
  }, 120_000);

  it('writes the abandonment once, however many times the worker restarts', async () => {
    resetDriftFailureCounts();
    for (let pass = 0; pass < DRIFT_COMPARISON_ATTEMPTS; pass += 1) {
      await sweepDriftDetection(refusing, () => undefined, 1);
    }
    expect(await auditFor(stuck, DRIFT_ABANDONED)).toHaveLength(1);
  }, 120_000);

  it('records the recovery when the cause clears', async () => {
    // A restart is a fresh try, which is what you want after the deploy that
    // fixed the cause — and here the cause is simply not refused any more.
    resetDriftFailureCounts();
    const recorded = await sweepDriftDetection(pool, () => undefined, 1);
    expect(recorded).toBeGreaterThanOrEqual(1);
    expect(await comparedCount(stuck)).toBe(1);

    const cleared = await auditFor(stuck, DRIFT_RECOVERED);
    expect(cleared).toHaveLength(1);
    expect(cleared[0]!.summary).toMatch(/has now been made/i);
  }, 120_000);
});

describe('what it leaves alone', () => {
  it('records nothing for a comparison that was made first time', async () => {
    resetDriftFailureCounts();
    const space = await workspace('comparison-clean');
    await assess(space, 80, '2026-03-01T00:00:00Z');
    const second = await assess(space, 79, '2026-03-02T00:00:00Z');

    await sweepDriftDetection(pool, () => undefined, 20);
    expect(await comparedCount(second)).toBe(1);
    expect(await auditFor(second, DRIFT_ABANDONED)).toHaveLength(0);
    expect(await auditFor(second, DRIFT_RECOVERED)).toHaveLength(0);
  }, 120_000);
});
