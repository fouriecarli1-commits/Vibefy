/**
 * Applying a profile to an assessment.
 *
 * Pure, and deliberately dull. Every failure names the rule that produced it and
 * says what would clear it, because a dashboard that shows a red dot and no
 * reason gets ignored by exactly the people it was built for.
 */
import type {
  PolicyDimension,
  PolicyEvaluation,
  PolicyFailure,
  PolicyProfile,
  PolicySeverity,
  PolicySubject,
} from './types.ts';

/**
 * The severities, weakest first, and the one list of them.
 *
 * This file had two: an order and a rank, five entries each, naming the same
 * five values. Nothing held them in step, and a severity added to one and not
 * the other is the defect the ceiling below is guarded against — so the rank is
 * the position in the order now, and there is nothing to keep in step.
 *
 * `tests/the-floor-that-was-not-there.test.ts` asks `pg_enum` what
 * `public.finding_severity` holds and compares it to this, in both directions.
 */
const SEVERITY_ORDER: readonly PolicySeverity[] = ['info', 'low', 'medium', 'high', 'critical'];

const SEVERITY_RANK = Object.fromEntries(
  SEVERITY_ORDER.map((severity, index) => [severity, index]),
) as Readonly<Record<PolicySeverity, number>>;

export function severityRank(severity: PolicySeverity): number {
  return SEVERITY_RANK[severity];
}

export const POLICY_NOTE =
  'A policy profile is your organisation’s own bar, applied to a score that was produced without knowing this profile exists. It can fail an application the rubric passed. It never changes the score.';

function readable(dimension: PolicyDimension): string {
  return dimension.replace(/_/g, ' ');
}

export function evaluatePolicy(profile: PolicyProfile, subject: PolicySubject): PolicyEvaluation {
  const failures: PolicyFailure[] = [];

  if (profile.minOverallScore !== null && subject.overallScore < profile.minOverallScore) {
    failures.push({
      rule: 'min_overall_score',
      explanation: `Scored ${subject.overallScore.toFixed(1)} against a required minimum of ${profile.minOverallScore.toFixed(1)}.`,
    });
  }

  const scores = new Map<PolicyDimension, number>(
    subject.dimensions.map((entry) => [entry.dimension, entry.score]),
  );
  for (const [dimension, floor] of Object.entries(profile.dimensionFloors) as [
    PolicyDimension,
    number,
  ][]) {
    const score = scores.get(dimension);
    // A dimension the assessment did not produce is not a pass. Silence about a
    // requirement is the failure mode this whole product exists to fix.
    if (score === undefined) {
      failures.push({
        rule: 'dimension_floor',
        explanation: `${readable(dimension)} was not scored in this assessment, and the profile requires at least ${floor}.`,
      });
      continue;
    }
    if (score < floor) {
      failures.push({
        rule: 'dimension_floor',
        explanation: `${readable(dimension)} scored ${score.toFixed(1)} against a required floor of ${floor}.`,
      });
    }
  }

  if (profile.maxOpenSeverity !== null) {
    const ceiling = SEVERITY_RANK[profile.maxOpenSeverity];
    /*
     * A ceiling this file does not recognise is not a ceiling of infinity.
     *
     * `maxOpenSeverity` arrives from a column typed `public.finding_severity`,
     * so the database will not hold a value nobody chose. What it will hold is
     * a value somebody adds later: `alter type ... add value 'blocker'` is one
     * line in a migration, and this map is five lines in another package that
     * the migration does not mention. Then `ceiling` is undefined,
     * `SEVERITY_RANK[finding.severity] > undefined` is false for every finding
     * ever, and the strictest-sounding rule in a procurement profile permits a
     * critical open finding while the console carries on printing "No open
     * finding worse than blocker".
     *
     * The same shape as the screening gate that named the statuses blocking a
     * run, and `tests/the-floor-that-was-not-there.test.ts` now asks `pg_enum`
     * what the severities are, so the gap closes rather than being guarded.
     *
     * The dimension floor above already decided this question for the case of
     * a missing score: "a dimension the assessment did not produce is not a
     * pass. Silence about a requirement is the failure mode this whole product
     * exists to fix." Same answer here.
     */
    if (ceiling === undefined) {
      failures.push({
        rule: 'max_open_severity',
        explanation: `This profile permits open findings up to "${String(profile.maxOpenSeverity)}", which is not a severity this rubric uses, so the limit could not be applied and this application is not passed on it. Set the limit again and it will be.`,
      });
    } else {
      const over = subject.openFindings.filter(
        (finding) => SEVERITY_RANK[finding.severity] > ceiling,
      );
      if (over.length > 0) {
        const worst = over.reduce((a, b) =>
          SEVERITY_RANK[b.severity] > SEVERITY_RANK[a.severity] ? b : a,
        );
        failures.push({
          rule: 'max_open_severity',
          explanation: `${over.length} open finding${over.length === 1 ? '' : 's'} above the permitted ${profile.maxOpenSeverity} ceiling, the worst being a ${worst.severity}: ${worst.title}.`,
        });
      }
    }
  }

  if (profile.requireCertification && !subject.certificationEligible) {
    failures.push({
      rule: 'require_certification',
      explanation:
        'The profile requires an application that meets the rubric’s certification requirements, and this assessment does not.',
    });
  }

  if (profile.requireStoreReadiness) {
    const store = scores.get('store_distribution_readiness');
    if (!subject.intendedForAppStore) {
      failures.push({
        rule: 'require_store_readiness',
        explanation:
          'The profile requires store distribution readiness, and this application was not submitted as one intended for an app store.',
      });
    } else if (store === undefined) {
      failures.push({
        rule: 'require_store_readiness',
        explanation: 'Store distribution readiness was not scored in this assessment.',
      });
    }
  }

  return {
    profileId: profile.id,
    profileName: profile.name,
    assessmentId: subject.assessmentId,
    meetsPolicy: failures.length === 0,
    failures,
    note: POLICY_NOTE,
  };
}

export { SEVERITY_ORDER };
