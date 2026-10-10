/**
 * What may reach a customer, checked on the way out, when we did not write it.
 *
 * Two kinds of text in this product are written while somebody waits: the
 * assistant's reply beside a report, and the findings a model extracts from
 * what it saw during an assessment — their titles, their descriptions, their
 * remediation steps, and the stage notes beside them.
 *
 * This file was `packages/copilot/src/guard.ts` until 2026-10-10, and only the
 * first of those two went through it. The route that used it says in its own
 * header that the assistant's reply is "the only text the product sends a
 * customer that no build-time gate has read", which was not true: a model
 * writes most of the words in a paid report, and PART 11 of the brief names
 * report text first in the list of outputs that may not use these words.
 *
 * It lives in `shared` so that the assistant and the engine cannot hold two
 * lists. `packages/shared/src/claim-check.ts` is the same idea for words a
 * *customer* types beside our mark, and its header already says why two lists
 * are worse than one: they disagree within a release, and the one facing the
 * public is the one nobody is maintaining.
 *
 * Exempt from `check:copy`, necessarily — a file that lists forbidden phrases
 * contains every one of them. `tests/the-words-the-model-wrote.test.ts` pins
 * its restricted words to the build-time linter's, so prose smuggled in here
 * fails that test instead.
 *
 * This duplicates the model prompts' rules deliberately. A prompt is an
 * instruction and this is a gate: the first is what we ask for, the second is
 * what a customer can actually receive.
 */

/**
 * Claims no sentence can excuse.
 *
 * There is no context in which these are honest about somebody else's
 * application, so unlike the list below they are not softened by a negation.
 */
export const ABSOLUTE_CLAIMS: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  {
    pattern: /\b(hack-proof|hackproof|bulletproof|unhackable|impenetrable)\b/i,
    why: 'claimed an application cannot be attacked',
  },
  {
    pattern: /\b(will|would|should)\s+(pass|score|raise|improve)\b/i,
    why: 'predicted what a future assessment will do',
  },
  {
    pattern: /\byou (are|will be) (now )?(compliant|certified)\b/i,
    why: 'claimed compliance or certification',
  },
];

/**
 * Words that need the sentence around them to limit them.
 *
 * The same two-tier shape `check:copy` uses on our written copy, and for the
 * same reason: the assistant's most useful sentence is often the one that
 * denies the claim. "I cannot tell you whether this is secure" has to survive
 * the gate that exists to make it say exactly that.
 */
export const RESTRICTED_CLAIMS: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /\bsecure\b/i, why: 'called something secure without a scope qualifier' },
  { pattern: /\bsafe\b/i, why: 'called something safe without a scope qualifier' },
  {
    pattern: /\bguarantee(d|s)?\b/i,
    why: 'guaranteed an outcome without a scope qualifier',
  },
  { pattern: /\bcompliant\b/i, why: 'called something compliant without a scope qualifier' },
  { pattern: /\b(risk|bug|error)-free\b/i, why: 'claimed an absence of faults' },
];

/** Markers that make a restricted word acceptable, because the sentence limits it. */
export const CLAIM_QUALIFIERS: readonly string[] = [
  'not',
  'never',
  'no ',
  'cannot',
  "isn't",
  "doesn't",
  'does not',
  'without',
  'rather than',
  'instead of',
  'whether',
  'scope-limited',
  'point-in-time',
  'what was tested',
];

/** Split so a negation three sentences away cannot launder a claim. */
function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?;:])\s+|\s+[—–|]\s+/);
}

export interface DraftedTextCheck {
  readonly allowed: boolean;
  /** Written to be read by a person, in the order the rules were tripped. */
  readonly reasons: readonly string[];
}

/** Whether text we did not write may be shown to the customer as it stands. */
export function checkDraftedText(text: string): DraftedTextCheck {
  const reasons = new Set<string>();

  for (const rule of ABSOLUTE_CLAIMS) {
    if (rule.pattern.test(text)) reasons.add(rule.why);
  }

  for (const sentence of sentencesOf(text)) {
    const lower = sentence.toLowerCase();
    if (CLAIM_QUALIFIERS.some((qualifier) => lower.includes(qualifier))) continue;
    for (const rule of RESTRICTED_CLAIMS) {
      if (rule.pattern.test(sentence)) reasons.add(rule.why);
    }
  }

  return { allowed: reasons.size === 0, reasons: [...reasons] };
}
