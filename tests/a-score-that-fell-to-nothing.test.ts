/**
 * "The overall score fell by 85.0 points, from 85.0 to 0.0."
 *
 * That sentence was recorded in a drift report, as a published reason for a
 * material regression, against an assessment whose score was never computed.
 * `toSnapshot` read `Number(row.overall_score ?? 0)` — the same defect
 * `packages/report/src/assemble.ts` was corrected for on the same column.
 *
 * Measured on 2026-10-09 by calling `recordDriftFor` on an unscored assessment
 * with a scored one behind it: a drift report, `material_regression` true, and
 * two reasons — the one above and "The overall score fell below the
 * certification threshold of 70, to 0.0". With a badge present `suspendBadge`
 * is true, because it is simply `reasons.length > 0`, so the customer's mark
 * comes down and `regressionAlert` tells them in writing that their score fell
 * eighty-five points.
 *
 * `sweepDriftDetection` filters `a.overall_score is not null`, so nothing
 * reached it. That is the shape of the problem rather than a reason to leave it:
 * the rule lived in one caller's SQL while the function using the number had no
 * opinion, and both snapshot functions are exported. The next caller inherits a
 * guard it cannot see.
 *
 * Both directions are held here. An unscored assessment is refused, and a
 * scored one still drifts normally — a comparison that refused everything would
 * be the more expensive mistake, because then nothing would ever be rated
 * twice.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { recordDriftFor, sweepDriftDetection } from '../apps/worker/src/monitoring.ts';
import { connect } from './setup/client.ts';
import {
  makeReviewer,
  seedAccount,
  seedApp,
  seedAssessment,
  type SeededAccount,
} from './setup/seed.ts';

let db: Client;
let pool: Pool;
let owner: SeededAccount;
let reviewer: SeededAccount;

const SCOPE =
  'A scope statement long enough to pass the hundred-character floor the report assembly insists ' +
  'upon, stated plainly and without flourish.';

const DIMENSIONS = JSON.stringify([
  { dimension: 'security_posture', score: 85, weight: 0.3, penaltyApplied: 0, band: 'Strong' },
]);

beforeAll(async () => {
  db = await connect();
  const dsn = new URL(process.env.VIBEFYCODE_TEST_DSN!);
  pool = new Pool({
    host: dsn.searchParams.get('host')!,
    database: dsn.pathname.slice(1),
    user: 'postgres',
  });
  owner = await seedAccount(db, 'fell-to-nothing');
  reviewer = await seedAccount(db, 'fell-to-nothing-rev');
  await makeReviewer(db, reviewer.userId);
});

afterAll(async () => {
  await pool?.end();
  await db?.end();
});

/** An approved assessment, with a score or deliberately without one. */
async function approved(
  appId: string,
  options: { score: number | null; daysAgo: number; dimensions?: string | null },
): Promise<string> {
  const { assessmentId } = await seedAssessment(db, owner, { appId, depth: 'full' });
  await db.query(
    `update public.assessments set scope_statement = $2, status = 'awaiting_review' where id = $1`,
    [assessmentId, SCOPE],
  );
  await db.query(
    `insert into public.reviews (assessment_id, organisation_id, reviewer_id, action, reason)
     values ($1, $2, $3, 'approved', 'Findings and evidence checked against the rubric.')`,
    [assessmentId, owner.organisationId, reviewer.userId],
  );
  await db.query(
    `update public.assessments
        set status = 'approved', overall_score = $2, reviewed_at = now(),
            completed_at = now() - ($3 || ' days')::interval, dimension_scores = $4
      where id = $1`,
    [
      assessmentId,
      options.score,
      String(options.daysAgo),
      options.dimensions === undefined ? DIMENSIONS : options.dimensions,
    ],
  );
  return assessmentId;
}

describe('an assessment with no score', () => {
  it('is refused rather than compared as a zero', async () => {
    const appId = await seedApp(db, owner);
    await approved(appId, { score: 85, daysAgo: 5 });
    const unscored = await approved(appId, { score: null, daysAgo: 1 });

    await expect(recordDriftFor(db as never, unscored, () => undefined)).rejects.toThrow(
      /never computed is not a zero/i,
    );

    // And nothing was written. A drift report naming a regression is the
    // artefact this exists to prevent, and it would outlive the fault.
    const reports = await db.query(`select id from public.drift_reports where assessment_id = $1`, [
      unscored,
    ]);
    expect(reports.rowCount).toBe(0);
  }, 60_000);

  it('is refused when it has a score and no dimensions', async () => {
    // The same rule one level down: reading a null as an empty array means the
    // dimension-floor rule cannot fire, and nothing says so.
    const appId = await seedApp(db, owner);
    await approved(appId, { score: 85, daysAgo: 5 });
    const noDimensions = await approved(appId, { score: 71, daysAgo: 1, dimensions: null });

    await expect(recordDriftFor(db as never, noDimensions, () => undefined)).rejects.toThrow(
      /dimension floors cannot be checked/i,
    );
  }, 60_000);

  it('is filtered out by the sweep before the guard is even reached', async () => {
    /*
     * Which guard acted, not merely that nothing was written.
     *
     * The first version of this asserted only `drift_reports` was empty, and
     * mutating the sweep's `overall_score is not null` filter away left it
     * green — because the throw above then stopped it instead, and the sweep's
     * catch turned that into a logged failure. True, and not what the test's
     * name claimed. So the log is read: silence means the row never entered the
     * window, which is the premise this test is for.
     */
    const appId = await seedApp(db, owner);
    await approved(appId, { score: 85, daysAgo: 5 });
    const unscored = await approved(appId, { score: null, daysAgo: 1 });

    const lines: string[] = [];
    await sweepDriftDetection(pool, (message, detail) =>
      lines.push(`${message} ${JSON.stringify(detail ?? {})}`),
    );
    expect(lines.filter((line) => line.includes(unscored))).toEqual([]);

    const reports = await db.query(`select id from public.drift_reports where assessment_id = $1`, [
      unscored,
    ]);
    expect(reports.rowCount).toBe(0);
  }, 60_000);
});

describe('an assessment with a score', () => {
  it('still drifts, and says by how much', async () => {
    // The half that makes the other half mean something. A comparison that
    // refused everything would mean nothing is ever rated twice.
    const appId = await seedApp(db, owner);
    await approved(appId, { score: 85, daysAgo: 5 });
    const later = await approved(appId, { score: 71, daysAgo: 1 });

    const outcome = await recordDriftFor(db as never, later, () => undefined);
    expect(outcome).not.toBeNull();
    const { rows } = await db.query<{ score_before: string; score_after: string }>(
      `select score_before, score_after from public.drift_reports where assessment_id = $1`,
      [later],
    );
    expect(Number(rows[0]!.score_before)).toBe(85);
    expect(Number(rows[0]!.score_after)).toBe(71);
  }, 60_000);
});
