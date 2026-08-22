/**
 * What monitoring is allowed to know.
 *
 * The same boundary as scoring, for the same reason. A drift report is what
 * justifies taking a badge down, and "we suspended it because they stopped
 * paying" and "we suspended it because the application got worse" must never be
 * the same code path. So the comparison input has no field for a plan, a price
 * or a marketing relationship, and the compile-time assertion at the bottom of
 * this file fails the build if someone adds one.
 *
 * Cadence — how *often* a paying customer is re-assessed — is coverage, not a
 * verdict, and lives in `schedule.ts` where it can see a plan. Nothing in
 * `drift.ts` or `regression.ts` can.
 */

export type MonitoredDimension =
  | 'functional_integrity'
  | 'security_posture'
  | 'data_privacy_practice'
  | 'practicality_ux'
  | 'production_readiness'
  | 'store_distribution_readiness';

export type MonitoredSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * A finding as the comparison sees it.
 *
 * `key` is what makes two findings across two assessments "the same finding".
 * It is the rubric rule plus the dimension — not the title, which is model-
 * written prose and would make a reworded sentence look like a fixed bug.
 */
export interface ComparableFinding {
  readonly ruleId: string;
  readonly dimension: MonitoredDimension;
  readonly severity: MonitoredSeverity;
  readonly title: string;
  readonly isPublished: boolean;
}

export interface ComparableDimension {
  readonly dimension: MonitoredDimension;
  readonly score: number;
}

/** One assessment, reduced to the facts a comparison needs. */
export interface AssessmentSnapshot {
  readonly assessmentId: string;
  readonly assessedAt: Date;
  readonly rubricVersion: string;
  readonly overallScore: number;
  readonly certificationEligible: boolean;
  readonly dimensions: readonly ComparableDimension[];
  readonly findings: readonly ComparableFinding[];
}

export interface DimensionDelta {
  readonly dimension: MonitoredDimension;
  readonly before: number;
  readonly after: number;
  readonly delta: number;
}

export interface FindingChange {
  readonly key: string;
  readonly ruleId: string;
  readonly dimension: MonitoredDimension;
  readonly severity: MonitoredSeverity;
  readonly title: string;
}

export interface Drift {
  readonly previousAssessmentId: string;
  readonly assessmentId: string;
  readonly scoreBefore: number;
  readonly scoreAfter: number;
  readonly scoreDelta: number;
  readonly dimensionDeltas: readonly DimensionDelta[];
  readonly newFindings: readonly FindingChange[];
  readonly resolvedFindings: readonly FindingChange[];
  readonly persistingFindings: readonly FindingChange[];
  /** Severity raised on a finding that was already there. */
  readonly escalatedFindings: readonly (FindingChange & { readonly wasSeverity: MonitoredSeverity })[];
  readonly certificationBefore: boolean;
  readonly certificationAfter: boolean;
  readonly certificationLost: boolean;
  /** True when the two assessments were scored against different rubric versions. */
  readonly rubricVersionChanged: boolean;
  readonly comparable: boolean;
}

// ---------------------------------------------------------------------------
// Structural enforcement — the same guard as packages/rubric/src/types.ts
// ---------------------------------------------------------------------------

type CommercialKey =
  | 'plan'
  | 'planTier'
  | 'tier'
  | 'price'
  | 'priceId'
  | 'amount'
  | 'amountPaid'
  | 'amountPaidCents'
  | 'spend'
  | 'depth'
  | 'subscription'
  | 'subscriptionId'
  | 'subscriptionStatus'
  | 'invoice'
  | 'invoiceId'
  | 'stripeCustomerId'
  | 'isMarketingClient'
  | 'marketingClient'
  | 'isPaying'
  | 'accountType'
  | 'seats'
  | 'currency';

type FreeOfCommercialInfluence<T> = Extract<keyof T, CommercialKey> extends never ? true : never;

const _snapshotIsClean: FreeOfCommercialInfluence<AssessmentSnapshot> = true;
const _findingIsClean: FreeOfCommercialInfluence<ComparableFinding> = true;
const _driftIsClean: FreeOfCommercialInfluence<Drift> = true;

export const MONITORING_BOUNDARY_ASSERTED =
  _snapshotIsClean && _findingIsClean && _driftIsClean;
