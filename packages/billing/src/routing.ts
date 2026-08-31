/**
 * Who takes the money, and in what.
 *
 * VibefyCode sells into South Africa and the United States. One provider cannot
 * serve both well: a South African customer needs rands and the local cards and
 * instant EFT their bank supports, and an American customer needs the provider
 * their card issuer has heard of. So there are two, and this file is the whole
 * of the decision between them — one function, testable, with no network in it.
 *
 * The rule is deliberately dull: the country the customer says they are billed
 * in picks the currency, and the currency picks the provider. Nothing here
 * looks at what somebody can afford, what they have spent, or which provider
 * charges us less. A customer who is quoted one price and charged another has
 * been lied to, however small the difference.
 */
import pricing from '../../../config/pricing.json' with { type: 'json' };
import type { Currency, PlanId, ProviderName } from './provider.ts';

/** Where rands are the right answer. */
export const ZAR_COUNTRIES: readonly string[] = ['ZA'];

export function currencyForCountry(country: string | null | undefined): Currency {
  if (!country) return 'USD';
  return ZAR_COUNTRIES.includes(country.toUpperCase()) ? 'ZAR' : 'USD';
}

export function providerForCurrency(currency: Currency): ProviderName {
  return currency === 'ZAR' ? 'paystack' : 'stripe';
}

export function providerForCountry(country: string | null | undefined): ProviderName {
  return providerForCurrency(currencyForCountry(country));
}

export class PriceNotSetError extends Error {}

/**
 * The price of a plan in one currency, in whole units.
 *
 * Never converted. A rand price is not a dollar price times an exchange rate:
 * it is a decision about what this is worth in that market, and it is taken by
 * a person and written into `config/pricing.json`. A plan with no price in the
 * currency somebody is buying in is refused here, loudly, rather than quietly
 * charged at a rate nobody chose.
 */
export function priceForPlan(plan: PlanId, currency: Currency): number {
  const tier = pricing.tiers.find((entry) => entry.id === plan);
  if (!tier) throw new PriceNotSetError(`No pricing tier called "${plan}".`);

  const price = currency === 'ZAR' ? tier.priceZar : tier.priceUsd;
  if (price === null || price === undefined) {
    throw new PriceNotSetError(
      `Plan "${plan}" has no ${currency} price. Set one in config/pricing.json — a price in another currency is a decision, not a conversion.`,
    );
  }
  return price;
}

/** Every plan that can actually be sold in a currency, for the pricing page. */
export function plansPricedIn(currency: Currency): readonly PlanId[] {
  return pricing.tiers
    .filter((tier) => tier.id !== 'free')
    .filter((tier) => (currency === 'ZAR' ? tier.priceZar : tier.priceUsd) !== null)
    .map((tier) => tier.id as PlanId);
}
