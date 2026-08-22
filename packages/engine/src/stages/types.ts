/**
 * Stage contracts.
 *
 * Every pipeline stage is independently retryable and independently logged, so
 * each one takes the same context, returns the same shape, and never reaches
 * outside it. A stage cannot open its own network connection, spend money the
 * meter did not authorise, or publish a finding without attaching evidence.
 */
import type { RubricDimensionId, FindingSeverity, ConfidenceLevel } from '@vibefy/rubric';
import type { ScopeGuard } from '../runtime/scope.ts';
import type { CostMeter } from '../runtime/cost.ts';
import type { ModelClient } from '../model/client.ts';
import type { EvidenceStore } from '../runtime/evidence.ts';

export type StageId =
  | 'static_intake'
  | 'deterministic_checks'
  | 'functional_exploration'
  | 'adversarial_practicality'
  | 'store_readiness'
  | 'synthesis';

export type AssessmentDepth = 'limited' | 'full' | 'continuous';

export interface AssessmentTarget {
  readonly appId: string;
  readonly organisationId: string;
  readonly appName: string;
  readonly appType: 'web_url' | 'repository' | 'mobile_build';
  readonly primaryUrl: string | null;
  /** Local path to the checked-out repository, when the tier includes source. */
  readonly repositoryPath: string | null;
  readonly intendedForAppStore: boolean;
  readonly hasAuthentication: boolean;
  readonly hasPayments: boolean;
  readonly processesPersonalData: boolean;
  readonly description: string | null;
}

/**
 * Credentials for a dedicated test account the customer provisioned. The engine
 * never asks for, accepts or stores credentials for a real user account.
 */
export interface SyntheticCredentials {
  readonly email: string;
  readonly password: string;
}

export interface StageContext {
  readonly assessmentId: string;
  readonly target: AssessmentTarget;
  readonly depth: AssessmentDepth;
  readonly guard: ScopeGuard;
  readonly meter: CostMeter;
  readonly model: ModelClient;
  readonly evidence: EvidenceStore;
  readonly syntheticCredentials?: SyntheticCredentials | undefined;
  readonly log: (message: string, detail?: Record<string, unknown>) => void;
}

export interface RawFinding {
  readonly ruleId: string;
  readonly dimension: RubricDimensionId;
  readonly severity: FindingSeverity;
  readonly confidence: ConfidenceLevel;
  readonly title: string;
  readonly description: string;
  readonly remediation: string;
  /** Ids from the evidence store. A finding with none of these is withheld. */
  readonly evidenceIds: readonly string[];
}

export type StageStatus = 'succeeded' | 'skipped' | 'failed' | 'aborted';

export interface StageResult {
  readonly stage: StageId;
  readonly status: StageStatus;
  readonly findings: readonly RawFinding[];
  readonly notes: readonly string[];
  /** False when the authorised scope did not permit exercising the core flows. */
  readonly coreFlowsReached?: boolean;
  readonly error?: string;
  readonly promptSha256?: string;
}

export interface Stage {
  readonly id: StageId;
  /** Stages opt out cleanly rather than half-running. */
  appliesTo(context: StageContext): boolean;
  run(context: StageContext): Promise<StageResult>;
}

export function skipped(stage: StageId, reason: string): StageResult {
  return { stage, status: 'skipped', findings: [], notes: [reason] };
}
