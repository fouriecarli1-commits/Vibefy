/**
 * The global daily ceiling, against a figure that is not a number.
 *
 * This file's own first paragraph says what it is for: "the failure it guards
 * against is not one expensive run. It is a thousand cheap ones started by a
 * loop nobody is watching at three in the morning." Every decision in it is
 * `observed >= ceiling`.
 *
 * `NaN >= 100` is false. So an unreadable figure produced no pause, no warning
 * and no action of any kind — and `sweepSpendCap` reports actions, so the sweep
 * that runs every five minutes would have gone on returning nothing at all. The
 * one state in which this file is silent is the state in which nobody can see
 * what is being spent.
 *
 * An alert and not a pause: stopping every customer's work over one malformed
 * figure is an outage we would have caused ourselves, and whether it should go
 * further than an alert is in `docs/OPEN_ITEMS.md` as the founder's call. What
 * was never hers to decide is whether anybody is told.
 */
import { describe, expect, it } from 'vitest';
import { CEILINGS, evaluateSpend } from '../packages/governance/src/spend.ts';

const observation = (over: Partial<Parameters<typeof evaluateSpend>[0]> = {}) => ({
  todayUsd: 1,
  freeTierThisWeekUsd: 1,
  alreadyPaused: false,
  ...over,
});

describe('spending that could not be measured', () => {
  it('produces an action rather than silence', () => {
    const actions = evaluateSpend(observation({ todayUsd: Number.NaN }));
    expect(actions, 'the ceiling met an unreadable figure and did nothing').toHaveLength(1);
    expect(actions[0]!.trigger).toBe('spend_unreadable');
    expect(actions[0]!.kind).toBe('alert');
  });

  it('says that the ceiling is not being enforced, and that work continues', () => {
    const [action] = evaluateSpend(observation({ todayUsd: Number.NaN }));
    expect(action!.reason).toMatch(/could not be measured/i);
    expect(action!.reason).toMatch(/cannot be enforced/i);
    // The sentence has to say work is still starting, because the reader's
    // first assumption about a spend alert is that something stopped.
    expect(action!.reason).toMatch(/still starting/i);
    // And that this is not a figure anybody spent.
    expect(action!.reason).toMatch(/not a spend/i);
  });

  it('names which window it could not read', () => {
    expect(evaluateSpend(observation({ todayUsd: Number.NaN }))[0]!.reason).toMatch(/todayUsd/);
    expect(evaluateSpend(observation({ freeTierThisWeekUsd: Number.NaN }))[0]!.reason).toMatch(
      /freeTierThisWeekUsd/,
    );
    const both = evaluateSpend(
      observation({ todayUsd: Number.NaN, freeTierThisWeekUsd: Number.NaN }),
    );
    expect(both[0]!.reason).toMatch(/todayUsd and freeTierThisWeekUsd/);
  });

  it('does not also report thresholds it could not compare against', () => {
    // A pause reason carrying "$NaN" is worse than no reason: somebody reads it
    // as a figure. One action, about the figures themselves.
    const actions = evaluateSpend(observation({ todayUsd: Number.NaN }));
    expect(actions.every((action) => !/NaN/.test(action.reason))).toBe(true);
    expect(actions.map((action) => action.trigger)).toEqual(['spend_unreadable']);
  });

  it('is the same answer whether or not spending is already paused', () => {
    // `alreadyPaused` suppresses the pause and the warning, and an unreadable
    // figure is not about the pause: it is about not being able to see.
    const actions = evaluateSpend(observation({ todayUsd: Number.NaN, alreadyPaused: true }));
    expect(actions.map((action) => action.trigger)).toEqual(['spend_unreadable']);
  });
});

describe('the ceilings that still work', () => {
  it('still pauses at the daily ceiling', () => {
    const actions = evaluateSpend(observation({ todayUsd: CEILINGS.globalDailyUsd }));
    expect(actions.map((action) => action.kind)).toContain('pause');
  });

  it('still warns at four fifths', () => {
    const actions = evaluateSpend(observation({ todayUsd: CEILINGS.globalDailyUsd * 0.81 }));
    expect(actions.map((action) => action.trigger)).toContain('daily_warning');
    expect(actions.map((action) => action.kind)).not.toContain('pause');
  });

  it('still says nothing when there is nothing to say', () => {
    expect(evaluateSpend(observation({ todayUsd: 0, freeTierThisWeekUsd: 0 }))).toEqual([]);
  });
});
