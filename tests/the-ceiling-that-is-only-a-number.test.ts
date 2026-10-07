/**
 * Three ceilings on the cost dashboard, two of them applied by something.
 *
 * `/admin/costs` carries a panel headed "Ceilings" with three figures side by
 * side, laid out identically, in the same type. Two of them are real: the global
 * daily ceiling writes a row to `spend_pauses` and the worker claims nothing
 * while a pause is live, and the free-tier weekly budget raises an alert.
 *
 * The third — "Free tier, per account per month: $2.00" — is applied by nothing.
 * `freeTierPerAccountMonthlyUsd` is read in exactly two places: the panel that
 * displays it, and the constant that holds it. `evaluateSpend` never looks at
 * it, no migration mentions it, and nothing on the enqueue path consults it.
 *
 * That alone is a dashboard telling its only reader something untrue. What
 * makes it worth a test rather than a note is that the figure is also wrong,
 * and the arithmetic says so:
 *
 *     maxApps 3 × perRunCostUsd.limited $1.00 = $3.00
 *
 * A new free account can register three applications and assess all three the
 * day it signs up. The 90-day cooldown holds it to about $1.00 a month
 * afterwards, so the published ceiling is right from month two and exceeded by
 * half in month one — which is precisely the month a growth spike consists of.
 *
 * The figures are pinned here on purpose. They are the ones the dashboard
 * quotes, and changing `maxApps` or `perRunCostUsd.limited` without revisiting
 * what the dashboard says about them is how this sentence goes stale.
 */
import { describe, expect, it } from 'vitest';
import {
  CEILINGS,
  evaluateSpend,
  freeTierFirstMonthUsd,
  freeTierSteadyMonthUsd,
  publishedCeilings,
} from '../packages/governance/src/index.ts';
import { entitlementFor } from '../packages/billing/src/entitlements.ts';

const free = entitlementFor('free');
const shape = {
  maxApps: free.maxApps ?? 0,
  cooldownDays: free.cooldownDays,
  maxRunCostUsd: free.maxRunCostUsd,
};

describe('what applies the per-account free-tier ceiling', () => {
  it('is nothing in evaluateSpend, at any spend', () => {
    // Driven far past the figure from both directions. If anything in the
    // spend sweep applied it, one of these would carry its trigger.
    const actions = evaluateSpend({
      todayUsd: CEILINGS.freeTierPerAccountMonthlyUsd * 100,
      freeTierThisWeekUsd: CEILINGS.freeTierPerAccountMonthlyUsd * 100,
      alreadyPaused: false,
    });

    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) expect(action.trigger).not.toBe('free_tier_per_account');
  });

  it('is the plan structure, and the structure does not hold it in month one', () => {
    expect(shape).toEqual({ maxApps: 3, cooldownDays: 90, maxRunCostUsd: 1 });
    expect(freeTierFirstMonthUsd(shape)).toBe(3);
    expect(freeTierFirstMonthUsd(shape)).toBeGreaterThan(CEILINGS.freeTierPerAccountMonthlyUsd);
  });

  it('does hold it once the cooldown is running', () => {
    expect(freeTierSteadyMonthUsd(shape)).toBeCloseTo(1, 5);
    expect(freeTierSteadyMonthUsd(shape)).toBeLessThanOrEqual(
      CEILINGS.freeTierPerAccountMonthlyUsd,
    );
  });
});

describe('the panel that shows them', () => {
  const panel = publishedCeilings(shape);

  it('shows the three the brief asks for', () => {
    expect(panel).toHaveLength(3);
  });

  it('names what applies each one, for every one of them', () => {
    // The rule this file exists to hold. A figure with nothing applying it is
    // not a ceiling, and must not be laid out beside two that are as though it
    // were the third of a matching set.
    for (const ceiling of panel) {
      expect(ceiling.appliedBy.length).toBeGreaterThan(20);
    }
  });

  it('says plainly that the per-account figure is applied by nothing', () => {
    const perAccount = panel.find((ceiling) => ceiling.label.includes('per account'))!;
    expect(perAccount.appliedBy).toMatch(/nothing applies it/i);
  });

  it('quotes the arithmetic that contradicts it, with the figure', () => {
    const perAccount = panel.find((ceiling) => ceiling.label.includes('per account'))!;
    expect(perAccount.appliedBy).toContain('$3.00');
  });

  it('does not say that about the two that are applied', () => {
    // The direction this fails in: a caveat on every figure, which is a panel
    // nobody can read a fact off.
    const applied = panel.filter((ceiling) => !ceiling.label.includes('per account'));
    expect(applied).toHaveLength(2);
    for (const ceiling of applied) expect(ceiling.appliedBy).not.toMatch(/nothing applies it/i);
  });

  it('names the pause for the one that pauses, because that is the whole point', () => {
    const daily = panel.find((ceiling) => ceiling.label.includes('Global daily'))!;
    expect(daily.appliedBy).toMatch(/pause/i);
  });
});
