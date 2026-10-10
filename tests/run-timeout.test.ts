/**
 * A run that never comes back.
 *
 * Nothing bounded a run's wall-clock time. The scope guard's thirty-minute
 * ceiling is only checked when a request passes through it, so a model call or
 * a page load that hangs never reaches it — and `reclaimStaleRequests` gives a
 * claim back to the queue after ninety minutes whether or not its worker is
 * still alive. A run that hung was therefore performed twice and charged twice,
 * which is exactly the hazard the reclaim sweep's own comment names.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  RECLAIM_AFTER_MINUTES,
  RUN_TIMEOUT_MINUTES,
  isRetryableFailure,
} from '../apps/worker/src/queue.ts';
import { NotAuthorisedError } from '../apps/worker/src/run-assessment.ts';
import { AuthorisationWithdrawnError, DanglingEvidenceError } from '../apps/worker/src/persist.ts';
import { UnretryableError } from '../apps/worker/src/errors.ts';

describe('the two timeouts', () => {
  it('leave the worker time to give up before the sweep takes the row', () => {
    // The margin is the whole safety argument, and it used to be a sentence in
    // a comment rather than anything in the code.
    expect(RUN_TIMEOUT_MINUTES).toBeLessThan(RECLAIM_AFTER_MINUTES);
    expect(RECLAIM_AFTER_MINUTES - RUN_TIMEOUT_MINUTES).toBeGreaterThanOrEqual(20);
    /*
     * And the comment that justifies the gap argues from these numbers.
     *
     * It used to argue from the scope guard's thirty-minute ceiling — "ninety
     * is three times the longest a run can legitimately take" — which the
     * comment ten lines above it says plainly is not a wall-clock bound at
     * all, because it is only checked when a request passes through the guard.
     * A safety margin whose justification cites a bound that does not exist is
     * the thing somebody raises a timeout against.
     */
    // Read raw, not through `withoutComments`: the subject here is the comment
    // itself, and stripping it first is how the first version of this
    // assertion passed by reading nothing.
    const queue = readFileSync('apps/worker/src/queue.ts', 'utf8');
    /*
     * Asserted as a positive rather than as an absence.
     *
     * The obvious form — "the file must not say three times the longest a run
     * can legitimately take" — fails, because the corrected comment quotes the
     * sentence it replaced, which is how this repository records a correction
     * and is worth more than the assertion. A negative over a file that
     * deliberately contains its own history cannot tell a claim from a
     * quotation.
     */
    expect(queue).toContain('which is sixty, so the margin is');
    expect(queue).toContain('tests/run-timeout.test.ts');
  });

  /*
   * What `withRunTimeout` and `runIsOrphaned` actually do is asserted in
   * `tests/a-run-that-never-came-back.test.ts`.
   *
   * This used to be two `toMatch` calls against this file's source — that it
   * contains the strings `withRunTimeout(` and `runIsOrphaned()` somewhere.
   * Neither stripped comments, so a commented-out call satisfied both, and
   * neither said anything about what happens when a run does hang. The margin
   * asserted above is a real property of two numbers and stays here.
   */
});

describe('what a second attempt cannot change', () => {
  it('covers every failure of ours that is deterministic', () => {
    // Each of these had already been paid for by the time it was raised, and
    // each was classed retryable — so the request went back to the queue to
    // buy the same wall at full price.
    for (const error of [
      new NotAuthorisedError('no authorisation'),
      new AuthorisationWithdrawnError('app-1'),
      new DanglingEvidenceError('A finding', 'evidence-1'),
    ]) {
      expect(error, error.name).toBeInstanceOf(UnretryableError);
      expect(isRetryableFailure(error), error.name).toBe(false);
    }
  });

  it('still retries everything a second attempt might fix', () => {
    expect(isRetryableFailure(new Error('connection terminated'))).toBe(true);
    expect(isRetryableFailure({ code: '40001' })).toBe(true); // serialisation failure
    expect(isRetryableFailure({ code: '23503' })).toBe(false); // foreign key
  });

  it('is decided in one place, not listed at the call site', () => {
    const main = readFileSync('apps/worker/src/main.ts', 'utf8');
    expect(main).toMatch(/const retryable = isRetryableFailure\(error\);/);
    expect(main).not.toMatch(/instanceof NotAuthorisedError/);
  });
});

describe('a request that finished and was not there to be marked', () => {
  it('is an error rather than a row left claimed', async () => {
    // Silent, the row stays `claimed` until the sweep finds it ninety minutes
    // later and runs the whole assessment again — while the console shows the
    // customer "in progress" for an assessment that had finished.
    const { completeRequest } = await import('../apps/worker/src/queue.ts');
    const client = {
      query: async () => ({ rowCount: 0, rows: [] }),
    } as unknown as import('pg').PoolClient;
    await expect(completeRequest(client, 'request-1', 'assessment-1')).rejects.toThrow(
      /was not there to mark completed/i,
    );
  });
});
