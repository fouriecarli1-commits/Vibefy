/**
 * Which controls an assessment may not click.
 *
 * `legal/authorisation-to-test.md` is the warranty a customer signs, and it
 * says in plain words under "We will not": **"Modify, delete or exfiltrate
 * data"**. The intensity ceiling on every authorisation row carries
 * `allow_data_modification: false`, and `authorisations_intensity_is_non_destructive`
 * makes it impossible for that to be anything else.
 *
 * The `click` tool clicks whatever element the model names, by visible text or
 * by selector, on the customer's live application. Measured on 2026-10-09:
 * nothing between the model and that click read the ceiling. The only restraint
 * was a sentence in a tool description — and a rule that lives in a prompt is a
 * rule the model can be talked out of, which is the same argument this schema
 * already makes about rules that live only in `apps/web`.
 *
 * So the rule moves into the tool. This module is the deterministic half: given
 * the label a human would read on a control, does clicking it destroy data or
 * spend money?
 *
 * ## What is deliberately not on the list
 *
 * `submit`, `send`, `save`, `continue`, `next`, `ok` and **`cancel` on its own**.
 * A browser pass that cannot press Submit cannot explore a form, and "Cancel"
 * alone is the universal dismiss — refusing it would make every dialog a dead
 * end while protecting nothing. `cancel subscription` is a different act and is
 * on the list.
 *
 * The cost of being too narrow is a click we should not have made. The cost of
 * being too wide is a stage that reports nothing and says it explored. Both are
 * real, which is why the list is phrases rather than single verbs, and why a
 * refusal is reported rather than silent.
 */

/**
 * Phrases that name an irreversible act on somebody's own application.
 *
 * Matched against the control's accessible label, lower-cased, with runs of
 * whitespace collapsed. Order does not matter; the first match wins and its
 * text is what the refusal quotes.
 */
const DESTRUCTIVE_PHRASES: readonly string[] = [
  // Destroying data.
  'delete',
  'remove',
  'erase',
  'wipe',
  'destroy',
  'permanently',
  // Ending an account or a relationship.
  'deactivate',
  'close account',
  'close my account',
  'close your account',
  'disable account',
  'terminate',
  'cancel subscription',
  'cancel my subscription',
  'cancel plan',
  'cancel membership',
  'end subscription',
  'unsubscribe',
  'revoke',
  // Spending the customer's money. Not destruction, and the warranty's
  // "modify" covers it: a charge changes their billing state.
  'pay now',
  'pay $',
  'place order',
  'complete purchase',
  'confirm payment',
  'checkout',
  'check out',
  'buy now',
  'subscribe now',
  'upgrade now',
  'withdraw',
  'transfer',
  // Resets, which read as settings and act as deletions.
  'reset',
  'factory',
];

/** What a refused click is, in a form a caller can both report and log. */
export interface RefusedControl {
  /** The label as it was read, trimmed and collapsed but not lower-cased. */
  readonly label: string;
  /** The phrase that matched, so a reader can see why rather than guess. */
  readonly phrase: string;
}

/** The label, as the matcher sees it. Exported so a test can show its working. */
export function normaliseLabel(label: string): string {
  return label.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Whether clicking this control would breach the authorisation.
 *
 * Returns the phrase that matched rather than a boolean, so the refusal can
 * quote it. A label we could not read at all — empty, or whitespace — returns
 * `null`: refusing every unlabelled control would stop the pass on most
 * applications, and an unlabelled button is not evidence of destruction. That
 * is a deliberate limit of this check and it is in the stage's notes.
 */
export function destructivePhraseIn(label: string): string | null {
  const normalised = normaliseLabel(label);
  if (normalised.length === 0) return null;
  for (const phrase of DESTRUCTIVE_PHRASES) {
    if (normalised.includes(phrase)) return phrase;
  }
  return null;
}

/** Every phrase, for a test that wants to assert the list rather than samples. */
export const DESTRUCTIVE_CONTROL_PHRASES = DESTRUCTIVE_PHRASES;
