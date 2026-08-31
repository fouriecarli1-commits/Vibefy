/**
 * What a customer can see of what they bought.
 *
 * The billing page could always say what a plan costs and what it contains. It
 * could not say how much of it was left — and an allowance you cannot see is
 * one you discover by being refused, which is the worst moment to learn it.
 *
 * The case worth being careful about is the re-test credit outside its window.
 * It is not a credit you still hold, and a meter that shows it as available is
 * a meter that lies in the customer's favour until the moment they try to use
 * it.
 */
import { describe, expect, it } from 'vitest';
import { entitlementFor } from './entitlements.ts';
import { CAPABILITIES, nextAssessmentAvailable, reTestWindow, usageMeters } from './usage.ts';

const NOW = new Date('2026-09-01T00:00:00Z');
const days = (from: Date, count: number) => {
  const out = new Date(from);
  out.setUTCDate(out.getUTCDate() + count);
  return out;
};

describe('the capability list', () => {
  it('describes every plan in the same words, so a reader can compare down a column', () => {
    for (const capability of CAPABILITIES) {
      const described = (['free', 'one_off', 'certified', 'agency', 'organisation'] as const).map(
        (plan) => capability.describe(entitlementFor(plan)),
      );
      expect(described.every((value) => value.length > 0)).toBe(true);
    }
  });

  it('says what the free tier does not get, rather than staying silent about it', () => {
    const free = entitlementFor('free');
    const described = CAPABILITIES.map((capability) => capability.describe(free));
    expect(described).toContain('Not eligible');
    expect(described).toContain('Not included');
  });

  it('names the cost ceiling, because it decides whether a run finishes', () => {
    const ceiling = CAPABILITIES.find((capability) => capability.label.includes('ceiling'));
    expect(ceiling).toBeDefined();
    expect(ceiling!.describe(entitlementFor('free'))).toBe(
      `$${entitlementFor('free').maxRunCostUsd.toFixed(2)}`,
    );
  });
});

describe('the application meter', () => {
  it('counts against the free tier limit', () => {
    const [apps] = usageMeters({
      plan: 'free',
      appsInWorkspace: 2,
      lastPaidAssessmentAt: null,
      reTestsUsed: 0,
      now: NOW,
    });
    expect(apps).toMatchObject({ used: 2, limit: entitlementFor('free').maxApps });
  });

  it('reports no limit as null rather than as a large number', () => {
    // "You have used 2 of ∞" is a sentence nobody needs. The page renders these
    // two cases differently, so they have to be distinguishable here.
    const [apps] = usageMeters({
      plan: 'one_off',
      appsInWorkspace: 2,
      lastPaidAssessmentAt: null,
      reTestsUsed: 0,
      now: NOW,
    });
    expect(apps!.limit).toBeNull();
  });
});

describe('the re-test meter', () => {
  it('does not exist on a plan with no credits', () => {
    const meters = usageMeters({
      plan: 'free',
      appsInWorkspace: 1,
      lastPaidAssessmentAt: null,
      reTestsUsed: 0,
      now: NOW,
    });
    expect(meters.map((meter) => meter.label)).not.toContain('Free re-tests');
  });

  it('shows what is left while the window is open', () => {
    const meters = usageMeters({
      plan: 'certified',
      appsInWorkspace: 1,
      lastPaidAssessmentAt: days(NOW, -5),
      reTestsUsed: 1,
      now: NOW,
    });
    const reTests = meters.find((meter) => meter.label === 'Free re-tests')!;
    expect(reTests.used).toBe(1);
    expect(reTests.limit).toBe(entitlementFor('certified').reTestCredits);
    expect(reTests.detail).toMatch(/Until \d{4}-\d{2}-\d{2}/);
  });

  it('shows the credits spent once the window has closed', () => {
    // Not "2 of 2 remaining". The window is what makes them credits, and a
    // customer reading an expired allowance as available is a complaint waiting
    // to happen.
    const entitlement = entitlementFor('certified');
    const meters = usageMeters({
      plan: 'certified',
      appsInWorkspace: 1,
      lastPaidAssessmentAt: days(NOW, -(entitlement.reTestWindowDays + 1)),
      reTestsUsed: 0,
      now: NOW,
    });
    const reTests = meters.find((meter) => meter.label === 'Free re-tests')!;
    expect(reTests.used).toBe(entitlement.reTestCredits);
    expect(reTests.detail).toMatch(/window .* has closed/i);
  });

  it('says the window has not opened yet when nothing has been bought', () => {
    const meters = usageMeters({
      plan: 'one_off',
      appsInWorkspace: 1,
      lastPaidAssessmentAt: null,
      reTestsUsed: 0,
      now: NOW,
    });
    const reTests = meters.find((meter) => meter.label === 'Free re-tests')!;
    expect(reTests.detail).toMatch(/opens when you buy/i);
  });

  it('never reports more used than the plan grants', () => {
    const entitlement = entitlementFor('one_off');
    const meters = usageMeters({
      plan: 'one_off',
      appsInWorkspace: 1,
      lastPaidAssessmentAt: days(NOW, -1),
      reTestsUsed: 99,
      now: NOW,
    });
    const reTests = meters.find((meter) => meter.label === 'Free re-tests')!;
    expect(reTests.used).toBe(entitlement.reTestCredits);
  });
});

describe('the re-test window', () => {
  it('is null until something has been paid for', () => {
    expect(reTestWindow(entitlementFor('certified'), null)).toBeNull();
  });

  it('is null on a plan that grants none', () => {
    expect(reTestWindow(entitlementFor('free'), NOW)).toBeNull();
  });

  it('runs from the paid assessment, not from the plan starting', () => {
    const entitlement = entitlementFor('certified');
    expect(reTestWindow(entitlement, NOW)).toEqual(days(NOW, entitlement.reTestWindowDays));
  });
});

describe('when an application may next be assessed', () => {
  it('is a date on the free tier, so it can be shown rather than only refused', () => {
    const entitlement = entitlementFor('free');
    const last = new Date('2026-08-30T00:00:00Z');
    expect(nextAssessmentAvailable('free', last)).toEqual(days(last, entitlement.cooldownDays!));
  });

  it('is null on a paid plan, which has no waiting period', () => {
    expect(nextAssessmentAvailable('one_off', new Date('2026-08-30T00:00:00Z'))).toBeNull();
  });

  it('is null before anything has run', () => {
    expect(nextAssessmentAvailable('free', null)).toBeNull();
  });
});
