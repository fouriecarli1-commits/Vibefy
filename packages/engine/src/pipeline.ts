/**
 * The assessment pipeline.
 *
 * Runs the stages in order, retrying the ones that fail for transient reasons
 * and never retrying the ones that hit a ceiling — a run stopped because it
 * reached its cost or scope limit is not a run that will succeed on a second
 * attempt, and retrying it would be spending money to break the same rule twice.
 *
 * What comes out is everything the database and the reviewer queue need: the
 * findings that survived evidence enforcement, the ones that did not and why,
 * the rubric score, the narrative, the evidence rows and the cost breakdown.
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
  readonly withheldFindings: readonly { title: string; reason: string }[];
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
  const withheld: { title: string; reason: string }[] = [];
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
  const notes = stageResults.flatMap((result) => result.notes);

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
    : stageResults.every((result) => result.status === 'failed')
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
    withheldFindings: withheld,
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
