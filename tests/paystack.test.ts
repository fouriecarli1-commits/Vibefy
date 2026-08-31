/**
 * Taking money in two countries.
 *
 * VibefyCode sells into South Africa and the United States, which is not one
 * market with two addresses: a customer in Johannesburg pays in rands from a
 * card their bank issued locally, and a checkout that quotes dollars and
 * declines half of them is not a checkout.
 *
 * The billing code was built behind an interface for exactly this from the
 * start. What these tests hold is the two things a second provider makes easy
 * to get wrong — that the choice of provider is made from the customer's
 * country and nothing else, and that a rand price is a decision somebody took
 * rather than a dollar price times a rate nobody chose.
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { beforeAll, afterAll } from 'vitest';
import {
  PaystackProvider,
  PriceNotSetError,
  WebhookVerificationError,
  applyBillingEvent,
  currencyForCountry,
  interpretPaystackEvent,
  priceForPlan,
  providerForCountry,
} from '../packages/billing/src/index.ts';
import { connect } from './setup/client.ts';
import { seedAccount, type SeededAccount } from './setup/seed.ts';

const SECRET = 'sk_test_paystack_secret';

/**
 * A file's code with its prose removed.
 *
 * The two tests below assert that the routing decision contains no conversion
 * and looks at nothing but the country. Both are claims about code, and the
 * comments in that file necessarily discuss the very words being forbidden —
 * a test that reads them is a test about prose wearing the clothes of one
 * about behaviour.
 */
const codeOf = (path: string) =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const provider = (fetchImpl?: typeof fetch) =>
  new PaystackProvider({
    secretKey: SECRET,
    prices: { one_off: 1499, certified: 899 },
    planCodes: { certified: 'PLN_certified' },
    ...(fetchImpl ? { fetchImpl } : {}),
  });

/** A Paystack webhook, signed the way Paystack signs one. */
function signed(body: unknown): { raw: string; signature: string } {
  const raw = JSON.stringify(body);
  return { raw, signature: createHmac('sha512', SECRET).update(raw).digest('hex') };
}

describe('who takes the money', () => {
  it('sends a South African customer to Paystack, in rands', () => {
    expect(currencyForCountry('ZA')).toBe('ZAR');
    expect(providerForCountry('ZA')).toBe('paystack');
  });

  it('sends everybody else to Stripe, in dollars', () => {
    for (const country of ['US', 'GB', 'DE', 'NG', null]) {
      expect(currencyForCountry(country)).toBe('USD');
      expect(providerForCountry(country)).toBe('stripe');
    }
  });

  it('decides from the country and from nothing else', async () => {
    // Not from what somebody has spent, not from which provider costs us less.
    // A customer quoted one price and charged another has been lied to, however
    // small the difference.
    expect(codeOf('packages/billing/src/routing.ts')).not.toMatch(
      /subscription|invoice|spend|discount|fee/i,
    );
  });
});

describe('what a plan costs where', () => {
  it('reads a rand price that was set, not converted', () => {
    // Nothing in the codebase applies an exchange rate. If this ever equals the
    // dollar price times some rate, somebody has started converting.
    expect(priceForPlan('one_off', 'ZAR')).toBe(1499);
    expect(priceForPlan('one_off', 'USD')).toBe(79);
  });

  it('refuses a plan that has no price in the currency being bought in', () => {
    // Loudly. The alternative is charging a rate nobody chose.
    expect(() => priceForPlan('organisation', 'ZAR')).toThrow(PriceNotSetError);
    expect(() => priceForPlan('organisation', 'USD')).toThrow(PriceNotSetError);
  });

  it('never converts one currency into another', () => {
    for (const file of ['routing.ts', 'paystack.ts', 'stripe.ts']) {
      expect(codeOf(`packages/billing/src/${file}`), file).not.toMatch(
        /exchange|fxRate|convert\(|\* *rate\b/i,
      );
    }
  });
});

describe('opening a checkout', () => {
  it('sends whole rands as an integer number of cents', async () => {
    let sent: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          status: true,
          message: 'ok',
          data: { authorization_url: 'https://checkout.paystack.com/abc', reference: 'ref_1' },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const session = await provider(fetchImpl).createCheckoutSession({
      organisationId: 'org-1',
      plan: 'one_off',
      currency: 'ZAR',
      customerEmail: 'buyer@example.test',
      successUrl: 'https://app.example/done',
      cancelUrl: 'https://app.example/cancelled',
      idempotencyKey: 'ref_1',
    });

    expect(sent.amount).toBe(149_900);
    expect(Number.isInteger(sent.amount)).toBe(true);
    expect(sent.currency).toBe('ZAR');
    // Paystack rejects a reused reference, which is what makes it the
    // idempotency key rather than a header we hope is honoured.
    expect(sent.reference).toBe('ref_1');
    expect(session.url).toBe('https://checkout.paystack.com/abc');
  });

  it('carries the organisation, or the payment can never be attributed', async () => {
    let sent: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          status: true,
          message: 'ok',
          data: { authorization_url: 'https://checkout.paystack.com/x', reference: 'r' },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await provider(fetchImpl).createCheckoutSession({
      organisationId: 'org-7',
      plan: 'certified',
      currency: 'ZAR',
      customerEmail: 'a@example.test',
      successUrl: 'https://app.example/done',
      cancelUrl: 'https://app.example/cancelled',
      idempotencyKey: 'r',
    });

    expect((sent.metadata as Record<string, string>).organisationId).toBe('org-7');
    // A recurring tier needs the plan code, or Paystack takes one payment and
    // never asks again.
    expect(sent.plan).toBe('PLN_certified');
  });

  it('refuses to open a dollar checkout on the rand provider', async () => {
    await expect(
      provider().createCheckoutSession({
        organisationId: 'org-1',
        plan: 'one_off',
        currency: 'USD',
        customerEmail: 'a@example.test',
        successUrl: 'https://app.example/done',
        cancelUrl: 'https://app.example/cancelled',
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/configured for ZAR/);
  });

  it('fails loudly when Paystack says no, rather than returning a broken link', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ status: false, message: 'Invalid key' }), {
        status: 401,
      })) as unknown as typeof fetch;

    await expect(
      provider(fetchImpl).createCheckoutSession({
        organisationId: 'org-1',
        plan: 'one_off',
        currency: 'ZAR',
        customerEmail: 'a@example.test',
        successUrl: 'https://app.example/done',
        cancelUrl: 'https://app.example/cancelled',
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/Invalid key/);
  });
});

describe('a webhook from Paystack', () => {
  it('accepts a correctly signed payload', () => {
    const { raw, signature } = signed({ event: 'charge.success', data: { reference: 'ref_9' } });
    const event = provider().verifyWebhook(raw, signature);
    expect(event.type).toBe('charge.success');
  });

  it('refuses an unsigned or tampered payload — anyone can POST JSON at a public URL', () => {
    const { raw, signature } = signed({ event: 'charge.success', data: { reference: 'ref_9' } });
    expect(() => provider().verifyWebhook(raw, '')).toThrow(WebhookVerificationError);
    expect(() => provider().verifyWebhook(`${raw} `, signature)).toThrow(WebhookVerificationError);
  });

  it('gives the same event the same id every time it is delivered', () => {
    // Paystack sends no event id and its signature carries no timestamp, so a
    // captured payload verifies forever. Replay protection is therefore the
    // unique constraint in `billing_events`, and that only works if the id we
    // synthesise is stable for the same underlying event.
    const body = { event: 'charge.success', data: { reference: 'ref_stable' } };
    const a = signed(body);
    const b = signed(body);
    const first = provider().verifyWebhook(a.raw, a.signature);
    const second = provider().verifyWebhook(b.raw, b.signature);
    expect(first.id).toBe(second.id);
    expect(first.id).toContain('ref_stable');
  });
});

describe('what a Paystack event means', () => {
  const interpret = (event: string, data: Record<string, unknown>) =>
    interpretPaystackEvent({ id: 'x', type: event, createdAt: new Date(), data }, 'ZAR');

  it('reads a successful charge as a settled payment in rands', () => {
    const change = interpret('charge.success', {
      reference: 'ref_a',
      amount: 149_900,
      currency: 'ZAR',
      customer: { customer_code: 'CUS_1' },
      metadata: { organisationId: 'org-1', plan: 'one_off' },
    });
    expect(change).toMatchObject({
      kind: 'payment_settled',
      organisationId: 'org-1',
      plan: 'one_off',
      amountTotalCents: 149_900,
      currency: 'ZAR',
      paymentReference: 'ref_a',
    });
  });

  it('records no tax rather than inventing a split', () => {
    // Paystack does not work out what VAT is owed where. A zero is honest; a
    // number derived from the total would be a figure we made up about a tax
    // liability.
    const change = interpret('charge.success', {
      reference: 'ref_b',
      amount: 149_900,
      metadata: { organisationId: 'org-1' },
    });
    expect(change).toMatchObject({ kind: 'payment_settled', amountTaxCents: 0 });
  });

  it('does not invent a subscription id on the charge that opens one', () => {
    // The subscription code arrives on its own event. Guessing one here would
    // write a row that never matches anything Paystack sends afterwards.
    const change = interpret('charge.success', {
      reference: 'ref_c',
      amount: 89_900,
      plan: { plan_code: 'PLN_certified' },
      metadata: { organisationId: 'org-1', plan: 'certified' },
    });
    expect(change).toMatchObject({
      kind: 'payment_settled',
      recurring: false,
      subscriptionId: null,
    });
  });

  it('reads a disabled subscription as cancelled', () => {
    expect(
      interpret('subscription.disable', {
        subscription_code: 'SUB_1',
        status: 'complete',
        metadata: { organisationId: 'org-1' },
      }),
    ).toMatchObject({ kind: 'subscription_changed', subscriptionId: 'SUB_1', status: 'cancelled' });
  });

  it('reads a processed refund against the transaction it reverses', () => {
    expect(
      interpret('refund.processed', {
        amount: 149_900,
        transaction: { reference: 'ref_a' },
      }),
    ).toMatchObject({ kind: 'refund_settled', paymentReference: 'ref_a' });
  });

  it('says so, rather than silently doing nothing, for an event we do not handle', () => {
    expect(interpret('customeridentification.success', {})).toMatchObject({ kind: 'ignored' });
  });
});

describe('applying a Paystack event to our records', () => {
  let db: Client;
  let pool: Pool;
  let account: SeededAccount;

  beforeAll(async () => {
    db = await connect();
    const dsn = new URL(process.env.VIBEFYCODE_TEST_DSN!);
    pool = new Pool({
      host: dsn.searchParams.get('host')!,
      database: dsn.pathname.slice(1),
      user: 'postgres',
    });
    account = await seedAccount(db, 'paystack');
  });

  afterAll(async () => {
    await pool?.end();
    await db?.end();
  });

  it('records the payment against Paystack, in rands, with the reference a refund needs', async () => {
    const { raw, signature } = signed({
      event: 'charge.success',
      data: {
        reference: 'ref_live_1',
        amount: 149_900,
        currency: 'ZAR',
        customer: { customer_code: 'CUS_9' },
        metadata: { organisationId: account.organisationId, plan: 'one_off' },
      },
    });
    const payments = provider();
    const event = payments.verifyWebhook(raw, signature);

    const client = await pool.connect();
    try {
      await applyBillingEvent(client, payments, event);
    } finally {
      client.release();
    }

    const { rows } = await db.query(
      `select provider::text as provider, currency, amount_paid_cents, status,
              provider_payment_reference
         from public.invoices
        where provider = 'paystack' and provider_invoice_id = 'ref_live_1'`,
    );
    expect(rows[0]).toMatchObject({
      provider: 'paystack',
      currency: 'ZAR',
      amount_paid_cents: 149_900,
      status: 'paid',
      provider_payment_reference: 'ref_live_1',
    });
  });

  it('refuses the same delivery twice, which is the only replay protection it has', async () => {
    const { raw, signature } = signed({
      event: 'charge.success',
      data: {
        reference: 'ref_live_2',
        amount: 89_900,
        currency: 'ZAR',
        metadata: { organisationId: account.organisationId, plan: 'certified' },
      },
    });
    const payments = provider();

    const client = await pool.connect();
    try {
      const first = await applyBillingEvent(
        client,
        payments,
        payments.verifyWebhook(raw, signature),
      );
      const second = await applyBillingEvent(
        client,
        payments,
        payments.verifyWebhook(raw, signature),
      );
      expect(first.duplicate).toBe(false);
      expect(second.duplicate).toBe(true);
    } finally {
      client.release();
    }

    const { rows } = await db.query(
      `select count(*)::int as n from public.invoices where provider_invoice_id = 'ref_live_2'`,
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('keeps a Paystack identifier apart from a Stripe one that happens to match', async () => {
    // The old unique index was global, so two providers minting the same string
    // would have had the second rejected as a duplicate of an unrelated record.
    await db.query(
      `insert into public.invoices
         (organisation_id, provider, provider_invoice_id, amount_due_cents, amount_paid_cents,
          currency, status)
       values ($1, 'stripe', 'collision', 1000, 1000, 'USD', 'paid'),
              ($1, 'paystack', 'collision', 1000, 1000, 'ZAR', 'paid')`,
      [account.organisationId],
    );
    const { rows } = await db.query(
      `select count(*)::int as n from public.invoices where provider_invoice_id = 'collision'`,
    );
    expect(rows[0]!.n).toBe(2);
  });
});
