/**
 * The shared shape of a model-driven stage.
 *
 * Each of these stages does the same three things: explore with tools, then
 * extract structured findings from what it saw, then discard anything it cannot
 * evidence. The third step is the important one and is deliberately not the
 * model's decision — a finding whose evidence id we did not mint is dropped
 * here, in code, before it can reach a report.
 */
import { z } from 'zod';
import { checkDraftedText } from '@vibefycode/shared';
import { BrowserSession } from '../runtime/browser.ts';
import { ScopedHttp } from '../runtime/http.ts';
import { classifyStop, stopNote } from '../runtime/stop.ts';
import type { ToolDefinition } from '../model/client.ts';
import { browserTools, httpTool } from './tools.ts';
import type { RefusedControl } from '../runtime/destructive-controls.ts';
import type { RefusedCredential } from '../runtime/credential-fields.ts';
import type { RawFinding, Stage, StageContext, StageId, StageResult } from './types.ts';

export const DIMENSIONS = [
  'functional_integrity',
  'security_posture',
  'data_privacy_practice',
  'practicality_ux',
  'production_readiness',
  'store_distribution_readiness',
] as const;

export const findingSchema = z.object({
  ruleId: z
    .string()
    .describe('The rubric criterion id this evidences, for example SEC-05 or FI-01'),
  dimension: z.enum(DIMENSIONS),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  confidence: z.enum(['high', 'medium', 'low']),
  title: z.string().describe('One line, specific, no more than 160 characters'),
  description: z
    .string()
    .describe(
      'What you did, what happened, and why it matters to a real user. State observations, not inferences.',
    ),
  remediation: z.string().describe('A step the customer can take today, not a topic to read about'),
  evidenceIds: z
    .array(z.string())
    .describe(
      'Ids returned by the screenshot or http_request tools. A finding with none of these is discarded.',
    ),
});

export const stageOutputSchema = z.object({
  findings: z.array(findingSchema),
  notes: z
    .array(z.string())
    .describe(
      'What you could not reach, and anything the customer should know that is not a defect',
    ),
  coreFlowsReached: z
    .boolean()
    .describe(
      'True if the authorised scope let you exercise the application’s primary flow at all',
    ),
});

export type StageOutput = z.infer<typeof stageOutputSchema>;

export interface ModelStageConfig {
  readonly id: StageId;
  readonly promptId: string;
  readonly includeHttpTool: boolean;
  readonly appliesTo: (context: StageContext) => boolean;
  readonly skipReason?: (context: StageContext) => string;
  /** The opening instruction, built from the target. */
  readonly brief: (context: StageContext) => string;
}

export function createModelStage(config: ModelStageConfig): Stage {
  return {
    id: config.id,
    appliesTo: config.appliesTo,
    ...(config.skipReason ? { skipReason: config.skipReason } : {}),

    async run(context): Promise<StageResult> {
      const url = context.target.primaryUrl;
      if (!url)
        return {
          stage: config.id,
          status: 'skipped',
          findings: [],
          notes: ['No hosted URL to explore.'],
        };

      const startedAt = Date.now();
      const session = new BrowserSession(context.guard, context.evidence);
      const http = new ScopedHttp(context.guard, context.evidence);
      const mintedEvidence = new Set<string>();
      const notes: string[] = [];

      const bytesAtStart = context.evidence.totalBytes;
      try {
        await session.open();
        await session.goto(url, 'domcontentloaded');

        const refusedControls: RefusedControl[] = [];
        const refusedCredentials: RefusedCredential[] = [];
        const tools: ToolDefinition[] = browserTools({
          session,
          onScreenshot: (id) => mintedEvidence.add(id),
          // From the guard, which holds the authorisation's own ceiling. Passed
          // rather than defaulted: `browserTools` requires it, so a stage that
          // forgets it does not compile.
          ceiling: context.guard.policy.ceiling,
          onRefusedControl: (refused) => refusedControls.push(refused),
          // Whatever the owner provisioned, or nothing. Passed rather than
          // defaulted for the same reason as the ceiling above.
          credentials: context.syntheticCredentials,
          onRefusedCredential: (refused) => refusedCredentials.push(refused),
        });
        if (config.includeHttpTool) {
          tools.push(httpTool(http, (id) => mintedEvidence.add(id)));
        }

        const exploration = await context.model.run({
          stage: config.id,
          promptId: config.promptId,
          tools,
          context: config.brief(context),
          messages: [
            {
              role: 'user',
              content: `Begin at ${url}. Work through it now, using the tools. When you are finished, summarise what you observed.`,
            },
          ],
        });

        // A second call, with no tools, whose only job is to turn the transcript
        // into structured findings. Separating exploration from extraction keeps
        // the model from having to hold a schema in mind while it is navigating.
        const extraction = await context.model.run<StageOutput>({
          stage: config.id,
          promptId: config.promptId,
          outputSchema: stageOutputSchema,
          context: `${config.brief(context)}\n\nEvidence ids captured during this stage:\n${[...mintedEvidence].join('\n') || '(none)'}`,
          messages: [
            {
              role: 'user',
              content: `Here is what you observed while exploring:\n\n${exploration.text}\n\nTurn it into structured findings. Reference only evidence ids from the list above. If you observed nothing worth reporting, return an empty findings array — that is a legitimate result.`,
            },
          ],
        });

        const output = extraction.parsed;
        if (!output) {
          // Four different faults used to arrive here wearing the same
          // sentence. A schema the model could not satisfy needs the schema
          // looked at; a run that used up its turns needs the ceiling looked
          // at; a truncated answer needs `maxTokens`; a declined one needs a
          // person. Saying "produced no structured output" to all four sends
          // whoever reads it to the wrong place three times in four.
          const because =
            HALT_EXPLANATION[exploration.haltedBy ?? ''] ??
            HALT_EXPLANATION[extraction.haltedBy ?? ''] ??
            'The model answered, but the answer did not match the schema this stage requires.';
          return {
            stage: config.id,
            status: 'failed',
            findings: [],
            notes: [
              `The stage explored the application but produced no structured findings. ${because}`,
            ],
            error: extraction.haltedBy ?? exploration.haltedBy ?? 'structured_extraction_failed',
            promptSha256: extraction.promptSha256,
          };
        }

        const evidenced = enforceEvidence(output.findings, mintedEvidence, context);

        /*
         * Both halves, before either becomes report text.
         *
         * The dropped findings go through it too, because the sentence below
         * quotes their titles — a claim we refuse to publish as a finding
         * must not arrive in the note explaining why we refused it.
         */
        const { findings: kept, withheld } = withholdOverclaims(evidenced.kept);
        const unevidenced = unevidencedNote(evidenced.dropped);
        if (unevidenced !== null) notes.push(unevidenced);

        const modelNotes = withheldNotes(output.notes);
        notes.push(...modelNotes.notes);

        const overclaimed = [...withheld, ...modelNotes.withheld];
        if (overclaimed.length > 0) {
          // Logged as well as noted: a model reaching for these words is
          // something to read the prompt about, and a line in a customer's
          // report is not where that gets noticed.
          context.log('model text withheld before it reached a report', {
            assessmentId: context.assessmentId,
            stage: config.id,
            withheld: overclaimed,
          });
          notes.push(
            `${overclaimed.length} sentence(s) written during this stage were withheld before they reached this report, because VibefyCode may not state what they stated. Nothing was removed from what was found: the criteria, the severities and the evidence are all here.`,
          );
        }

        // An exploration that used every turn it is allowed did not finish
        // looking. The findings it produced stand; the ones it did not reach
        // are missing because we stopped asking, and until now the stage said
        // `succeeded` and mentioned none of it.
        if (exploration.haltedBy) {
          notes.push(
            `The exploration did not run to a natural end. ${
              HALT_EXPLANATION[exploration.haltedBy] ?? 'It stopped early.'
            } What it found still stands; what it did not reach is not evidence that there was nothing there.`,
          );
        }

        /*
         * A refused click is a measurement, not a gap.
         *
         * The control was found and seen; what did not happen is pressing it.
         * Saying so matters twice over: a reader of the report learns the
         * boundary held, and nobody later reads "the stage explored the
         * account settings" as meaning every path through them was followed.
         */
        if (refusedControls.length > 0) {
          const quoted = [...new Set(refusedControls.map((refused) => refused.label))]
            .slice(0, 5)
            .map((label) => `"${label}"`)
            .join(', ');
          notes.push(
            `${refusedControls.length} control(s) were found and deliberately not pressed, because ` +
              `clicking them would modify or destroy data and this authorisation does not permit ` +
              `that: ${quoted}. They were reported from the page instead.`,
          );
        }

        /*
         * A refused fill is a different gap from a refused click.
         *
         * The click guard says a control was seen and not pressed. This says a
         * sign-in was reached and not passed, which bounds the whole assessment
         * rather than one control: four published criteria cannot be observed
         * from outside a session at all. Saying it here is how the report stops
         * reading "we found no session handling" when what happened is that we
         * never had a session.
         */
        if (refusedCredentials.length > 0) {
          const noAccount = refusedCredentials.some(
            (refused) => refused.because === 'none_provisioned',
          );
          notes.push(
            `${refusedCredentials.length} credential field(s) were reached and deliberately not filled. ` +
              (noAccount
                ? 'This run was given no synthetic test account, so there was no password it was permitted ' +
                  'to type; anything behind the sign-in is unassessed for that reason, which is ours and ' +
                  'not the application\u2019s.'
                : 'The only password this run may type is the synthetic one the owner provisioned, and a ' +
                  'one-time code cannot be provisioned at all.'),
          );
        }

        const throttled = session.blockedRequests.filter(
          (blocked) => blocked.reason === 'rate_limited',
        ).length;
        const scopeRefusals = session.blockedRequests.length - throttled;
        if (scopeRefusals > 0) {
          notes.push(`${scopeRefusals} request(s) were blocked as out of scope during this stage.`);
        }
        if (throttled > 0) {
          notes.push(
            `${throttled} request(s) were dropped because this run reached the rate ceiling its authorisation sets. That is ours, not the application's.`,
          );
        }

        context.meter.recordCompute(
          config.id,
          (Date.now() - startedAt) / 1000,
          // What this stage captured, not what the run has captured so far.
          // Every stage recorded the running total, so the per-stage rows summed
          // to two or three times the evidence that actually exists.
          context.evidence.totalBytes - bytesAtStart,
        );

        return {
          stage: config.id,
          status: 'succeeded',
          findings: kept,
          notes,
          coreFlowsReached: output.coreFlowsReached,
          // What the scope actually refused, so that the gate this feeds is
          // applied for the reason it publishes. `coreFlowsReached` is the
          // model's own judgement and cannot tell "the scope refused me" from
          // "I ran out of turns" or "the application is broken" — and the gate
          // blocks certification under a rationale naming only the first.
          scopeRefusals,
          promptSha256: extraction.promptSha256,
        };
      } catch (error) {
        // A controlled stop is not a crash: the run aborts with what it has, and
        // the report says so rather than pretending it finished. Which stop it
        // was travels with the result, because a scope stop and a spending limit
        // read identically once they are both called 'a ceiling'.
        const stopReason = classifyStop(error);
        const message = error instanceof Error ? error.message : String(error);
        if (stopReason) {
          return {
            stage: config.id,
            status: 'aborted',
            stopReason,
            findings: [],
            notes: [
              `${stopNote(stopReason, config.id, message)}. Everything assessed before that ` +
                'point still stands; what came after was not assessed.',
            ],
            error: message,
          };
        }
        return {
          stage: config.id,
          status: 'failed',
          findings: [],
          notes: ['The stage did not complete.'],
          error: message,
        };
      } finally {
        await session.close();
      }
    },
  };
}

/**
 * "No finding without evidence", enforced in code rather than asked for in a
 * prompt. A model that asserts something it did not capture gets its assertion
 * dropped, and the drop is recorded.
 */
/**
 * What each halt means for whoever reads the run afterwards.
 *
 * Written for a person rather than a log parser: the value in distinguishing
 * these is that each one sends you somewhere different, so each sentence says
 * where.
 */
const HALT_EXPLANATION: Readonly<Record<string, string>> = {
  tool_iteration_ceiling:
    'It was still working when the stage stopped asking: the exploration used every turn it is allowed. What it had seen up to that point is in the transcript, but none of it became a finding.',
  output_truncated:
    'The answer was cut off at the token limit before it was complete, so there was nothing whole to read.',
  refused:
    'The model declined to answer. That is not a fault in the application and not a fault in this code; it needs a person to look at what was sent.',
};

/**
 * The words a model wrote, checked before they become report text.
 *
 * `enforceEvidence` above asks whether a finding is supported. This asks
 * whether the sentences describing it are ones we may publish — and until
 * 2026-10-10 nothing did. The assistant beside the report has had every reply
 * checked since the day it shipped, and the route doing it says in its header
 * that the reply is "the only text the product sends a customer that no
 * build-time gate has read". A model writes most of the words in a paid
 * report: the titles, the descriptions, the remediation steps and these notes.
 * PART 11 of the brief names report text first.
 *
 * A reply is withheld whole, because a reply is one thing. A finding is not: it
 * carries a rubric criterion, a severity and evidence we captured, all of which
 * are ours and none of which the sentence can spoil. Dropping it would lose a
 * defect the customer paid to be told about over a choice of words, so the
 * offending sentence is withheld, by itself, and what replaces it says which
 * rule it tripped.
 *
 * The title is replaced rather than removed: a finding has to be nameable, and
 * the criterion and severity name it well enough to find in the report.
 */
function withheldSentence(reasons: readonly string[]): string {
  return `This sentence was withheld before it reached you, because it ${reasons.join(
    ', and it ',
  )}. That is a limit on what VibefyCode may state, not a change to the finding: the criterion, the severity and the evidence are unaffected. Ask us to restate it and a person will.`;
}

export function withholdOverclaims(findings: readonly RawFinding[]): {
  findings: RawFinding[];
  withheld: string[];
} {
  const withheld: string[] = [];
  const checked = findings.map((finding) => {
    const titleCheck = checkDraftedText(finding.title);
    const descriptionCheck = checkDraftedText(finding.description);
    const remediationCheck = checkDraftedText(finding.remediation);
    if (titleCheck.allowed && descriptionCheck.allowed && remediationCheck.allowed) return finding;

    for (const check of [titleCheck, descriptionCheck, remediationCheck]) {
      if (!check.allowed) withheld.push(`${finding.ruleId}: ${check.reasons.join('; ')}`);
    }

    return {
      ...finding,
      title: titleCheck.allowed
        ? finding.title
        : `A ${finding.severity} finding against ${finding.ruleId}, whose title was withheld`,
      description: descriptionCheck.allowed
        ? finding.description
        : withheldSentence(descriptionCheck.reasons),
      remediation: remediationCheck.allowed
        ? finding.remediation
        : withheldSentence(remediationCheck.reasons),
    };
  });
  return { findings: checked, withheld };
}

/**
 * The same check on a note, which is the other half of what a model writes.
 *
 * Notes are the sentences about what could not be reached and what the
 * customer should know, and they go into the report beside the findings. A
 * note has no criterion and no evidence to protect, so a tripped one is
 * replaced outright.
 */
/**
 * The sentence that says what was dropped for citing no evidence.
 *
 * It quotes the titles, which are a model's words, so it withholds them first.
 * A claim we refuse to publish as a finding must not arrive in the note
 * explaining why we refused it — and when that was two lines at the call site
 * rather than one function, a mutation that removed the withholding left every
 * test green. This returns null for an empty list so the caller cannot compose
 * a note about nothing.
 */
export function unevidencedNote(dropped: readonly RawFinding[]): string | null {
  if (dropped.length === 0) return null;
  const titles = withholdOverclaims(dropped)
    .findings.map((finding) => finding.title)
    .join('; ');
  return `${dropped.length} claim(s) were withheld because they cited no evidence we captured: ${titles}. Unverifiable claims are dropped rather than published.`;
}

export function withheldNotes(notes: readonly string[]): { notes: string[]; withheld: string[] } {
  const withheld: string[] = [];
  const checked = notes.map((note) => {
    const check = checkDraftedText(note);
    if (check.allowed) return note;
    withheld.push(check.reasons.join('; '));
    return withheldSentence(check.reasons);
  });
  return { notes: checked, withheld };
}

export function enforceEvidence(
  findings: readonly StageOutput['findings'][number][],
  minted: ReadonlySet<string>,
  context: StageContext,
): { kept: RawFinding[]; dropped: RawFinding[] } {
  const kept: RawFinding[] = [];
  const dropped: RawFinding[] = [];

  for (const finding of findings) {
    const valid = finding.evidenceIds.filter(
      (id) => minted.has(id) && context.evidence.byId(id) !== undefined,
    );
    const candidate: RawFinding = { ...finding, evidenceIds: valid };
    if (valid.length === 0) dropped.push(candidate);
    else kept.push(candidate);
  }

  return { kept, dropped };
}
