/**
 * A run that looked at less is not an application that got worse.
 *
 * `assessMateriality` already withholds a suspension for one reason of this
 * kind, and says why in its own words: "A score that moved because we changed
 * the standard is our movement, not the customer's, and may not cost them a
 * badge." That is the rubric version, carried on `comparable`.
 *
 * There is a second way a change can be ours, and nothing looked at it. Criteria
 * go untested for reasons that have nothing to do with the application:
 *
 *   · no synthetic test account, so everything behind the sign-in is left alone;
 *   · the target did not answer, so every criterion read from the browser is
 *     unobserved — `deterministic.ts` marks nine that way in one line;
 *   · the rubric publishes a criterion that has no check behind it yet.
 *
 * The first two can differ between two runs of the same application. A
 * deterministic stage that could not reach the target fails while the static
 * stage still succeeds, so the pipeline returns `completed` with a score
 * computed over what little was seen — and the drift sweep compares that with a
 * full run and suspends the badge, telling the customer their application
 * regressed. It did not. We saw less of it.
 *
 * This is the same judgement as tonight's liveness sweep, one layer in: the
 * failures of a run are not always evidence about the thing being assessed.
 *
 * The reason is its own branch rather than another cause folded into
 * `comparable`, because the sentence the customer reads is different and one
 * sentence for two causes is the defect this codebase keeps finding. The
 * findings still stand and are still reported — withholding the suspension is
 * not the same as withholding the work.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import {
  assessMateriality,
  computeDrift,
  driftAlert,
  type AssessmentSnapshot,
  type ComparableFinding,
} from '../packages/monitoring/src/index.ts';
import { recordDriftFor } from '../apps/worker/src/monitoring.ts';
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
  seedFinding,
  type SeededAccount,
} from './setup/seed.ts';

const snapshot = (id: string, over: Partial<AssessmentSnapshot> = {}): AssessmentSnapshot => ({
  assessmentId: id,
  assessedAt: new Date('2026-09-01T00:00:00Z'),
  rubricVersion: '1.1.0',
  overallScore: 84,
  certificationEligible: true,
  dimensions: [
    { dimension: 'security_posture', score: 84 },
    { dimension: 'data_privacy_practice', score: 84 },
    { dimension: 'functional_integrity', score: 84 },
  ],
  findings: [],
  notTestedCount: 3,
  ...over,
});

const critical = (ruleId: string): ComparableFinding => ({
  ruleId,
  dimension: 'security_posture',
  severity: 'critical',
  title: `${ruleId}: something serious`,
  isPublished: true,
});

describe('a run that saw less of the application', () => {
  const before = snapshot('a', { notTestedCount: 3 });
  const after = snapshot('b', {
    notTestedCount: 12,
    overallScore: 41,
    findings: [critical('SEC-05')],
  });

  it('is carried on the drift rather than inferred later', () => {
    const drift = computeDrift(before, after);
    expect(drift.coverageShrank).toBe(true);
    expect(drift.notTestedBefore).toBe(3);
    expect(drift.notTestedAfter).toBe(12);
    // And the rubric did not move, which is the other cause and stays separate.
    expect(drift.comparable).toBe(true);
    expect(drift.rubricVersionChanged).toBe(false);
  });

  it('does not take the badge down', () => {
    const verdict = assessMateriality(computeDrift(before, after));
    expect(verdict.suspendBadge).toBe(false);
    expect(verdict.material).toBe(false);
  });

  it('says which of the two reasons it was, in numbers the customer can check', () => {
    const verdict = assessMateriality(computeDrift(before, after));
    expect(verdict.withheldBecause).toContain('12 criteria untested against 3');
    expect(verdict.withheldBecause).toMatch(/not attributable to the application/);
    expect(verdict.withheldBecause).toMatch(/narrower look/);
    // Not the rubric sentence. Two causes, two reasons, and a customer reading
    // the wrong one would go looking for a standard that never changed.
    expect(verdict.withheldBecause).not.toMatch(/rubric/i);
  });

  it('still reports what was found', () => {
    // Withholding a suspension is not withholding the work. A critical finding
    // on a narrow run is still a critical finding, and the customer is told.
    const verdict = assessMateriality(computeDrift(before, after));
    expect(verdict.reasons.length).toBeGreaterThan(0);
    expect(verdict.reasons.map((reason) => reason.explanation).join(' ')).toMatch(
      /critical|score/i,
    );
  });
});

describe('the sentence the customer actually receives', () => {
  const before = snapshot('a', { notTestedCount: 3 });
  const narrow = snapshot('b', { notTestedCount: 12, overallScore: 41 });

  it('carries the reason the badge stayed up, rather than computing it and dropping it', () => {
    // `withheldBecause` had no reader anywhere. The drift alert wrote its own
    // version of the rubric caveat from `drift.comparable` — a second copy of
    // one rule — and had nothing at all to say about a narrower run. So a
    // customer saw a forty-point drop reported with no explanation beside it
    // and a badge still standing, which reads as our own system disagreeing
    // with itself.
    const drift = computeDrift(before, narrow);
    const verdict = assessMateriality(drift);
    const alert = driftAlert('Kettle', 'app-1', drift, verdict);
    expect(alert.body).toContain(verdict.withheldBecause!);
    expect(alert.body).toContain('12 criteria untested against 3');
  });

  it('still carries the rubric reason, in the verdict words rather than a second copy', () => {
    const drift = computeDrift(snapshot('a', { rubricVersion: '1.0.0' }), snapshot('b'));
    const verdict = assessMateriality(drift);
    expect(verdict.withheldBecause).toMatch(/different rubric versions/);
    expect(driftAlert('Kettle', 'app-1', drift, verdict).body).toContain(verdict.withheldBecause!);
  });

  it('says nothing extra when nothing was withheld', () => {
    const drift = computeDrift(before, snapshot('b', { overallScore: 81 }));
    const verdict = assessMateriality(drift);
    expect(verdict.withheldBecause).toBeNull();
    const alert = driftAlert('Kettle', 'app-1', drift, verdict);
    expect(alert.body).not.toMatch(/untested|rubric/i);
  });
});

describe('what still takes a badge down', () => {
  it('a regression on a run that saw as much as the last one', () => {
    const verdict = assessMateriality(
      computeDrift(
        snapshot('a', { notTestedCount: 3 }),
        snapshot('b', { notTestedCount: 3, overallScore: 41, findings: [critical('SEC-05')] }),
      ),
    );
    expect(verdict.suspendBadge).toBe(true);
    expect(verdict.withheldBecause).toBeNull();
  });

  it('a regression on a run that saw more than the last one', () => {
    // The direction matters. Looking at more of an application and finding more
    // wrong with it is exactly what monitoring is for.
    const verdict = assessMateriality(
      computeDrift(
        snapshot('a', { notTestedCount: 12 }),
        snapshot('b', { notTestedCount: 3, overallScore: 41, findings: [critical('SEC-05')] }),
      ),
    );
    expect(verdict.suspendBadge).toBe(true);
  });

  it('and the rubric reason still wins when the standard moved as well', () => {
    // Both causes at once. The rubric sentence comes first because it is the
    // one that explains the score moving at all.
    const verdict = assessMateriality(
      computeDrift(
        snapshot('a', { notTestedCount: 3, rubricVersion: '1.0.0' }),
        snapshot('b', { notTestedCount: 12, overallScore: 41 }),
      ),
    );
    expect(verdict.suspendBadge).toBe(false);
    expect(verdict.withheldBecause).toMatch(/rubric versions/);
  });
});

// ---------------------------------------------------------------------------
// The same judgement, from the database to the badge
// ---------------------------------------------------------------------------

/**
 * Because the arithmetic above proves nothing about the wiring.
 *
 * Found by mutation: replacing `notTestedCount: Number(row.not_tested_count)`
 * in the worker's snapshot with a hard-coded `0` left every case above green.
 * The count has to travel from `assessments.not_tested`, through
 * `SNAPSHOT_SELECT`, into the verdict that holds or takes a customer's badge,
 * and that is a chain of four links with a test on one of them.
 */
let db: Client;
let pool: Pool;
let reviewerId: string;

beforeAll(async () => {
  db = await connect();
  const dsn = new URL(process.env.VIBEFYCODE_TEST_DSN!);
  pool = new Pool({
    host: dsn.searchParams.get('host')!,
    database: dsn.pathname.slice(1),
    user: 'postgres',
  });
  const reviewer = await seedAccount(db, 'narrower-look-reviewer');
  await makeReviewer(db, reviewer.userId);
  reviewerId = reviewer.userId;
}, 60_000);

afterAll(async () => {
  await pool?.end();
  await db?.end();
});

/** One approved, scored assessment with a given reach and set of findings. */
async function assessed(
  owner: SeededAccount,
  appId: string,
  authorisationId: string,
  options: {
    score: number;
    notTested: number;
    at: string;
    findings?: { ruleId: string; severity: string; title: string }[];
  },
): Promise<string> {
  const { assessmentId } = await seedAssessment(db, owner, {
    appId,
    authorisationId,
    depth: 'continuous',
  });
  for (const finding of options.findings ?? []) {
    await seedFinding(db, owner, assessmentId, finding);
  }
  await approveAssessment(db, owner, assessmentId, reviewerId, {
    // The database refuses eligibility to an assessment carrying a critical
    // security finding, which is right and is also what a real regression looks
    // like: the finding arrives and the eligibility goes with it.
    certificationEligible: (options.findings ?? []).length === 0,
    score: options.score,
  });
  await db.query(
    `update public.assessments
        set not_tested = $2::jsonb,
            dimension_scores = $3::jsonb,
            completed_at = $4::timestamptz
      where id = $1`,
    [
      assessmentId,
      JSON.stringify(
        Array.from({ length: options.notTested }, (_, index) => ({
          criterion: `UNS-${index}`,
          because:
            'The application did not respond, so nothing this criterion is read from was observed.',
        })),
      ),
      JSON.stringify([
        { dimension: 'security_posture', score: options.score },
        { dimension: 'data_privacy_practice', score: options.score },
      ]),
      options.at,
    ],
  );
  return assessmentId;
}

describe('the count, from the column to the badge', () => {
  it('holds the badge when the second run tested less, and says so', async () => {
    const owner = await seedAccount(db, 'narrower-look-owner');
    const appId = await seedApp(db, owner, 'Kettle');
    const authorisationId = await seedAuthorisation(db, owner, appId);

    const first = await assessed(owner, appId, authorisationId, {
      score: 84,
      notTested: 3,
      at: '2026-09-01T00:00:00Z',
    });
    const consentId = await acceptBadgeLicence(db, owner);
    const badgeId = await issueBadge(db, owner, { appId, assessmentId: first, consentId });

    const second = await assessed(owner, appId, authorisationId, {
      score: 41,
      notTested: 12,
      at: '2026-09-15T00:00:00Z',
      findings: [{ ruleId: 'SEC-05', severity: 'critical', title: 'Admin opens for anyone' }],
    });

    const client = await pool.connect();
    let outcome;
    try {
      outcome = await recordDriftFor(client, second);
    } finally {
      client.release();
    }

    expect(outcome?.badgeSuspended).toBe(false);
    expect(outcome?.materialRegression).toBe(false);

    const badge = await db.query<{ status: string }>(
      'select status::text as status from public.badges where id = $1',
      [badgeId],
    );
    expect(badge.rows[0]!.status).toBe('active');

    // The drift is still recorded and the customer still told what moved.
    const report = await db.query<{ material: boolean; reasons: string[] }>(
      `select material_regression as material, regression_reasons as reasons
         from public.drift_reports where assessment_id = $1`,
      [second],
    );
    expect(report.rows[0]!.material).toBe(false);
    expect(report.rows[0]!.reasons.join(' ')).toMatch(/score|critical/i);
  }, 90_000);

  it('takes it down when the second run tested just as much', async () => {
    // The control on the case above: same scores, same finding, same everything
    // except how much was looked at.
    const owner = await seedAccount(db, 'narrower-look-control');
    const appId = await seedApp(db, owner, 'Kettle');
    const authorisationId = await seedAuthorisation(db, owner, appId);

    const first = await assessed(owner, appId, authorisationId, {
      score: 84,
      notTested: 3,
      at: '2026-09-01T00:00:00Z',
    });
    const consentId = await acceptBadgeLicence(db, owner);
    const badgeId = await issueBadge(db, owner, { appId, assessmentId: first, consentId });

    const second = await assessed(owner, appId, authorisationId, {
      score: 41,
      notTested: 3,
      at: '2026-09-15T00:00:00Z',
      findings: [{ ruleId: 'SEC-05', severity: 'critical', title: 'Admin opens for anyone' }],
    });

    const client = await pool.connect();
    let outcome;
    try {
      outcome = await recordDriftFor(client, second);
    } finally {
      client.release();
    }

    expect(outcome?.materialRegression).toBe(true);
    expect(outcome?.badgeSuspended).toBe(true);
    const badge = await db.query<{ status: string }>(
      'select status::text as status from public.badges where id = $1',
      [badgeId],
    );
    expect(badge.rows[0]!.status).toBe('suspended');
  }, 90_000);
});
