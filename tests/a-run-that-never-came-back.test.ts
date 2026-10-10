/**
 * The timeout that stops a worker waiting, asserted rather than mentioned.
 *
 * A run has no other wall-clock bound. The scope guard's ceiling is only
 * checked when a request passes through it, so a model call or a page load
 * that hangs never reaches it, and `reclaimStaleRequests` gives the claim back
 * to the queue after ninety minutes whether or not the worker is still alive.
 * A run that hung was performed twice and charged twice.
 *
 * `withRunTimeout` is the thing that prevents it, and the promise it races
 * cannot be cancelled — so the run is still out there, possibly about to write
 * an assessment for a request that now belongs to somebody else. The only
 * reliable answer is for the process to end, which is what `runIsOrphaned`
 * tells the loop to do.
 *
 * All of that was tested by two assertions that the file's own source contains
 * the strings `withRunTimeout(` and `runIsOrphaned()`. Neither strips comments,
 * so a commented-out call satisfies both; and neither says anything about what
 * happens when a run does hang. The second signature in the runbook's list, on
 * the path where its consequence is a duplicate assessment and a double
 * charge.
 *
 * `clearOrphanedRun` existed as a test seam with no caller. This is its
 * caller — which is also how the orphan flag turned out never to have been set
 * by a test at all.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RUN_TIMEOUT_MINUTES } from '../apps/worker/src/queue.ts';
import {
  RunTimedOutError,
  clearOrphanedRun,
  runIsOrphaned,
  withRunTimeout,
} from '../apps/worker/src/main.ts';

afterEach(() => {
  vi.useRealTimers();
  clearOrphanedRun();
});

describe('a run that outlasts the timeout', () => {
  it('rejects with the request and the minutes it was given', async () => {
    vi.useFakeTimers();
    const never = new Promise<string>(() => {});
    const raced = withRunTimeout(never, 'request-1');
    const caught = raced.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(RUN_TIMEOUT_MINUTES * 60_000 + 1);

    const error = await caught;
    expect(error).toBeInstanceOf(RunTimedOutError);
    expect(String((error as Error).message)).toContain('request-1');
    expect(String((error as Error).message)).toContain(String(RUN_TIMEOUT_MINUTES));
  });

  it('records the request as orphaned, which is what ends the process', async () => {
    vi.useFakeTimers();
    expect(runIsOrphaned(), 'a previous case left the flag set').toBeNull();

    const raced = withRunTimeout(new Promise<string>(() => {}), 'request-2');
    const caught = raced.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(RUN_TIMEOUT_MINUTES * 60_000 + 1);
    await caught;

    expect(runIsOrphaned()).toBe('request-2');
  });

  it('does not fire a minute early, because the reclaim margin is the safety argument', async () => {
    vi.useFakeTimers();
    const raced = withRunTimeout(new Promise<string>(() => {}), 'request-3');
    const caught = raced.then(
      () => 'settled',
      () => 'rejected',
    );

    await vi.advanceTimersByTimeAsync(RUN_TIMEOUT_MINUTES * 60_000 - 60_000);
    expect(runIsOrphaned(), 'orphaned before its time').toBeNull();

    await vi.advanceTimersByTimeAsync(120_000);
    expect(await caught).toBe('rejected');
  });
});

describe('a run that comes back', () => {
  it('passes its value through and orphans nothing', async () => {
    await expect(withRunTimeout(Promise.resolve('an assessment'), 'request-4')).resolves.toBe(
      'an assessment',
    );
    expect(runIsOrphaned()).toBeNull();
  });

  it('clears the timer, so a finished run does not hold the process open', async () => {
    vi.useFakeTimers();
    await withRunTimeout(Promise.resolve('done'), 'request-5');
    // A timer left armed for an hour keeps the event loop alive for an hour,
    // on a process whose whole job is to be cheap when idle.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets an ordinary failure through as itself, and orphans nothing', async () => {
    const boom = new Error('the model refused');
    await expect(withRunTimeout(Promise.reject(boom), 'request-6')).rejects.toBe(boom);
    expect(
      runIsOrphaned(),
      'an ordinary failure was treated as a run still in flight, which would stop the worker',
    ).toBeNull();
  });
});

describe('the loop acts on it', () => {
  /** The worker's source, without the comments that name these very symbols. */
  const code = readFileSync('apps/worker/src/main.ts', 'utf8')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');

  it('never awaits the assessment without the timeout around it', () => {
    /*
     * The first version of this asserted the literal shape
     * `withRunTimeout(runAssessmentJob(`, which a behaviour-preserving
     * refactor fails — hoisting the promise into a variable first changes
     * nothing and broke the test. A brittle assertion is one somebody deletes.
     *
     * The property that matters survives either spelling: the job's promise is
     * never awaited on its own. Remove the wrapper and `await
     * runAssessmentJob(` appears, which is the thing to refuse.
     */
    expect(code).toContain('withRunTimeout(');
    expect(code).toContain('runAssessmentJob(');
    expect(
      code,
      'the assessment is awaited directly, so nothing bounds how long it may take',
    ).not.toMatch(/await\s+runAssessmentJob\(/);
  });

  it('would see a call that had been commented out, which the old assertion could not', () => {
    // The old test matched `withRunTimeout(` anywhere in the file, comments
    // included. This is the stripping that makes the assertions above mean
    // something, shown on the shape a person actually writes.
    const disabled = [
      '// const result = await withRunTimeout(',
      'const result = await runAssessmentJob(claimed);',
    ].join('\n');
    const stripped = disabled.replace(/^[ \t]*\/\/.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
    expect(stripped).not.toContain('withRunTimeout(');
    expect(stripped).toMatch(/await\s+runAssessmentJob\(/);
  });

  it('stops the loop when a run is orphaned', () => {
    // The old assertion was that `runIsOrphaned()` appears somewhere in the
    // file. What matters is that reading it leads to the loop ending.
    const branch = /if \(runIsOrphaned\(\)\) \{[\s\S]{0,400}?running = false;/.exec(code);
    expect(branch, 'nothing stops the loop after a run is orphaned').not.toBeNull();
  });

  it('is asserting against real source, not an empty string', () => {
    expect(code.length).toBeGreaterThan(2000);
    expect(code).toContain('processNextRequest');
  });
});
