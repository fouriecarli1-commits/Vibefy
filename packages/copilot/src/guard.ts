/**
 * What may reach the customer, checked on the way out.
 *
 * Split into its own file for the same reason `tools/copy-lint.mjs` is: a file
 * that lists forbidden phrases necessarily contains every one of them, and
 * would fail the gate it exists to enforce. This one is exempt from
 * `check:copy`; `index.ts`, which holds the actual prose the assistant is
 * instructed with, is not — and a test asserts that split stays that way.
 *
 * This duplicates the system prompt's rules deliberately. A prompt is an
 * instruction and this is a gate: the first is what we ask for, the second is
 * what a customer can actually receive. Every other line of copy in this
 * product passes a check before it ships, and it would be strange for the one
 * piece of text written while the customer waits to be the only text nobody
 * checks.
 */

/**
 * Claims no sentence can excuse.
 *
 * There is no context in which these are honest about somebody else's
 * application, so unlike the list below they are not softened by a negation.
 */
const ABSOLUTE: readonly { readonly pattern: RegExp; readonly why: string }[] = [
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
const RESTRICTED: readonly { readonly pattern: RegExp; readonly why: string }[] = [
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
const QUALIFIERS: readonly string[] = [
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

export interface CopilotCheck {
  readonly allowed: boolean;
  readonly reasons: readonly string[];
}

/** Whether a drafted reply may be shown to the customer. */
export function checkCopilotReply(text: string): CopilotCheck {
  const reasons = new Set<string>();

  for (const rule of ABSOLUTE) {
    if (rule.pattern.test(text)) reasons.add(rule.why);
  }

  for (const sentence of sentencesOf(text)) {
    const lower = sentence.toLowerCase();
    if (QUALIFIERS.some((qualifier) => lower.includes(qualifier))) continue;
    for (const rule of RESTRICTED) {
      if (rule.pattern.test(sentence)) reasons.add(rule.why);
    }
  }

  return { allowed: reasons.size === 0, reasons: [...reasons] };
}
