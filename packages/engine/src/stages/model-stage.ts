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
import { BrowserSession } from '../runtime/browser.ts';
import { ScopedHttp } from '../runtime/http.ts';
import { classifyStop, stopNote } from '../runtime/stop.ts';
import type { ToolDefinition } from '../model/client.ts';
import { browserTools, httpTool } from './tools.ts';
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

        const tools: ToolDefinition[] = browserTools({
          session,
          onScreenshot: (id) => mintedEvidence.add(id),
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

        const { kept, dropped } = enforceEvidence(output.findings, mintedEvidence, context);
        if (dropped.length > 0) {
          notes.push(
            `${dropped.length} claim(s) were withheld because they cited no evidence we captured: ${dropped
              .map((finding) => finding.title)
              .join('; ')}. Unverifiable claims are dropped rather than published.`,
          );
        }
        notes.push(...output.notes);

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
