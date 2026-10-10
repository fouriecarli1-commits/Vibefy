/**
 * The assistant's half of one gate.
 *
 * The rules themselves moved to `@vibefycode/shared` on 2026-10-10, because
 * the assistant was not the only thing writing text a customer reads: a model
 * writes most of the words in a paid report, and nothing checked those. Two
 * copies of "what may reach a customer" would have been two lists to keep in
 * step, and the one facing the public would have been the one nobody was
 * maintaining.
 *
 * The name stays, because the decision this makes is the assistant's: a reply
 * that trips the gate is withheld whole. A finding cannot be, so the engine
 * reaches for the same check and makes its own decision about the sentence.
 */
import { checkDraftedText, type DraftedTextCheck } from '@vibefycode/shared';

export type CopilotCheck = DraftedTextCheck;

/** Whether a drafted reply may be shown to the customer. */
export function checkCopilotReply(text: string): CopilotCheck {
  return checkDraftedText(text);
}
