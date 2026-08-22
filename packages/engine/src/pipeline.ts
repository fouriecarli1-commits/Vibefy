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
import { scoreAssessment, type ScoringInput, type ScoringResult } from '@vibefy/rubric';
import { scopeStatement, NON_RELIANCE_LEGEND, AI_DISCLOSURE } from '@vibefy/shared';
import { CostCeilingExceededError, type CostRecord } from './runtime/cost.ts';
import { CeilingExceededError, ScopeViolationError } from './runtime/scope.ts';
import { promptBundleSha256 } from './model/prompts.ts';
import { staticIntakeStage } from './stages/static-intake.ts';
import { deterministicChecksStage } from './stages/deterministic.ts';
import {
  adversarialPracticalityStage,
  functionalExplorationStage,
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
  storeReadinessStage,
];

export type AssessmentStatus = 'completed' | 'aborted' | 'failed';

export interface AssessmentOutcome {
  readonly assessmentId: string;
  readonly status: AssessmentStatus;
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
  let aborted = false;

  for (const stage of stages) {
    if (aborted) {
      stageResults.push({
        stage: stage.id,
        status: 'skipped',
        findings: [],
        notes: ['Skipped: an earlier stage reached a ceiling and the run stopped.'],
      });
      continue;
    }
    if (!stage.appliesTo(context)) {
      stageResults.push({
        stage: stage.id,
        status: 'skipped',
        findings: [],
        notes: [
          `Skipped: this stage does not apply to a ${context.target.appType} assessment at ${context.depth} depth.`,
        ],
      });
      continue;
    }

    const result = await runStageWithRetry(stage, context, maxAttempts);
    stageResults.push(result);
    if (result.status === 'aborted') aborted = true;
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
  if (!aborted) {
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

  const status: AssessmentStatus = aborted
    ? 'aborted'
    : stageResults.every((result) => result.status === 'failed')
      ? 'failed'
      : 'completed';

  return {
    assessmentId: context.assessmentId,
    status,
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
      if (
        error instanceof CostCeilingExceededError ||
        error instanceof CeilingExceededError ||
        error instanceof ScopeViolationError
      ) {
        return {
          stage: stage.id,
          status: 'aborted',
          findings: [],
          notes: [`The run stopped at a ceiling during ${stage.id}: ${error.message}`],
          error: error.message,
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
