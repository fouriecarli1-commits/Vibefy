/**
 * A sweep window that only advances when a row succeeds.
 *
 * Several sweeps here find their work the same way: select the oldest N rows
 * that lack the thing the sweep produces, and produce it. A row leaves the
 * window only by acquiring that thing — so a row that *cannot* acquire it sits
 * at the front for ever and takes one of the N places every pass. N of those
 * and the sweep stops doing anything at all, while the log fills with the same
 * N errors and never says the thing that matters: that everything else is now
 * queued behind them.
 *
 * `sweepPendingReports` hit this for real and got a cap, a count of what it can
 * no longer render, and a durable record. `sweepDriftDetection` has the
 * identical window — twenty rows, ordered oldest first, leaving only by
 * acquiring a `drift_reports` row — and had none of it, which is how one fix
 * becomes one fix instead of a rule. The counting is here so there is one of
 * it; what to write down, and in whose words, stays with each sweep.
 *
 * In memory rather than in a column, deliberately. This is a process-lifetime
 * guard and not a record: a restart is a fresh try, which is exactly what you
 * want after the deploy that fixed the bug. The durable part is the audit row
 * each caller writes when it gives up, because a `Map` a deploy forgets is not
 * an account anybody can act on.
 */
export interface StuckWindow {
  /** True once this row has failed its allowance, so the sweep should skip it. */
  stuck(id: string): boolean;
  /** Records a failure and returns the new count, so the caller can say "the third". */
  failed(id: string): number;
  /** It worked. Forgets the row, so a later failure starts from one again. */
  succeeded(id: string): void;
  /** Forgets everything. For tests, which share one process. */
  forget(): void;
}

export function stuckWindow(attempts: number): StuckWindow {
  const failures = new Map<string, number>();
  return {
    stuck(id) {
      return (failures.get(id) ?? 0) >= attempts;
    },
    failed(id) {
      const next = (failures.get(id) ?? 0) + 1;
      failures.set(id, next);
      return next;
    },
    succeeded(id) {
      failures.delete(id);
    },
    forget() {
      failures.clear();
    },
  };
}
