import {
  FakePaymentProvider,
  PaystackProvider,
  StripeProvider,
  priceForPlan,
  providerForCurrency,
  type Currency,
  type PaymentProvider,
  type PlanId,
  type ProviderName,
} from '@vibefycode/billing';

/**
 * Which provider takes this customer's money, built once, here.
 *
 * VibefyCode sells into South Africa and the United States. Stripe serves the
 * second and Paystack the first, and the choice between them is made from the
 * currency — never from which one is cheaper for us, and never from anything
 * about the customer beyond where they say they are billed.
 *
 * Both webhook routes and the checkout action build providers through this file
 * so there is one place where a key is read from the environment and one place
 * that decides what happens when it is missing.
 */
export const PLAN_IDS: readonly PlanId[] = ['one_off', 'certified', 'agency', 'organisation'];

const ZAR_PRICES = Object.fromEntries(
  PLAN_IDS.map((plan) => {
    try {
      return [plan, priceForPlan(plan, 'ZAR')];
    } catch {
      // A plan with no rand price is simply not offered in rands. Refusing here
      // is the point: the alternative is charging an exchange rate nobody chose.
      return [plan, undefined];
    }
  }).filter((entry): entry is [PlanId, number] => entry[1] !== undefined),
);

export class PaymentsNotConfiguredError extends Error {}

export function paymentProvider(currency: Currency): PaymentProvider {
  return providerForCurrency(currency) === 'paystack' ? paystack() : stripe();
}

/** The provider a webhook arrived from, by name rather than by currency. */
export function providerNamed(name: ProviderName): PaymentProvider {
  return name === 'paystack' ? paystack() : stripe();
}

function stripe(): PaymentProvider {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secretKey || !webhookSecret) {
    // Local development without keys. The fake verifies signatures with a real
    // HMAC, so the path being exercised is the same one, not a bypass.
    if (process.env.NODE_ENV === 'production') {
      throw new PaymentsNotConfiguredError(
        'STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be set in production.',
      );
    }
    return new FakePaymentProvider();
  }

  return new StripeProvider({
    secretKey,
    webhookSecret,
    priceIds: {
      one_off: process.env.STRIPE_PRICE_ONE_OFF ?? '',
      certified: process.env.STRIPE_PRICE_CERTIFIED ?? '',
      agency: process.env.STRIPE_PRICE_AGENCY ?? '',
      organisation: process.env.STRIPE_PRICE_ORGANISATION ?? '',
    },
  });
}

function paystack(): PaymentProvider {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    // No fake fallback here. Paystack signs webhooks with the secret key
    // itself, so there is no key-less shape of this provider that verifies
    // anything — and a rand checkout that silently became a dollar one would be
    // worse than a refusal.
    throw new PaymentsNotConfiguredError(
      'PAYSTACK_SECRET_KEY is not set, so payments in rands cannot be taken on this deployment.',
    );
  }

  return new PaystackProvider({
    secretKey,
    prices: ZAR_PRICES,
    planCodes: {
      certified: process.env.PAYSTACK_PLAN_CERTIFIED ?? '',
      agency: process.env.PAYSTACK_PLAN_AGENCY ?? '',
    },
  });
}
