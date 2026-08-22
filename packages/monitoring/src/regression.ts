/**
 * When a change is bad enough to take the badge down.
 *
 * The rules are data, not branches, for three reasons: they have to be quotable
 * in an appeal, they have to be identical for every customer, and they have to
 * be changeable without touching the code that applies them. Each rule carries
 * the sentence a customer is shown when it fires.
 *
 * The bias is deliberate and one-directional. Suspension is reversible and a
 * false badge is not, so a rule that is unsure fires — but every firing has to
 * name itself, and `drift_reports.regression_reasons` is a NOT NULL, non-empty
 * column precisely so a suspension without a stated reason cannot be written.
 */
import { severityRank } from './drift.ts';
import type { Drift, MonitoredDimension, MonitoredSeverity } from './types.ts';

export interface MaterialityPolicy {
  /** A drop of at least this many overall points is material on its own. */
  readonly scoreDropPoints: number;
  /** Severities that count as a serious new finding. */
  readonly seriousSeverities: readonly MonitoredSeverity[];
  /** Dimensions where a serious new finding is material regardless of the score. */
  readonly sensitiveDimensions: readonly MonitoredDimension[];
  /** A dimension falling below its floor is material. Mirrors the rubric's certification floors. */
  readonly dimensionFloors: Readonly<Partial<Record<MonitoredDimension, number>>>;
  /** The overall score a certified application is expected to hold. */
  readonly certificationThreshold: number;
}

/**
 * Defaults mirror rubric 1.0.0's certification gate. They are restated here
 * rather than imported so that changing the rubric cannot silently change what
 * suspends a live badge; the worker passes the rubric's own numbers when it
 * wants them to move together.
 */
export const DEFAULT_MATERIALITY_POLICY: MaterialityPolicy = {
  scoreDropPoints: 8,
  seriousSeverities: ['critical', 'high'],
  sensitiveDimensions: ['security_posture', 'data_privacy_practice'],
  dimensionFloors: {
    security_posture: 65,
    data_privacy_practice: 60,
    functional_integrity: 60,
  },
  certificationThreshold: 70,
};

export type RegressionRuleId =
  | 'certification_lost'
  | 'serious_new_security_finding'
  | 'serious_escalation'
  | 'score_drop'
  | 'score_below_certification_threshold'
  | 'dimension_below_floor';

export interface RegressionReason {
  readonly rule: RegressionRuleId;
  /** One sentence, written for the owner of the application, not for us. */
  readonly explanation: string;
}

export interface MaterialityVerdict {
  readonly material: boolean;
  readonly reasons: readonly RegressionReason[];
  /** True when the badge should be suspended now rather than merely flagged. */
  readonly suspendBadge: boolean;
  /** Set when the comparison itself is not a fair basis for a decision. */
  readonly withheldBecause: string | null;
}

interface RegressionRule {
  readonly id: RegressionRuleId;
  readonly evaluate: (drift: Drift, policy: MaterialityPolicy) => string | null;
}

function list(titles: readonly string[], limit = 3): string {
  const shown = titles.slice(0, limit);
  const rest = titles.length - shown.length;
  return rest > 0 ? `${shown.join('; ')} (and ${rest} more)` : shown.join('; ');
}

const RULES: readonly RegressionRule[] = [
  {
    id: 'certification_lost',
    evaluate: (drift) =>
      drift.certificationLost
        ? 'This application no longer meets the certification requirements it met at its last assessment.'
        : null,
  },
  {
    id: 'serious_new_security_finding',
    evaluate: (drift, policy) => {
      const serious = drift.newFindings.filter(
        (finding) =>
          policy.sensitiveDimensions.includes(finding.dimension) &&
          policy.seriousSeverities.includes(finding.severity),
      );
      if (serious.length === 0) return null;
      return `A new ${serious[0]!.severity} finding was raised against ${serious[0]!.dimension.replace(/_/g, ' ')}: ${list(serious.map((finding) => finding.title))}.`;
    },
  },
  {
    id: 'serious_escalation',
    evaluate: (drift, policy) => {
      const escalated = drift.escalatedFindings.filter(
        (finding) =>
          policy.seriousSeverities.includes(finding.severity) &&
          !policy.seriousSeverities.includes(finding.wasSeverity) &&
          severityRank(finding.severity) > severityRank(finding.wasSeverity),
      );
      if (escalated.length === 0) return null;
      return `An existing finding became more serious (${escalated[0]!.wasSeverity} to ${escalated[0]!.severity}): ${list(escalated.map((finding) => finding.title))}.`;
    },
  },
  {
    id: 'score_drop',
    evaluate: (drift, policy) =>
      drift.scoreDelta <= -policy.scoreDropPoints
        ? `The overall score fell by ${Math.abs(drift.scoreDelta).toFixed(1)} points, from ${drift.scoreBefore.toFixed(1)} to ${drift.scoreAfter.toFixed(1)}.`
        : null,
  },
  {
    id: 'score_below_certification_threshold',
    evaluate: (drift, policy) =>
      drift.scoreBefore >= policy.certificationThreshold &&
      drift.scoreAfter < policy.certificationThreshold
        ? `The overall score fell below the certification threshold of ${policy.certificationThreshold}, to ${drift.scoreAfter.toFixed(1)}.`
        : null,
  },
  {
    id: 'dimension_below_floor',
    evaluate: (drift, policy) => {
      const breached = drift.dimensionDeltas.filter((entry) => {
        const floor = policy.dimensionFloors[entry.dimension];
        return floor !== undefined && entry.before >= floor && entry.after < floor;
      });
      if (breached.length === 0) return null;
      const first = breached[0]!;
      return `${first.dimension.replace(/_/g, ' ')} fell below its floor of ${policy.dimensionFloors[first.dimension]}, to ${first.after.toFixed(1)}.`;
    },
  },
];

/**
 * Applies every rule and reports all of them, not the first.
 *
 * A suspension notice that lists one of four problems invites a customer to fix
 * that one and ask why the badge is still down.
 */
export function assessMateriality(
  drift: Drift,
  policy: MaterialityPolicy = DEFAULT_MATERIALITY_POLICY,
): MaterialityVerdict {
  const reasons: RegressionReason[] = [];
  for (const rule of RULES) {
    const explanation = rule.evaluate(drift, policy);
    if (explanation) reasons.push({ rule: rule.id, explanation });
  }

  // A score that moved because we changed the standard is our movement, not the
  // customer's, and may not cost them a badge. It is still reported to them.
  if (!drift.comparable) {
    return {
      material: false,
      reasons,
      suspendBadge: false,
      withheldBecause:
        'These two assessments were scored against different rubric versions, so the change is not attributable to the application. A badge is never suspended on a rubric change.',
    };
  }

  return {
    material: reasons.length > 0,
    reasons,
    suspendBadge: reasons.length > 0,
    withheldBecause: null,
  };
}

export const REGRESSION_RULE_IDS: readonly RegressionRuleId[] = RULES.map((rule) => rule.id);
