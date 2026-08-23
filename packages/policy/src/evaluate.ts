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

const SEVERITY_RANK: Readonly<Record<PolicySeverity, number>> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const SEVERITY_ORDER: readonly PolicySeverity[] = ['info', 'low', 'medium', 'high', 'critical'];

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
