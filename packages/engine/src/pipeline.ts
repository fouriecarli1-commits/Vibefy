/**
 * The assessment pipeline.
 *
 * Runs the stages in order, retrying the ones that fail for transient reasons
 * and never retrying the ones that hit a ceiling — a run stopped because it
 * reached its cost or scope limit is not a run that will succeed on a second
 * attempt, and retrying it would be spending money to break the same rule twice.
 *
 * What comes out is everything the database and the reviewer queue need: the
 * findings that survived evidence enforcement, the rubric score, the narrative,
 * the evidence rows and the cost breakdown.
 *
 * The claims that did *not* survive travel in the stage's notes, which reach the
 * report through `assessment_runs.metadata`, naming each one and saying it was
 * withheld for citing no evidence we captured. There used to be a
 * `withheldFindings` field here promising the same thing in a structured form;
 * nothing ever wrote to it, so it was always empty, and an always-empty typed
 * field is a claim about the system that is not true.
 */
import { scoreAssessment, type ScoringInput, type ScoringResult } from '@vibefycode/rubric';
import { scopeStatement, NON_RELIANCE_LEGEND, AI_DISCLOSURE } from '@vibefycode/shared';
import type { CostRecord } from './runtime/cost.ts';
import { classifyStop, stopNote, STOP_LABEL, type StopReason } from './runtime/stop.ts';
import { promptBundleSha256 } from './model/prompts.ts';
import { staticIntakeStage } from './stages/static-intake.ts';
import { deterministicChecksStage } from './stages/deterministic.ts';
import {
  adversarialPracticalityStage,
  functionalExplorationStage,
  gameExperienceStage,
  storeReadinessStage,
} from './stages/model-stages.ts';
import { synthesise, type ReportNarrative } from './stages/synthesis.ts';
import type { EvidenceArtefact } from './runtime/evidence.ts';
import type { RawFinding, Stage, StageContext, StageResult } from './stages/types.ts';

export const DEFAULT_STAGES: readonly Stage[] = [
  staticIntakeStage,
  deterministicChecksStage,
  functionalExplorationStage,
  adversarialPracticalityStage,
  gameExperienceStage,
  storeReadinessStage,
];

export type AssessmentStatus = 'completed' | 'aborted' | 'failed';

export interface AssessmentOutcome {
  readonly assessmentId: string;
  readonly status: AssessmentStatus;
  /**
   * Why the run stopped, on an aborted run, and null on every other.
   *
   * An aborted run used to be written down as a failed one, which told the
   * customer their application had broken something when in fact the run had
   * reached a limit and stopped on purpose. The three limits are not
   * interchangeable either: one is our spending cap, one is the intensity they
   * authorised, and one is the scope boundary refusing to go somewhere.
   */
  readonly stopReason: StopReason | null;
  readonly rubricVersion: string;
  readonly promptBundleSha256: string;
  readonly stageResults: readonly StageResult[];
  readonly findings: readonly RawFinding[];
  readonly score: ScoringResult;
  readonly narrative: ReportNarrative | null;
  readonly evidence: readonly Omit<EvidenceArtefact, 'body'>[];
  readonly costByStage: Readonly<Record<string, CostRecord>>;
  readonly totalCostUsd: number;
  readonly scopeStatement: string;
  readonly nonRelianceLegend: string;
  readonly aiDisclosure: string;
  readonly notes: readonly string[];
  /**
   * How hard it was to find the way out, or null where nothing measured it.
   *
   * Deliberately beside the score rather than inside it. A rubric score is what
   * an assessment found against published criteria; this has its own published
   * weights, and mixing them would make both mean less.
   */
  readonly exitMeasurement: unknown | null;
}

export interface RunPipelineOptions {
  readonly context: StageContext;
  readonly rubricVersion?: string;
  readonly stages?: readonly Stage[];
  readonly maxAttemptsPerStage?: number;
  readonly assessedOn?: string;
}

export async function runPipeline(options: RunPipelineOptions): Promise<AssessmentOutcome> {
  const { context } = options;
  const rubricVersion = options.rubricVersion ?? '1.0.0';
  const stages = options.stages ?? DEFAULT_STAGES;
  const maxAttempts = options.maxAttemptsPerStage ?? 2;

  const stageResults: StageResult[] = [];
  let stopped: StopReason | null = null;

  for (const stage of stages) {
    if (stopped) {
      stageResults.push({
        stage: stage.id,
        status: 'skipped',
        findings: [],
        notes: [`Skipped: the run ${STOP_LABEL[stopped]} at an earlier stage and stopped.`],
      });
      continue;
    }
    if (!stage.appliesTo(context)) {
      stageResults.push({
        stage: stage.id,
        status: 'skipped',
        findings: [],
        notes: [
          `Skipped: ${
            stage.skipReason?.(context) ??
            `this stage does not apply to a ${context.target.appType} assessment at ${context.depth} depth`
          }.`,
        ],
      });
      continue;
    }

    const result = await runStageWithRetry(stage, context, maxAttempts);
    stageResults.push(result);
    if (result.status === 'aborted') stopped = result.stopReason;
  }

  const findings = stageResults.flatMap((result) => result.findings);
  const notes: string[] = stageResults.flatMap((result) => result.notes);

  const functional = stageResults.find((result) => result.stage === 'functional_exploration');
  const coreFlowsUnreachable =
    functional !== undefined &&
    functional.status !== 'skipped' &&
    functional.coreFlowsReached === false;

  // The scoring input carries findings and nothing else. It has no field for the
  // customer's plan, and packages/rubric would fail to compile if it did.
  const scoringInput: ScoringInput = {
    rubricVersion,
    coreFlowsUnreachable,
    findings: findings.map((finding) => ({
      ruleId: finding.ruleId,
      dimension: finding.dimension,
      severity: finding.severity,
      confidence: finding.confidence,
      isPublished: true,
    })),
  };
  const score = scoreAssessment(scoringInput);

  // Worked out before synthesis is appended, and counting only the stages that
  // were actually asked to run.
  //
  // The old rule was `stageResults.every(r => r.status === 'failed')`, which one
  // skipped stage defeats — and there is essentially always a skipped stage,
  // because `appliesTo` skips the game pass for a web application and several
  // others by depth. So `failed` was close to unreachable, and a run in which
  // every stage that executed had failed came out as `completed`.
  //
  // That is the worst artefact this pipeline can produce. No stage ran, so there
  // are no findings; no findings means no penalty; no penalty means a score of
  // 100, no gates applied and `certificationEligible: true`. A target that was
  // unreachable from first request to last would have arrived in the review
  // queue looking like a flawless application.
  const executed = stageResults.filter((result) => result.status !== 'skipped');
  const nothingRan = executed.length === 0;
  const nothingSucceeded = !executed.some((result) => result.status === 'succeeded');
  const failedStages = executed.filter((result) => result.status === 'failed');
  if (failedStages.length > 0) {
    notes.push(
      `${failedStages.length} of ${executed.length} stage(s) that ran did not complete: ` +
        `${failedStages.map((result) => result.stage).join(', ')}. What the other stages found ` +
        `still stands, and what they did not look at is not evidence that there was nothing to find.`,
    );
  }

  let narrative: ReportNarrative | null = null;
  if (!stopped) {
    try {
      const synthesis = await synthesise(context, stageResults);
      narrative = synthesis.narrative;
      stageResults.push({
        stage: 'synthesis',
        status: narrative ? 'succeeded' : 'failed',
        findings: [],
        notes: narrative ? [] : ['Synthesis produced no narrative.'],
        promptSha256: synthesis.promptSha256,
      });
    } catch (error) {
      stageResults.push({
        stage: 'synthesis',
        status: 'failed',
        findings: [],
        notes: [
          'The report narrative could not be composed; the findings and score below still stand.',
        ],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const status: AssessmentStatus = stopped
    ? 'aborted'
    : nothingRan || nothingSucceeded
      ? 'failed'
      : 'completed';

  return {
    assessmentId: context.assessmentId,
    status,
    stopReason: stopped,
    rubricVersion,
    promptBundleSha256: promptBundleSha256(),
    stageResults,
    findings,
    score,
    narrative,
    evidence: context.evidence.toRows(),
    costByStage: context.meter.summariseByStage(),
    totalCostUsd: Number(context.meter.totalUsd.toFixed(6)),
    scopeStatement: scopeStatement({
      appName: context.target.appName,
      rubricVersion,
      assessedOn: options.assessedOn ?? new Date().toISOString().slice(0, 10),
    }),
    nonRelianceLegend: NON_RELIANCE_LEGEND,
    aiDisclosure: AI_DISCLOSURE,
    notes,
    exitMeasurement:
      stageResults.find((result) => result.exitMeasurement !== undefined)?.exitMeasurement ?? null,
  };
}

async function runStageWithRetry(
  stage: Stage,
  context: StageContext,
  maxAttempts: number,
): Promise<StageResult> {
  let last: StageResult | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await stage.run(context);
      // A ceiling is a decision, not a fault. Retrying it would spend money to
      // break the same rule a second time.
      if (
        result.status === 'aborted' ||
        result.status === 'succeeded' ||
        result.status === 'skipped'
      ) {
        return attempt === 1
          ? result
          : { ...result, notes: [...result.notes, `Succeeded on attempt ${attempt}.`] };
      }
      last = result;
    } catch (error) {
      // Three different events, and until now one word for all of them. A run
      // that reached its spending limit, one that used up the intensity the
      // customer authorised, and one that was turned back at the scope boundary
      // each need a different answer from whoever reads this afterwards.
      const stopReason = classifyStop(error);
      if (stopReason) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          stage: stage.id,
          status: 'aborted',
          stopReason,
          findings: [],
          notes: [stopNote(stopReason, stage.id, message)],
          error: message,
        };
      }
      last = {
        stage: stage.id,
        status: 'failed',
        findings: [],
        notes: [`Attempt ${attempt} failed.`],
        error: error instanceof Error ? error.message : String(error),
      };
    }
    context.log(`Stage ${stage.id} attempt ${attempt} did not succeed; retrying.`);
  }

  return (
    last ?? {
      stage: stage.id,
      status: 'failed',
      findings: [],
      notes: ['The stage produced no result.'],
    }
  );
}
