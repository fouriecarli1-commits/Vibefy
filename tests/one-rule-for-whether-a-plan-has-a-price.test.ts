/**
 * Whether a plan has a price in a currency, asked in one place.
 *
 * It was asked in four, across three files, each spelling it out again:
 * `priceForPlan` and `plansPricedIn` in `routing.ts`, `priceOf` on the billing
 * page, and the admin cost table. Three copies is how a rule forks, and two of
 * them had already drifted — `priceForPlan` treats `null` and `undefined` alike
 * and refuses, while `plansPricedIn` filters only on `!== null`.
 *
 * So a tier added without a `priceZar` key at all is listed on the pricing page
 * and refused at checkout. Nothing in between says a word: the customer picks a
 * plan they were shown, and is told it has no price.
 *
 * Every tier in `config/pricing.json` carries both keys today, which is why
 * this was latent rather than live, and why it is held at the predicate rather
 * than against the real file.
 */
import { describe, expect, it } from 'vitest';
import pricing from '../config/pricing.json' with { type: 'json' };
import {
  PriceNotSetError,
  plansPricedIn,
  priceForPlan,
  priceIn,
} from '../packages/billing/src/routing.ts';
import type { Currency } from '../packages/billing/src/provider.ts';

const CURRENCIES: readonly Currency[] = ['ZAR', 'USD'];

describe('whether a plan has a price in a currency', () => {
  it('reads an absent key as no price, not as a price', () => {
    // The drift. `!== null` says a missing key is a price; the checkout says
    // it is not, and the checkout is the one the customer meets.
    expect(priceIn({ priceUsd: 79 }, 'ZAR')).toBeNull();
    expect(priceIn({ priceUsd: 79, priceZar: null }, 'ZAR')).toBeNull();
  });

  it('reads zero as a price, because the free tier is priced at zero', () => {
    // `??` rather than `||`, and this is why.
    expect(priceIn({ priceUsd: 0, priceZar: 0 }, 'USD')).toBe(0);
    expect(priceIn({ priceUsd: 0, priceZar: 0 }, 'ZAR')).toBe(0);
  });

  it('returns the price of the currency it was asked about', () => {
    expect(priceIn({ priceUsd: 79, priceZar: 1499 }, 'USD')).toBe(79);
    expect(priceIn({ priceUsd: 79, priceZar: 1499 }, 'ZAR')).toBe(1499);
  });
});

describe('the page and the checkout', () => {
  for (const currency of CURRENCIES) {
    it(`agree about every plan offered in ${currency}`, () => {
      // The property the fork broke: anything the pricing page lists can be
      // bought, and anything it does not list cannot.
      for (const plan of plansPricedIn(currency)) {
        expect(() => priceForPlan(plan, currency)).not.toThrow();
      }
      const offered = new Set<string>(plansPricedIn(currency));
      for (const tier of pricing.tiers) {
        if (tier.id === 'free' || offered.has(tier.id)) continue;
        expect(() => priceForPlan(tier.id as never, currency)).toThrow(PriceNotSetError);
      }
    });
  }

  it('never offers the free tier, which is not sold', () => {
    for (const currency of CURRENCIES) {
      expect(plansPricedIn(currency)).not.toContain('free');
    }
  });
});
