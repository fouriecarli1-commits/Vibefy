/**
 * Stage contracts.
 *
 * Every pipeline stage is independently retryable and independently logged, so
 * each one takes the same context, returns the same shape, and never reaches
 * outside it. A stage cannot open its own network connection, spend money the
 * meter did not authorise, or publish a finding without attaching evidence.
 */
import type { RubricDimensionId, FindingSeverity, ConfidenceLevel } from '@vibefycode/rubric';
import type { ScopeGuard } from '../runtime/scope.ts';
import type { CostMeter } from '../runtime/cost.ts';
import type { StopReason } from '../runtime/stop.ts';
import type { ModelClient } from '../model/client.ts';
import type { EvidenceStore } from '../runtime/evidence.ts';

export type StageId =
  | 'static_intake'
  | 'deterministic_checks'
  | 'functional_exploration'
  | 'adversarial_practicality'
  | 'store_readiness'
  | 'game_experience'
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
  /**
   * Why the repository the customer declared is not on disk, where one was
   * declared and could not be fetched.
   *
   * The static stage's skip note says "no repository was provided", which is
   * true of an application that has none and false of one whose clone was
   * refused. The difference matters to the customer: the first is the scope
   * they chose and the second is a thing to fix.
   */
  readonly repositoryUnavailable?: string;
  readonly intendedForAppStore: boolean;
  /**
   * Whether the owner registered this as a game.
   *
   * Not a kind of target — a game is a web URL or a mobile build like anything
   * else. It is a kind of product, and it changes which stage runs and what
   * that stage is told to look for. It changes nothing about the rubric, the
   * score or the badge.
   */
  readonly isGame: boolean;
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

interface StageResultFields {
  readonly stage: StageId;
  readonly findings: readonly RawFinding[];
  readonly notes: readonly string[];
  /**
   * The exploring model's own judgement about whether it completed the core
   * flows. It cannot tell "the scope refused me" from "I ran out of turns" or
   * "the application is broken", so it is not on its own a reason to apply a
   * gate about authorisation coverage.
   */
  readonly coreFlowsReached?: boolean;
  /** Requests the authorised scope refused during this stage, excluding our own throttle. */
  readonly scopeRefusals?: number;
  /**
   * How hard the way out was to find, where a stage measured it.
   *
   * Carried out of the stage rather than turned into findings, because it is
   * not a defect against a published criterion — it is a separate measurement
   * with its own weights, and the schema keeps it away from anything that
   * reads a score.
   */
  readonly exitMeasurement?: unknown;
  /**
   * Criteria this run could not answer, with the reason in the words the
   * verification page should use.
   *
   * The page turns "no findings against this criterion" into a tick, so a
   * criterion nothing looked at renders as a pass. `rubricCriteria` already
   * stops that for a criterion the rubric does not define; this stops it for
   * one the rubric defines and this particular run did not reach.
   */
  readonly notTested?: readonly { readonly criterion: string; readonly because: string }[];
  readonly error?: string;
  readonly promptSha256?: string;
}

/**
 * A stage outcome, where an abort cannot happen without saying why.
 *
 * The union is the point. A spending limit, the intensity the customer
 * authorised and the scope boundary are three different events with three
 * different answers, and they were all recorded as the same word — so a stage
 * can no longer stop without naming which one it was, and the compiler is what
 * enforces it rather than a convention somebody has to remember.
 */
export type StageResult =
  | (StageResultFields & { readonly status: 'succeeded' | 'skipped' | 'failed' })
  | (StageResultFields & { readonly status: 'aborted'; readonly stopReason: StopReason });

export interface Stage {
  readonly id: StageId;
  /** Stages opt out cleanly rather than half-running. */
  appliesTo(context: StageContext): boolean;
  /**
   * Why this stage did not run, in its own words.
   *
   * The pipeline's default reason talks about the app type and the depth,
   * which was true of every stage until one opted out for a different reason
   * entirely. "This stage does not apply to a web_url assessment at full
   * depth" is not why the game pass was skipped, and a report that says it is
   * has told the customer something false about their own run.
   */
  skipReason?(context: StageContext): string;
  run(context: StageContext): Promise<StageResult>;
}

export function skipped(stage: StageId, reason: string): StageResult {
  return { stage, status: 'skipped', findings: [], notes: [reason] };
}
