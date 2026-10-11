/**
 * One free re-test within thirty days, which is what we sell and publish.
 *
 * `legal/refund-and-cancellation.md`: "A completed assessment includes one free
 * re-test within 30 days." The entitlement table agrees — `reTestCredits: 1`,
 * `reTestWindowDays: 30` for a one-off purchase — and `usageMeters` renders it
 * as a meter the customer can see. Three statements of the same rule, in
 * agreement with each other.
 *
 * The decision that grants the credit disagreed with all three, and not at the
 * margin:
 *
 *     const last = context.previousAssessments[0];
 *     if (entitlement.reTestCredits > 0 && last?.paid) {
 *       const windowEnds = last.completedAt + reTestWindowDays;
 *       const creditsUsed = context.previousAssessments.filter(
 *         (a) => !a.paid && a.completedAt > last.completedAt,
 *       ).length;
 *
 *   · `creditsUsed` counts completions strictly after the most recent
 *     completion, which is empty by construction. Always zero, every plan.
 *   · The window ran from the most recent assessment rather than from the
 *     payment, so taking a re-test pushed the window out another thirty days.
 *   · `paid` on a history row means "an invoice for this app was paid before
 *     this assessment completed", which is true of every assessment after the
 *     first purchase — the free re-tests among them.
 *
 * Measured, not read: a one-off purchase with five runs a month apart returns
 * `usesReTestCredit: true` on the sixth, five months after the payment. And
 * `usageMeters` clamped the count it displays to the limit, so the one screen
 * that could have shown it said "1 of 1".
 *
 * The window now comes from the payment and the credits spent are the count of
 * `uses_retest_credit` assessments since it — the same two facts the meter
 * reads, which is the point. What happens when the credits are gone is a
 * separate question with money attached, and it is in `docs/OPEN_ITEMS.md`
 * rather than decided here: a one-off purchase still permits the run.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  decideAssessmentRequest,
  entitlementFor,
  reTestWindow,
  usageMeters,
  type AssessmentRequestContext,
} from '../packages/billing/src/index.ts';

const PAID = new Date('2026-08-10T00:00:00Z');
const day = (from: Date, count: number) => {
  const out = new Date(from);
  out.setUTCDate(out.getUTCDate() + count);
  return out;
};

const request = (over: Partial<AssessmentRequestContext> = {}): AssessmentRequestContext => ({
  plan: 'one_off',
  subscriptionStatus: null,
  appsInWorkspace: 1,
  previousAssessments: [],
  lastPaidAt: PAID,
  reTestsUsed: 0,
  appIsAuthorised: true,
  now: day(PAID, 5),
  ...over,
});

describe('the window', () => {
  it('runs from the payment, so using a re-test does not extend it', () => {
    // The whole defect in one case. Four re-tests taken, the last of them
    // yesterday, and the window still closes thirty days after the payment.
    const ends = reTestWindow(entitlementFor('one_off'), PAID);
    expect(ends?.toISOString().slice(0, 10)).toBe('2026-09-09');

    const late = decideAssessmentRequest(
      request({
        reTestsUsed: 0,
        now: day(PAID, 31),
        previousAssessments: [{ completedAt: day(PAID, 30), paid: true }],
      }),
    );
    expect(late.usesReTestCredit).toBe(false);
  });

  it('is the same arithmetic the customer is shown', () => {
    const entitlement = entitlementFor('one_off');
    const meter = usageMeters({
      plan: 'one_off',
      appsInWorkspace: 1,
      lastPaidAssessmentAt: PAID,
      reTestsUsed: 0,
      now: day(PAID, 5),
    }).find((row) => row.label === 'Free re-tests');
    expect(meter?.detail).toContain(reTestWindow(entitlement, PAID)!.toISOString().slice(0, 10));
  });

  it('does not open at all without a payment', () => {
    expect(reTestWindow(entitlementFor('one_off'), null)).toBeNull();
    expect(decideAssessmentRequest(request({ lastPaidAt: null })).usesReTestCredit).toBe(false);
  });
});

describe('the credit', () => {
  it('is granted once inside the window', () => {
    const decision = decideAssessmentRequest(request());
    expect(decision.allowed).toBe(true);
    expect(decision.usesReTestCredit).toBe(true);
  });

  it('is spent, and the next run is not free', () => {
    expect(decideAssessmentRequest(request({ reTestsUsed: 1 })).usesReTestCredit).toBe(false);
  });

  it('is counted up to the number the plan grants, not once per plan', () => {
    // certified: 2, agency: 4, organisation: 8. Under the old arithmetic the
    // count was always zero, so every one of these was granted for ever; the
    // second and later ones were never recorded as spent either.
    for (const [plan, credits] of [
      ['certified', 2],
      ['agency', 4],
      ['organisation', 8],
    ] as const) {
      const context = { plan, subscriptionStatus: 'active' as const };
      for (let used = 0; used < credits; used += 1) {
        expect(
          decideAssessmentRequest(request({ ...context, reTestsUsed: used })).usesReTestCredit,
          `${plan} with ${used} used`,
        ).toBe(true);
      }
      expect(
        decideAssessmentRequest(request({ ...context, reTestsUsed: credits })).usesReTestCredit,
        `${plan} with all ${credits} used`,
      ).toBe(false);
    }
  });

  it('does not reappear after the window closes, however many are left', () => {
    expect(
      decideAssessmentRequest(request({ reTestsUsed: 0, now: day(PAID, 40) })).usesReTestCredit,
    ).toBe(false);
  });
});

describe('what the sixth run on one purchase was', () => {
  it('is no longer a free re-test five months later', () => {
    // The measured case, kept as a case. Five runs a month apart, each of them
    // "paid" in the only sense that query can mean, and the sixth asked for.
    const history = [30, 60, 90, 120, 150].map((offset) => ({
      completedAt: day(PAID, offset),
      paid: true,
    }));
    const decision = decideAssessmentRequest(
      request({
        previousAssessments: [...history].reverse(),
        reTestsUsed: 1,
        now: day(PAID, 160),
      }),
    );
    expect(decision.usesReTestCredit).toBe(false);
  });
});

describe('the published sentence this holds', () => {
  const terms = readFileSync('legal/refund-and-cancellation.md', 'utf8');

  it('is still one re-test within thirty days', () => {
    // If this sentence changes, the entitlement table and these cases are what
    // has to change with it — and the other way round. A published promise
    // nobody reads is the shape this whole file belongs to.
    expect(terms).toMatch(/one free re-test within 30 days/i);
    const entitlement = entitlementFor('one_off');
    expect(entitlement.reTestCredits).toBe(1);
    expect(entitlement.reTestWindowDays).toBe(30);
  });
});
