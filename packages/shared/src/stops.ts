/**
 * Why a run stopped, when it stopped on purpose — and what to tell the reader.
 *
 * A run that reaches its spending limit, exhausts the intensity the customer
 * authorised, or is turned back at the scope boundary has not failed. It has
 * done exactly what it was built to do. Recording all three as a failure — which
 * is what happened until now — tells the customer something went wrong with
 * their application, sends whoever is on support looking for a fault that is not
 * there, and buries the one event most worth seeing: the scope guard firing.
 *
 * The three are kept apart because the answer differs. A spending limit is ours.
 * An intensity ceiling is the customer's own authorisation, and they can widen
 * it. A scope violation means the run was about to touch something nobody
 * authorised, which is not a setting to turn up — it is a question about where
 * the application led.
 *
 * The words live here, beside the scope statement and the non-reliance legend,
 * rather than in the engine: the console, the report and the worker all have to
 * say the same thing, and three copies of a sentence disagree within a release.
 */

export type StopReason = 'cost_ceiling' | 'intensity_ceiling' | 'scope_violation';

export const STOP_REASONS: readonly StopReason[] = [
  'cost_ceiling',
  'intensity_ceiling',
  'scope_violation',
];

/**
 * What to say about a stop, to somebody looking at a run that did not finish.
 *
 * Written for a reader who has never seen this codebase. Each one says what
 * happened, that what was assessed still stands, and what — if anything — is
 * theirs to do about it.
 */
export const STOP_EXPLANATION: Readonly<Record<StopReason, string>> = {
  cost_ceiling:
    'The run reached the spending limit for assessments at this depth and stopped there. ' +
    'Nothing is wrong with the application: what was assessed before that point still stands, ' +
    'and what came after it was not looked at.',
  intensity_ceiling:
    'The run reached a limit in the testing authorisation for this application — how many ' +
    'requests it may make, how fast, or for how long — and stopped rather than going past what ' +
    'was authorised. What was assessed before that point still stands, and the authorisation ' +
    'is yours to widen if you want a fuller run.',
  scope_violation:
    'The run was about to reach something outside the scope this application authorised, and ' +
    'stopped instead. That is the boundary doing its job rather than a fault in the ' +
    'application, and it usually means a redirect or an embedded service led somewhere the ' +
    'authorisation does not cover. What was assessed before that point still stands.',
};

/** A heading for the panel that carries the explanation. */
export const STOP_HEADLINE: Readonly<Record<StopReason, string>> = {
  cost_ceiling: 'This run stopped at its spending limit',
  intensity_ceiling: 'This run stopped at the intensity you authorised',
  scope_violation: 'This run stopped at the edge of what you authorised',
};

/** A short label, for a log line or a summary rather than for a reader. */
export const STOP_LABEL: Readonly<Record<StopReason, string>> = {
  cost_ceiling: 'reached its spending limit',
  intensity_ceiling: 'reached the authorised intensity ceiling',
  scope_violation: 'was turned back at the scope boundary',
};

/** The note a stage records when it stops. Never calls a scope stop a ceiling. */
export function stopNote(reason: StopReason, stage: string, message: string): string {
  return `The run ${STOP_LABEL[reason]} during ${stage}: ${message}`;
}
