/**
 * What a paying customer can see about what they are paying for.
 *
 * The billing page could already list plans and take a payment. What it could
 * not do was answer the question a customer actually asks a month later: what
 * do I have, how much of it is left, and what would the next plan up change?
 * A plan you can buy but cannot inspect is a plan people distrust.
 *
 * These assertions are about reachability and honesty rather than layout: that
 * billing is one click from the console rather than two levels into a menu, and
 * that every figure on the page is read from the table the engine enforces
 * rather than typed into the copy beside it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENTITLEMENTS, entitlementFor } from '../packages/billing/src/entitlements.ts';
import { CAPABILITIES } from '../packages/billing/src/usage.ts';

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');
const billing = read('apps/web/app/console/billing/page.tsx');
const consolePage = read('apps/web/app/console/page.tsx');

describe('getting to billing', () => {
  it('is one click from the console front door, not only from a menu', () => {
    expect(consolePage).toContain('/console/billing');
    expect(consolePage).toContain('Plan &amp; billing');
  });

  it('shows the plan on that front door, so it is known before a run is refused', () => {
    expect(consolePage).toContain('entitlementFor');
    expect(consolePage).toContain('badgeEligible');
  });
});

describe('what the page shows about the current plan', () => {
  it('renders how much of each allowance is gone, not only what was bought', () => {
    expect(billing).toContain('usageMeters');
    expect(billing).toContain('meter.used');
    expect(billing).toContain('meter.limit');
  });

  it('distinguishes an unlimited allowance from an unused one', () => {
    // "2 of ∞" is not a sentence. The two cases render differently and the
    // meter has to keep them distinguishable to allow that.
    expect(billing).toContain('no limit');
  });

  it('does not render a bar as the only signal', () => {
    // Colour and width are not readable to everyone. The figure is the fact;
    // the bar only makes it glanceable, and is hidden from assistive technology
    // so it does not repeat the sentence beside it.
    expect(billing).toContain('aria-hidden="true"');
  });
});

describe('comparing plans', () => {
  it('marks the plan the reader is on', () => {
    expect(billing).toContain('yours');
    expect(billing).toContain('PLAN_TIERS');
  });

  it('builds every cell from the entitlement table', () => {
    // The failure this prevents: a comparison table that promises something the
    // engine does not do, because the copy and the enforcement drifted apart.
    expect(billing).toContain('CAPABILITIES');
    expect(billing).toContain('capability.describe(entitlementFor(plan))');
  });

  it('covers the facts that decide whether a run finishes or a badge issues', () => {
    const labels = CAPABILITIES.map((capability) => capability.label);
    expect(labels).toContain('Assessment depth');
    expect(labels).toContain('Badge');
    expect(labels).toContain('Cost ceiling per run');
  });

  it('says something for every plan in every row', () => {
    for (const capability of CAPABILITIES) {
      for (const plan of Object.keys(ENTITLEMENTS) as (keyof typeof ENTITLEMENTS)[]) {
        expect(capability.describe(entitlementFor(plan)).trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe('what payment is still not allowed to buy', () => {
  it('says so on the page where money changes hands', () => {
    // The one sentence on this page that has to survive every redesign.
    expect(billing).toContain('never buys a score');
    expect(billing).toContain('independence');
  });

  it('does not describe a plan as buying a better result', () => {
    const forbidden = /buy[a-z]* (a|the|your) (better|higher|good) (score|rating|result)/i;
    expect(billing).not.toMatch(forbidden);
  });
});
