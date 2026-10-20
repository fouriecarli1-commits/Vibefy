/**
 * The one way past a hard ceiling: stop the total being a number.
 *
 * PART 9 of the brief is why this meter exists — "if unit cost exceeds price,
 * the business is dead" — and `assertHeadroom` is the wall a runaway agent loop
 * is supposed to hit. It asked `total > limit`.
 *
 * `NaN > 4` is false. So one unmeasurable figure anywhere in the ledger did not
 * stop the run: it waved through every call after it, for the rest of the run,
 * with the meter reading NaN and nothing written anywhere to say the ceiling
 * had stopped existing. The bill is the first anybody hears of it.
 *
 * `TokenUsage` declares these as numbers and the SDK's own types agree, which
 * is exactly why nothing looked — but every transport that is not the real
 * client supplies them by hand, the scripted one in these tests included, and
 * `undefined` through an arithmetic expression is NaN rather than an error.
 *
 * The copilot route has carried this lesson in a comment since the day its
 * ceiling was fixed: "`NaN >= 2` is false, so a spend figure that came back
 * malformed also permitted the call." That route guards a few cents. This meter
 * guards the run.
 */
import { describe, expect, it } from 'vitest';
import {
  CostCeilingExceededError,
  CostMeter,
  UnmeteredCallError,
  costOfCall,
} from '../packages/engine/src/runtime/cost.ts';
import type { TokenUsage } from '../packages/engine/src/runtime/cost.ts';

const usage = (over: Partial<TokenUsage> = {}): TokenUsage => ({
  inputTokens: 1000,
  outputTokens: 400,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  ...over,
});

describe('a call that cannot be costed', () => {
  it('is refused rather than recorded as nothing', () => {
    const meter = new CostMeter({ maxRunCostUsd: 4 });
    expect(() =>
      meter.recordModelCall('synthesis', 'claude-opus-5', usage({ inputTokens: Number.NaN })),
    ).toThrow(UnmeteredCallError);
    // Nothing stored, so the ledger a run reports is still arithmetic.
    expect(meter.entries).toHaveLength(0);
    expect(Number.isFinite(meter.totalUsd)).toBe(true);
  });

  it('names the stage and the figure, because this is somebody’s bill', () => {
    const meter = new CostMeter({ maxRunCostUsd: 4 });
    try {
      meter.recordModelCall('exploration', 'claude-opus-5', usage({ outputTokens: Number.NaN }));
      expect.unreachable('an uncostable call was recorded');
    } catch (error) {
      expect(String(error)).toMatch(/exploration/);
      expect(String(error)).toMatch(/output tokens/);
      expect(String(error), 'the sentence that says why this is not nought').toMatch(
        /ceiling cannot see/,
      );
    }
  });

  it('refuses a count that is missing as readily as one that is not a number', () => {
    const meter = new CostMeter({ maxRunCostUsd: 4 });
    const missing = { outputTokens: 400 } as unknown as TokenUsage;
    expect(() => meter.recordModelCall('triage', 'claude-opus-5', missing)).toThrow(
      UnmeteredCallError,
    );
  });

  it('refuses a negative count, which is not a refund', () => {
    const meter = new CostMeter({ maxRunCostUsd: 4 });
    expect(() =>
      meter.recordModelCall('triage', 'claude-opus-5', usage({ inputTokens: -1_000_000 })),
    ).toThrow(UnmeteredCallError);
  });

  it('holds compute to the same rule', () => {
    const meter = new CostMeter({ maxRunCostUsd: 4 });
    // A clock that goes backwards over a long stage is how this one arrives.
    expect(() => meter.recordCompute('browser', -40)).toThrow(UnmeteredCallError);
    expect(() => meter.recordCompute('browser', Number.NaN)).toThrow(UnmeteredCallError);
    expect(meter.entries).toHaveLength(0);
  });
});

describe('the wall itself', () => {
  it('stops a run whose total cannot be established', () => {
    // The belt to the braces above: were a figure to reach the ledger by some
    // path this does not know about, the comparison still has to fail closed.
    const meter = new CostMeter({ maxRunCostUsd: 4 });
    expect(() => meter.assertHeadroom(Number.NaN)).toThrow(CostCeilingExceededError);
  });

  it('still allows a run that is exactly at its ceiling', () => {
    // The rewrite must not tighten the boundary. Spending the last cent of a
    // ceiling is allowed; the next call is not.
    const meter = new CostMeter({ maxRunCostUsd: costOfCall('claude-opus-5', usage()) });
    expect(() => meter.recordModelCall('triage', 'claude-opus-5', usage())).not.toThrow();
    expect(() => meter.assertHeadroom(0.000001)).toThrow(CostCeilingExceededError);
  });

  it('still stops an ordinary runaway', () => {
    const meter = new CostMeter({ maxRunCostUsd: 0.05 });
    expect(() => {
      for (let call = 0; call < 50; call += 1) {
        meter.recordModelCall('exploration', 'claude-opus-5', usage({ outputTokens: 10_000 }));
      }
    }).toThrow(CostCeilingExceededError);
    expect(meter.totalUsd).toBeGreaterThan(0);
  });

  it('is still a ceiling at construction', () => {
    // The precedent this follows: `!(x > 0)` was already written the
    // fail-closed way here, and NaN is why.
    expect(() => new CostMeter({ maxRunCostUsd: Number.NaN })).toThrow(/not a ceiling/);
  });
});
