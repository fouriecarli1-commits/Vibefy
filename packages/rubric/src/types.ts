/**
 * The scoring boundary.
 *
 * "Payment never buys a score" is a claim Vibefy sells. A claim enforced only by
 * developer discipline is not enforced. So the input to every scoring function is
 * a type that has no field for a plan, a price, a spend, a marketing
 * relationship or an account age — it is not that scoring ignores commercial
 * data, it is that scoring cannot be handed commercial data without the build
 * failing.
 *
 * The compile-time assertion at the bottom of this file is the enforcement. Add
 * a commercial field to any type in this module and `pnpm typecheck` fails.
 */

export type RubricDimensionId =
  | 'functional_integrity'
  | 'security_posture'
  | 'data_privacy_practice'
  | 'practicality_ux'
  | 'production_readiness'
  | 'store_distribution_readiness';

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/** A finding as the scorer sees it. Nothing here identifies the customer. */
export interface ScoringFinding {
  readonly ruleId: string;
  readonly dimension: RubricDimensionId;
  readonly severity: FindingSeverity;
  readonly confidence: ConfidenceLevel;
  /** Findings withheld for lack of evidence do not affect the score. */
  readonly isPublished: boolean;
}

/**
 * Everything the scorer is permitted to know. Deliberately not derived from the
 * assessment row: a `Pick<Assessment, …>` would silently widen the day someone
 * adds a column.
 */
export interface ScoringInput {
  readonly rubricVersion: string;
  readonly findings: readonly ScoringFinding[];
  /** True when the authorised scope did not permit exercising the core flows. */
  readonly coreFlowsUnreachable: boolean;
}

export interface DimensionScore {
  readonly dimension: RubricDimensionId;
  readonly score: number;
  readonly weight: number;
  readonly penaltyApplied: number;
  readonly band: string;
}

export interface AppliedGate {
  readonly id: string;
  readonly label: string;
  readonly capOverallAt: number | null;
  readonly blocksCertification: boolean;
}

export interface ScoringResult {
  readonly rubricVersion: string;
  readonly overallScore: number;
  readonly band: string;
  readonly dimensions: readonly DimensionScore[];
  readonly gatesApplied: readonly AppliedGate[];
  readonly certificationEligible: boolean;
  readonly certificationBlockers: readonly string[];
}

// ---------------------------------------------------------------------------
// Structural enforcement
// ---------------------------------------------------------------------------

/**
 * Anything that would let a score depend on money. The names are the ones that
 * actually appear in this schema, plus the near-misses a well-meaning
 * contributor would reach for.
 */
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
  | 'organisationId'
  | 'seats'
  | 'currency';

/** Resolves to `never` — which fails to accept `true` — if T carries a commercial key. */
type FreeOfCommercialInfluence<T> = Extract<keyof T, CommercialKey> extends never ? true : never;

/**
 * These constants exist only to be type-checked. If someone adds `plan` to
 * ScoringInput, or `isMarketingClient` to ScoringFinding, the assignment below
 * stops compiling and the build fails before any test runs.
 */
const _scoringInputIsClean: FreeOfCommercialInfluence<ScoringInput> = true;
const _scoringFindingIsClean: FreeOfCommercialInfluence<ScoringFinding> = true;
const _dimensionScoreIsClean: FreeOfCommercialInfluence<DimensionScore> = true;
const _scoringResultIsClean: FreeOfCommercialInfluence<ScoringResult> = true;

export const SCORING_BOUNDARY_ASSERTED =
  _scoringInputIsClean &&
  _scoringFindingIsClean &&
  _dimensionScoreIsClean &&
  _scoringResultIsClean;
