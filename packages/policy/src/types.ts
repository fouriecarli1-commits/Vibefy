/**
 * An organisation's own bar.
 *
 * The distinction this package exists to hold: the rubric says what an
 * application *is*, and a policy profile says whether that is good enough *for
 * this organisation*. A university may require 80 where the rubric certifies at
 * 70; a bank may refuse anything with an open high-severity privacy finding
 * whatever the total says.
 *
 * A profile can therefore fail an application the rubric passed. It can never do
 * the reverse, and it can never move a number — the evaluation result below has
 * no score field at all, and the compile-time assertion at the bottom of this
 * file fails the build if one is added.
 */

export type PolicyDimension =
  | 'functional_integrity'
  | 'security_posture'
  | 'data_privacy_practice'
  | 'practicality_ux'
  | 'production_readiness'
  | 'store_distribution_readiness';

export type PolicySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface PolicyProfile {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly minOverallScore: number | null;
  readonly dimensionFloors: Readonly<Partial<Record<PolicyDimension, number>>>;
  /** The worst open finding the organisation tolerates. Null means no limit. */
  readonly maxOpenSeverity: PolicySeverity | null;
  readonly requireCertification: boolean;
  readonly requireStoreReadiness: boolean;
}

/** The assessment, as a policy is allowed to see it: outcomes only. */
export interface PolicySubject {
  readonly assessmentId: string;
  readonly overallScore: number;
  readonly certificationEligible: boolean;
  readonly dimensions: readonly { readonly dimension: PolicyDimension; readonly score: number }[];
  readonly openFindings: readonly {
    readonly ruleId: string;
    readonly dimension: PolicyDimension;
    readonly severity: PolicySeverity;
    readonly title: string;
  }[];
  readonly intendedForAppStore: boolean;
}

export type PolicyRuleId =
  | 'min_overall_score'
  | 'dimension_floor'
  | 'max_open_severity'
  | 'require_certification'
  | 'require_store_readiness';

export interface PolicyFailure {
  readonly rule: PolicyRuleId;
  /** Written for the engineer who has to fix it, not for the person who set the bar. */
  readonly explanation: string;
}

export interface PolicyEvaluation {
  readonly profileId: string;
  readonly profileName: string;
  readonly assessmentId: string;
  readonly meetsPolicy: boolean;
  readonly failures: readonly PolicyFailure[];
  /** Stated on every evaluation, because the difference is the whole point. */
  readonly note: string;
}

// ---------------------------------------------------------------------------
// Structural enforcement
// ---------------------------------------------------------------------------

/** Anything through which a policy could change what an application scored. */
type ScoreMutatingKey =
  | 'overallScore'
  | 'score'
  | 'adjustedScore'
  | 'scoreAdjustment'
  | 'bonus'
  | 'penalty'
  | 'band'
  | 'dimensionScores'
  | 'certificationEligible';

type CannotChangeAScore<T> = Extract<keyof T, ScoreMutatingKey> extends never ? true : never;

const _evaluationCannotScore: CannotChangeAScore<PolicyEvaluation> = true;
const _failureCannotScore: CannotChangeAScore<PolicyFailure> = true;

export const POLICY_BOUNDARY_ASSERTED = _evaluationCannotScore && _failureCannotScore;
