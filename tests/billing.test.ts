/**
 * Money — one of the four mandatory test areas.
 *
 * Three things are being checked: that entitlements decide coverage and never
 * score, that a webhook cannot be forged or replayed, and that processing the
 * same event twice does not charge, refund or reinstate anything twice.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import {
  ENTITLEMENTS,
  FakePaymentProvider,
  WebhookVerificationError,
  applyBillingEvent,
  decideAssessmentRequest,
  entitlementFor,
  type AssessmentRequestContext,
} from '../packages/billing/src/index.ts';
import { connect } from './setup/client.ts';
import { seedAccount, type SeededAccount } from './setup/seed.ts';

const NOW = new Date('2026-08-22T12:00:00.000Z');

const request = (over: Partial<AssessmentRequestContext> = {}): AssessmentRequestContext => ({
  plan: 'free',
  subscriptionStatus: 'active',
  appsInWorkspace: 1,
  previousAssessments: [],
  appIsAuthorised: true,
  now: NOW,
  ...over,
});

describe('what a plan decides, and what it must not', () => {
  it('decides depth, report tier, PDF and badge eligibility', () => {
    expect(entitlementFor('free')).toMatchObject({
      depth: 'limited',
      reportTier: 'free',
      pdfExport: false,
      evidenceArtefacts: false,
      badgeEligible: false,
    });
    expect(entitlementFor('one_off')).toMatchObject({
      depth: 'full',
      reportTier: 'paid',
      pdfExport: true,
      evidenceArtefacts: true,
      badgeEligible: true,
    });
  });

  it('has no field that could carry a score, a band or a finding', () => {
    for (const entitlement of Object.values(ENTITLEMENTS)) {
      const keys = Object.keys(entitlement).join(' ').toLowerCase();
      for (const forbidden of ['score', 'band', 'finding', 'severity', 'rubric', 'certified']) {
        expect(keys, `an entitlement must not carry "${forbidden}"`).not.toContain(forbidden);
      }
    }
  });

  it('refuses an unauthorised target on every plan, however much was paid', () => {
    for (const plan of ['free', 'one_off', 'certified', 'agency', 'organisation'] as const) {
      const decision = decideAssessmentRequest(request({ plan, appIsAuthorised: false }));
      expect(decision.allowed, plan).toBe(false);
      expect(decision.refusal?.code).toBe('not_authorised');
      expect(decision.refusal?.message).toMatch(/No plan changes that/);
    }
  });
});

describe('the free tier', () => {
  it('allows a first assessment', () => {
    expect(decideAssessmentRequest(request()).allowed).toBe(true);
  });

  it('holds a second one for ninety days, and says when', () => {
    const decision = decideAssessmentRequest(
      request({
        previousAssessments: [{ completedAt: new Date('2026-08-01T00:00:00Z'), paid: false }],
      }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.refusal?.code).toBe('cooldown_active');
    expect(decision.refusal?.message).toContain('2026-10-30');
    expect(decision.refusal?.message).toMatch(/a paid report has no waiting period/);
  });

  it('allows it again once the ninety days have passed', () => {
    expect(
      decideAssessmentRequest(
        request({
          previousAssessments: [{ completedAt: new Date('2026-04-01T00:00:00Z'), paid: false }],
        }),
      ).allowed,
    ).toBe(true);
  });

  it('caps how many applications a free workspace holds', () => {
    const decision = decideAssessmentRequest(request({ appsInWorkspace: 9 }));
    expect(decision.refusal?.code).toBe('app_limit_reached');
  });

  it('runs at the cheapest cost ceiling, because a free run costs us real money', () => {
    expect(decideAssessmentRequest(request()).maxRunCostUsd).toBeLessThan(
      decideAssessmentRequest(request({ plan: 'one_off' })).maxRunCostUsd,
    );
  });
});

describe('paid plans', () => {
  it('has no cooling-off period', () => {
    expect(
      decideAssessmentRequest(
        request({
          plan: 'one_off',
          previousAssessments: [{ completedAt: new Date('2026-08-21T00:00:00Z'), paid: true }],
        }),
      ).allowed,
    ).toBe(true);
  });

  it('spends a re-test credit inside the thirty-day window, and says so', () => {
    const decision = decideAssessmentRequest(
      request({
        plan: 'one_off',
        previousAssessments: [{ completedAt: new Date('2026-08-10T00:00:00Z'), paid: true }],
      }),
    );
    expect(decision.allowed).toBe(true);
    expect(decision.usesReTestCredit).toBe(true);
  });

  it('stops spending credits once they are used up', () => {
    const decision = decideAssessmentRequest(
      request({
        plan: 'one_off',
        previousAssessments: [
          { completedAt: new Date('2026-08-15T00:00:00Z'), paid: false },
          { completedAt: new Date('2026-08-10T00:00:00Z'), paid: true },
        ],
      }),
    );
    expect(decision.usesReTestCredit).toBe(false);
  });

  it('refuses a lapsed subscription', () => {
    const decision = decideAssessmentRequest(
      request({ plan: 'certified', subscriptionStatus: 'past_due' }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.refusal?.code).toBe('subscription_inactive');
  });
});

describe('webhook verification', () => {
  const provider = new FakePaymentProvider();
  const body = JSON.stringify({
    id: 'evt_1',
    type: 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: 'cs_1', metadata: {} } },
  });

  it('accepts a correctly signed payload', () => {
    expect(provider.verifyWebhook(body, provider.sign(body)).id).toBe('evt_1');
  });

  it('refuses an unsigned payload — anyone can POST JSON at a public URL', () => {
    expect(() => provider.verifyWebhook(body, '')).toThrow(WebhookVerificationError);
  });

  it('refuses a tampered payload', () => {
    const signature = provider.sign(body);
    const tampered = body.replace('cs_1', 'cs_attacker');
    expect(() => provider.verifyWebhook(tampered, signature)).toThrow(WebhookVerificationError);
  });

  it('refuses a replayed payload from outside the tolerance window', () => {
    const old = Math.floor(Date.now() / 1000) - 3600;
    expect(() => provider.verifyWebhook(body, provider.sign(body, old))).toThrow(
      /tolerance window/,
    );
  });

  it('is idempotent on checkout, so a retried session does not charge twice', async () => {
    const first = await provider.createCheckoutSession({
      organisationId: 'org',
      plan: 'one_off',
      customerEmail: 'a@example.test',
      successUrl: 'https://vibefy.example/ok',
      cancelUrl: 'https://vibefy.example/no',
      idempotencyKey: 'key-1',
    });
    const second = await provider.createCheckoutSession({
      organisationId: 'org',
      plan: 'one_off',
      customerEmail: 'a@example.test',
      successUrl: 'https://vibefy.example/ok',
      cancelUrl: 'https://vibefy.example/no',
      idempotencyKey: 'key-1',
    });
    expect(second.id).toBe(first.id);
  });
});

describe('applying events to our records', () => {
  let db: Client;
  let pool: Pool;
  let account: SeededAccount;

  beforeAll(async () => {
    db = await connect();
    const dsn = new URL(process.env.VIBEFY_TEST_DSN!);
    pool = new Pool({
      host: dsn.searchParams.get('host')!,
      database: dsn.pathname.slice(1),
      user: 'postgres',
    });
    account = await seedAccount(db, 'billing');
  });

  afterAll(async () => {
    await pool?.end();
    await db?.end();
  });

  const event = (
    type: string,
    object: Record<string, unknown>,
    id = `evt_${Math.random().toString(36).slice(2)}`,
  ) => ({
    id,
    type,
    createdAt: new Date(),
    data: object,
  });

  it('records a one-off payment as a paid invoice, with its tax', async () => {
    const client = await pool.connect();
    try {
      await applyBillingEvent(
        client,
        event('checkout.session.completed', {
          id: 'cs_one_off',
          mode: 'payment',
          invoice: 'in_one_off',
          payment_intent: 'pi_one_off',
          amount_total: 7900,
          currency: 'usd',
          total_details: { amount_tax: 1316 },
          customer_details: { address: { country: 'GB' } },
          metadata: { organisationId: account.organisationId, plan: 'one_off' },
        }),
      );
    } finally {
      client.release();
    }

    const { rows } = await db.query(
      `select amount_paid_cents, amount_tax_cents, currency, status, tax_country, plan
         from public.invoices where stripe_invoice_id = 'in_one_off'`,
    );
    expect(rows[0]).toMatchObject({
      amount_paid_cents: 7900,
      amount_tax_cents: 1316,
      currency: 'USD',
      status: 'paid',
      tax_country: 'GB',
      plan: 'one_off',
    });
  });

  it('processes the same event twice without doubling anything', async () => {
    const duplicate = event(
      'checkout.session.completed',
      {
        id: 'cs_dupe',
        mode: 'payment',
        invoice: 'in_dupe',
        amount_total: 7900,
        currency: 'usd',
        metadata: { organisationId: account.organisationId, plan: 'one_off' },
      },
      'evt_dupe',
    );

    const client = await pool.connect();
    try {
      const first = await applyBillingEvent(client, duplicate);
      const second = await applyBillingEvent(client, duplicate);
      expect(first.duplicate).toBe(false);
      expect(second.duplicate).toBe(true);
    } finally {
      client.release();
    }

    const { rows } = await db.query(
      `select count(*)::int as n from public.invoices where stripe_invoice_id = 'in_dupe'`,
    );
    expect(rows[0].n).toBe(1);
  });

  it('activates and then cancels a subscription', async () => {
    const client = await pool.connect();
    try {
      await applyBillingEvent(
        client,
        event('checkout.session.completed', {
          id: 'cs_sub',
          mode: 'subscription',
          subscription: 'sub_1',
          customer: 'cus_1',
          metadata: { organisationId: account.organisationId, plan: 'certified' },
        }),
      );
      await applyBillingEvent(
        client,
        event('customer.subscription.deleted', { id: 'sub_1', status: 'canceled', metadata: {} }),
      );
    } finally {
      client.release();
    }

    const { rows } = await db.query(
      `select status, plan, cancelled_at from public.subscriptions where stripe_subscription_id = 'sub_1'`,
    );
    expect(rows[0].status).toBe('cancelled');
    expect(rows[0].plan).toBe('certified');
    expect(rows[0].cancelled_at).not.toBeNull();
  });

  it('never records a refund larger than the payment', async () => {
    const client = await pool.connect();
    try {
      await applyBillingEvent(
        client,
        event('checkout.session.completed', {
          id: 'cs_refund',
          mode: 'payment',
          invoice: 'in_refund',
          payment_intent: 'pi_refund',
          amount_total: 7900,
          currency: 'usd',
          metadata: { organisationId: account.organisationId, plan: 'one_off' },
        }),
      );
      await applyBillingEvent(
        client,
        event('charge.refunded', {
          id: 'ch_1',
          payment_intent: 'pi_refund',
          amount_refunded: 99_999,
        }),
      );
    } finally {
      client.release();
    }

    const { rows } = await db.query(
      `select amount_paid_cents, amount_refunded_cents, status from public.invoices where stripe_invoice_id = 'in_refund'`,
    );
    expect(rows[0].amount_refunded_cents).toBe(7900);
    expect(rows[0].status).toBe('refunded');
  });

  it('keeps what the provider told us, unedited', async () => {
    await db.query('begin');
    const message = await db
      .query(
        `update public.billing_events set payload = '{}'::jsonb where provider_event_id = 'evt_dupe'`,
      )
      .then(() => '')
      .catch((error) => String(error));
    await db.query('rollback');
    expect(message).toMatch(/only the handled flag may change/);
  });

  it('never stores anything resembling a card number', async () => {
    const { rows } = await db.query(`
      select column_name from information_schema.columns
       where table_schema = 'public'
         and (column_name ilike '%card%' or column_name ilike '%pan%' or column_name ilike '%cvv%'
              or column_name ilike '%cvc%' or column_name ilike '%expiry%')`);
    expect(rows).toHaveLength(0);
  });
});
