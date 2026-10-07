/**
 * Nine sweeps go through one guard, and a sweep that hangs stops for ever.
 *
 * `once(name, work)` in the worker's main loop refuses to start a sweep whose
 * previous run is still going, which is right and the reason is written out:
 * "every sweep here is idempotent, which is not the same thing as safe to run
 * twice at once: two runs can both read a row as un-acted-on before either
 * writes, and then both act on it. That is a second re-assessment somebody
 * pays for."
 *
 * Nothing bounds how long a sweep may take. A promise that never settles keeps
 * its name in `running_sweeps` for the life of the process, and every later
 * tick logs
 *
 *     sweep still running, skipping this tick
 *
 * which reads as busy. Drift detection, scheduled re-assessments, liveness,
 * badge expiry warnings, the superseded-rubric notice, alert push, alert email,
 * badge issuance and badge lifecycle all run through it. Any one of them
 * hanging — a pool with no client left to hand out, a liveness probe with no
 * timeout, a query with no statement timeout — stops that sweep permanently, and
 * the signal is a line saying it is working.
 *
 * It is the same problem the assessment path already solved forty lines up.
 * `withRunTimeout` exists because "nothing else bounds a run's wall-clock time:
 * the scope guard's thirty-minute ceiling is only checked when a request passes
 * through it, so a model call or a page load that hangs never reaches it". The
 * sweeps are that "nothing else".
 *
 * And the answer is the same answer, for the same reason: a promise cannot be
 * cancelled, so releasing the name would let a second run start beside the
 * stuck one and double-charge somebody. `runIsOrphaned` ends the process so a
 * fresh worker starts clean, and a stuck sweep does that now too.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SWEEP_STUCK_AFTER_MS,
  clearStuckSweep,
  noteSweepStarted,
  noteSweepFinished,
  stuckSweep,
} from '../apps/worker/src/main.ts';

afterEach(() => {
  clearStuckSweep();
});

describe('a sweep that is simply slow', () => {
  it('is not called stuck', () => {
    noteSweepStarted('drift', 1_000);
    expect(stuckSweep(1_000 + SWEEP_STUCK_AFTER_MS - 1)).toBeNull();
  });

  it('is forgotten when it finishes', () => {
    noteSweepStarted('drift', 1_000);
    noteSweepFinished('drift');
    // Hours later, with nothing running, nothing is stuck.
    expect(stuckSweep(1_000 + SWEEP_STUCK_AFTER_MS * 10)).toBeNull();
  });
});

describe('a sweep that has not finished', () => {
  it('is named once it has been going longer than any sweep should take', () => {
    noteSweepStarted('badge expiry', 1_000);
    const stuck = stuckSweep(1_000 + SWEEP_STUCK_AFTER_MS + 1);
    expect(stuck?.name).toBe('badge expiry');
    expect(stuck?.forMs).toBeGreaterThan(SWEEP_STUCK_AFTER_MS);
  });

  it('is named even while other sweeps come and go around it', () => {
    noteSweepStarted('liveness', 1_000);
    noteSweepStarted('drift', 1_000 + SWEEP_STUCK_AFTER_MS);
    noteSweepFinished('drift');
    expect(stuckSweep(1_000 + SWEEP_STUCK_AFTER_MS + 1)?.name).toBe('liveness');
  });

  it('names the one that has been going longest, not whichever is first', () => {
    noteSweepStarted('alert push', 5_000);
    noteSweepStarted('alert email', 1_000);
    expect(stuckSweep(1_000 + SWEEP_STUCK_AFTER_MS * 2)?.name).toBe('alert email');
  });
});

describe('the bound itself', () => {
  it('is longer than the interval the sweeps run on, by a wide margin', async () => {
    const { REPORT_SWEEP_INTERVAL_MS, MONITOR_SWEEP_INTERVAL_MS } = await import(
      '../apps/worker/src/main.ts'
    );
    // Not a tick or two: a sweep that is merely slow must never be called
    // stuck, because the response is to end the process.
    expect(SWEEP_STUCK_AFTER_MS).toBeGreaterThan(REPORT_SWEEP_INTERVAL_MS * 10);
    expect(SWEEP_STUCK_AFTER_MS).toBeGreaterThan(MONITOR_SWEEP_INTERVAL_MS * 2);
  });
});

describe('what the loop does about it', () => {
  /** The code, without comments — which quote the defect on purpose. */
  const source = readFileSync(join(import.meta.dirname, '..', 'apps/worker/src/main.ts'), 'utf8')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && trimmed !== '/**';
    })
    .join('\n');

  it('ends the process, as it already does for a run it cannot cancel', () => {
    expect(source).toMatch(/stuckSweep\(/);
    expect(source).toMatch(/running = false/);
  });

  it('says which sweep and for how long, not that it is still running', () => {
    expect(source).toMatch(/worker stopping: a sweep/);
  });

  it('still refuses to start a second run of a sweep that is going', () => {
    // The guard this sits inside. Releasing the name would let two runs act on
    // one row, which is a second re-assessment somebody pays for.
    expect(source).toMatch(/running_sweeps\.has\(name\)/);
    expect(source).toMatch(/sweep still running, skipping this tick/);
  });
});
