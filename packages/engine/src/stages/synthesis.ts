/**
 * Synthesis.
 *
 * Composes the evidenced output of every prior stage into the report the
 * customer reads. It has no tools and no network: it works only from what the
 * other stages captured, which is what stops it inventing a finding that nothing
 * observed.
 */
import { z } from 'zod';
import type { StageContext, StageResult } from './types.ts';

export const reportSchema = z.object({
  headline: z
    .string()
    .describe(
      'Two sentences a founder reads first: what state the application is in, and the single most important thing to fix.',
    ),
  summary: z
    .string()
    .describe(
      'Three to six sentences. Direct, specific, and honest about what was good as well as what was not.',
    ),
  strengths: z
    .array(z.string())
    .describe(
      'What the application genuinely does well, specifically. Empty if there is nothing to say.',
    ),
  prioritisedRemediation: z
    .array(
      z.object({
        order: z.number(),
        title: z.string(),
        why: z.string().describe('The consequence to a real user if this is not fixed'),
        step: z.string().describe('What to do, concretely'),
        findingTitles: z.array(z.string()),
      }),
    )
    .describe('Ordered by consequence to a real user, not by how interesting the defect is'),
  notAssessed: z
    .array(z.string())
    .describe('What this assessment did not cover, so the customer is not misled by silence'),
});

export type ReportNarrative = z.infer<typeof reportSchema>;

export async function synthesise(
  context: StageContext,
  stageResults: readonly StageResult[],
): Promise<{ narrative: ReportNarrative | null; promptSha256: string; notes: string[] }> {
  const findings = stageResults.flatMap((result) => result.findings);
  const notes = stageResults.flatMap((result) => result.notes);

  const evidenceIndex = findings.flatMap((finding) =>
    finding.evidenceIds.map((id) => {
      const artefact = context.evidence.byId(id);
      return artefact ? `${id} — ${artefact.kind}: ${artefact.summary}` : null;
    }),
  );

  const result = await context.model.run<ReportNarrative>({
    stage: 'synthesis',
    promptId: 'synthesis',
    outputSchema: reportSchema,
    context: [
      `Application: ${context.target.appName}`,
      `Assessment depth: ${context.depth}`,
      `Stages that ran: ${stageResults.map((r) => `${r.stage} (${r.status})`).join(', ')}`,
      `Evidence available:\n${evidenceIndex.filter(Boolean).join('\n') || '(none)'}`,
    ].join('\n\n'),
    messages: [
      {
        role: 'user',
        content: [
          'Here are the evidenced findings from every stage:',
          JSON.stringify(findings, null, 2),
          '',
          'And the stage notes, which include what could not be reached:',
          JSON.stringify(notes, null, 2),
          '',
          'Compose the report. Do not introduce findings that are not in the list above.',
        ].join('\n'),
      },
    ],
  });

  return { narrative: result.parsed, promptSha256: result.promptSha256, notes };
}
