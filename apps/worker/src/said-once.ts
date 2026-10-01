/**
 * A standing condition, said once a day rather than on every pass.
 *
 * The worker's sweeps run every five minutes, and some of what they find is not
 * a moment but a state: spend past a threshold lasts the rest of the day, a
 * data-subject request stays overdue until a person handles it, a rubric
 * published without a matching deploy stays mismatched until somebody deploys.
 * Logging those unconditionally produced a few hundred identical sentences a
 * day each — which is not a louder warning than one sentence. It is a quieter
 * one, because the next line worth reading arrives buried under them.
 *
 * This was decided three separate times in two files before it was written down
 * once: for spend in 2026-09-20, for governance deadlines and for the two
 * disagreement notices in `monitoring.ts` on 2026-10-01. Three copies of one
 * rule is how a rule forks, and the copy that forks is the one nobody re-reads.
 *
 * Two properties are the whole design:
 *
 *   · **Keyed by the thing, not by the sweep.** One overdue request going quiet
 *     must never silence another, so the caller keys by the row's own id.
 *   · **Keyed by UTC day as well**, so a condition that is still true tomorrow
 *     is said again tomorrow. A deadline mentioned once and then silent reads as
 *     handled, which is the opposite defect and the one a naive fix produces.
 *
 * In memory rather than a column, because this is a way of speaking and not a
 * record. The facts themselves are in the database; a restart that says
 * everything once more is the harmless direction.
 */
export interface SaidOnce {
  /**
   * True the first time this key is offered on this UTC day, false after.
   *
   * Reads as a question at the call site — `if (notices.due(key, now))` — so
   * the line that follows is the one being rationed, and the counting around it
   * stays unconditional.
   */
  due(key: string, now?: Date): boolean;
  /** Forgets everything. For tests, which share one process. */
  forget(): void;
}

export function saidOnceADay(): SaidOnce {
  const lastSaid = new Map<string, string>();
  return {
    due(key, now = new Date()) {
      const today = now.toISOString().slice(0, 10);
      if (lastSaid.get(key) === today) return false;
      lastSaid.set(key, today);
      return true;
    },
    forget() {
      lastSaid.clear();
    },
  };
}
