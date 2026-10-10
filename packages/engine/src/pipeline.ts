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
import {
  getRubric,
  scoreAssessment,
  type ScoringInput,
  type ScoringResult,
} from '@vibefycode/rubric';
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
import { withoutACheck } from './stages/coverage.ts';
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
   * Criteria the rubric defines and this run did not answer.
   *
   * The verification page turns "no findings against this criterion" into a
   * tick, so a criterion nothing reached renders as a pass for something nobody
   * looked at. `rubricCriteria` already covers a criterion the rubric does not
   * define; this covers one this particular run could not test.
   */
  readonly notTestedCriteria: readonly { readonly criterion: string; readonly because: string }[];
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

/**
 * Criteria that cannot be observed from outside a signed-in session.
 *
 * Deliberately short. SEC-05 and SEC-07 are not here: the deterministic stage
 * probes administrative routes and API paths unauthenticated and does find
 * things, so calling them untested would be its own kind of false.
 */
const BEHIND_A_SIGN_IN = ['FI-02', 'FI-07', 'PRI-03', 'STR-03'] as const;

/**
 * Findings whose criterion names an evidence kind the finding does not carry.
 *
 * `requiredEvidence` is published. It is in `packages/rubric/versions`, it is
 * in the migration that publishes the rubric to the database, and a customer
 * can read it: FI-02, "sign-up and sign-in succeed and persist across
 * refresh", says it is evidenced by a `playwright_trace`. Nine of rubric
 * 1.1.0's criteria name one.
 *
 * Nothing read that field. The only test on it asserts every criterion names
 * at least one kind, which is a check that the field is populated rather than
 * honoured. And the stage that answers most of those nine — the functional
 * exploration — opens a browser, starts a trace, and throws it away in
 * `close()`: only the deterministic pass calls `captureTrace`. So a published
 * promise about how a finding is evidenced was kept by one stage out of four
 * and checked by nobody.
 *
 * This does not drop a finding. A defect that is real and evidenced by a
 * screenshot is still a defect, and withholding it over the kind of file
 * attached to it would be the gate serving itself rather than the customer.
 * It says so instead, in the notes the report already carries for things that
 * were not examined, and in the log, because which stage records what is ours
 * to fix.
 *
 * Grouped by criterion: ten findings against FI-02 are one sentence, not ten.
 */
export function evidenceShortfall(
  findings: readonly { readonly ruleId: string; readonly evidenceIds: readonly string[] }[],
  kindOf: (id: string) => string | undefined,
  rubricVersion: string,
): { criterion: string; missing: string[] }[] {
  const required = new Map<string, readonly string[]>();
  for (const dimension of getRubric(rubricVersion).dimensions) {
    for (const criterion of dimension.criteria) {
      required.set(criterion.id, criterion.requiredEvidence);
    }
  }

  const shortfall = new Map<string, Set<string>>();
  for (const finding of findings) {
    const wanted = required.get(finding.ruleId);
    if (wanted === undefined || wanted.length === 0) continue;
    const carried = new Set(
      finding.evidenceIds
        .map((id) => kindOf(id))
        .filter((kind): kind is string => kind !== undefined),
    );
    const missing = wanted.filter((kind) => !carried.has(kind));
    if (missing.length === 0) continue;
    const already = shortfall.get(finding.ruleId) ?? new Set<string>();
    for (const kind of missing) already.add(kind);
    shortfall.set(finding.ruleId, already);
  }

  return [...shortfall.entries()]
    .map(([criterion, kinds]) => ({ criterion, missing: [...kinds].sort() }))
    .sort((a, b) => a.criterion.localeCompare(b.criterion));
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

  const notes: string[] = stageResults.flatMap((result) => result.notes);
  const notTested: { criterion: string; because: string }[] = [];

  /*
   * The criterion id, written the way the rubric writes it.
   *
   * `findingSchema` enumerates `dimension` and `severity`; `ruleId` is the one
   * free string, described to the model as "for example SEC-05 or FI-01". A
   * deterministic stage writes it as a literal and is always right. A model
   * stage picks it, and `assuranceFor` matches a finding to a claim with
   * `claim.criteria.includes` — so `SEC-4` instead of `SEC-04` belongs to no
   * claim, appears nowhere on the page, and leaves "are its keys exposed?"
   * reading as a tick over a critical finding saying they are. Measured; one
   * missing zero. `GATE-EXPOSED-SECRET` names SEC-04 by hand too, so it also
   * does not fire.
   *
   * Done here rather than in the stage because it is one place for every stage,
   * and because the rubric version is a fact about the run.
   */
  const knownCriteria = getRubric(rubricVersion).dimensions.flatMap((dimension) =>
    dimension.criteria.map((criterion) => criterion.id),
  );
  const placement = placeCriteria(
    stageResults.flatMap((result) => result.findings),
    knownCriteria,
  );
  const findings = placement.placed;
  if (placement.corrected.length > 0) {
    notes.push(
      `${placement.corrected.length} finding(s) named their criterion in a form the rubric does not use and were filed against the criterion they meant (${placement.corrected
        .map((entry) => `${entry.from} → ${entry.to}`)
        .join(', ')}).`,
    );
  }
  if (placement.unplaceable.length > 0) {
    // Not dropped: the finding is real and its dimension scores it. But no
    // claim carries it, so the only honest thing is to say so — a finding that
    // reaches the report and not the public list is the kind of gap this
    // product exists to refuse in other people's software.
    notes.push(
      `${placement.unplaceable.length} criterion id(s) in this run match nothing in rubric ${rubricVersion} (${placement.unplaceable.join(', ')}). The findings against them are reported and scored in their dimension, and no plain-language claim carries them.`,
    );
  }

  /*
   * The half of an application that is behind a sign-in.
   *
   * `syntheticCredentials` is on the context, `fill` refuses to type into a
   * password field without it, and nothing has ever given it any: the worker's
   * job carries an optional field that no caller sets and no queue row holds.
   * So every application whose owner told us it has authentication has been
   * assessed entirely signed out — and four published criteria cannot be
   * observed from outside a session at all.
   *
   * Nothing found against them meant no findings, and no findings renders as a
   * tick. Said here rather than in a stage, because it is a fact about the run
   * and not about any one of them.
   */
  /*
   * The criteria nothing asks a question about.
   *
   * Ten of rubric 1.1.0's forty-nine are emitted by no check in this engine and
   * described in none of the prompts — seven always, and three more for
   * anything the owner did not register as a game. `stages/coverage.ts` holds
   * the measurement. Nothing could ever deduct for them, so they did not merely
   * go unanswered: they scored full marks on every assessment, and the published
   * questions they sit under ticked on their behalf.
   *
   * Said here, once, for the same reason the sign-in criteria below are: it is
   * a fact about what this engine does rather than about any one stage, and no
   * stage was going to say it on the way past.
   */
  notTested.push(...withoutACheck(context.target.isGame));

  const shortfall = evidenceShortfall(
    findings,
    (id) => context.evidence.byId(id)?.kind,
    rubricVersion,
  );
  if (shortfall.length > 0) {
    context.log('findings carry less than the rubric names as their evidence', {
      assessmentId: context.assessmentId,
      rubricVersion,
      shortfall: shortfall.map((entry) => `${entry.criterion} wants ${entry.missing.join(', ')}`),
    });
    notes.push(
      `The published rubric names an evidence kind for each criterion. ${shortfall
        .map((entry) => `${entry.criterion} names ${entry.missing.join(' and ')}`)
        .join('; ')} — and this run did not record ${
        shortfall.length === 1 ? 'it' : 'those'
      } for the finding(s) filed there. What is attached to them is what was captured, and it is what a reviewer can check them by.`,
    );
  }

  if (context.target.hasAuthentication && context.syntheticCredentials === undefined) {
    for (const criterion of BEHIND_A_SIGN_IN) {
      notTested.push({
        criterion,
        because:
          'This application signs users in, and the assessment was given no test account, so everything behind the sign-in was left alone. What is in front of it was assessed normally.',
      });
    }
  }

  /*
   * The gate this feeds blocks certification, and it publishes its reason: "if
   * the authorised scope did not permit exercising the core flows, we did not
   * assess the product and must not certify it".
   *
   * `coreFlowsReached` is the exploring model's own judgement, and it cannot
   * tell that apart from running out of turns or from an application that is
   * simply broken — the last of which is a finding, not this gate. So it is
   * corroborated: the scope has to have actually refused something during that
   * stage. Where it did not, the model's report is said out loud in the notes
   * and the gate is not applied, because applying it would tell a customer
   * their authorisation was too narrow when nothing of theirs was refused.
   */
  const functional = stageResults.find((result) => result.stage === 'functional_exploration');
  const modelSaysUnreached =
    functional !== undefined &&
    functional.status !== 'skipped' &&
    functional.coreFlowsReached === false;
  const scopeRefusals = functional?.scopeRefusals ?? 0;
  const coreFlowsUnreachable = modelSaysUnreached && scopeRefusals > 0;
  if (modelSaysUnreached && scopeRefusals === 0) {
    notes.push(
      'The exploration reported that it could not complete the core flows, and nothing was refused by the authorised scope while it ran. That is recorded here rather than applied as a gate about authorisation coverage, which is a statement about the scope the customer granted.',
    );
  }

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
    notTestedCriteria: [...stageResults.flatMap((result) => result.notTested ?? []), ...notTested],
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

/**
 * Files each finding against the criterion it names, where the rubric knows it.
 *
 * Three normalisations and no guessing: trimmed, upper-cased, and the number
 * zero-padded to a width the rubric actually uses. `SEC-4` and `SEC-04` are the
 * same criterion written two ways. `SEC-99` and `SEC-09` are not — one of them
 * does not exist — so padding stops at the widths the rubric itself has and an
 * id that still matches nothing is returned untouched and reported.
 *
 * Nothing is dropped. A finding is a thing somebody observed and evidenced, and
 * the worst outcome here is to lose it because its label was written oddly.
 */
export function placeCriteria(
  findings: readonly RawFinding[],
  knownCriteria: readonly string[],
): {
  placed: RawFinding[];
  corrected: { from: string; to: string }[];
  unplaceable: string[];
} {
  const known = new Set(knownCriteria);
  /** The digit widths the rubric uses, so padding cannot invent a width. */
  const widths = new Set(
    knownCriteria
      .map((id) => /-(\d+)$/.exec(id)?.[1]?.length)
      .filter((width): width is number => width !== undefined),
  );

  const place = (ruleId: string): string | null => {
    const trimmed = ruleId.trim().toUpperCase();
    if (known.has(trimmed)) return trimmed;
    const parts = /^([A-Z]+)-0*(\d+)$/.exec(trimmed);
    if (!parts) return null;
    for (const width of widths) {
      const candidate = `${parts[1]}-${parts[2]!.padStart(width, '0')}`;
      if (known.has(candidate)) return candidate;
    }
    return null;
  };

  const placed: RawFinding[] = [];
  const corrected: { from: string; to: string }[] = [];
  const unplaceable: string[] = [];

  for (const finding of findings) {
    const resolved = place(finding.ruleId);
    if (resolved === null) {
      if (!unplaceable.includes(finding.ruleId)) unplaceable.push(finding.ruleId);
      placed.push(finding);
      continue;
    }
    if (resolved !== finding.ruleId) corrected.push({ from: finding.ruleId, to: resolved });
    placed.push({ ...finding, ruleId: resolved });
  }

  return { placed, corrected, unplaceable };
}
