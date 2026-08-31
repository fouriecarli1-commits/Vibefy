/**
 * Paystack.
 *
 * Added because VibefyCode sells into South Africa as well as the United
 * States, and those are not one market with two addresses. A customer in
 * Johannesburg pays in rands, from a South African card or an instant EFT their
 * bank actually supports, and a checkout that quotes dollars and declines half
 * the country's cards is not a checkout.
 *
 * Two things about this file are worth knowing before changing it.
 *
 * **Amounts are integers in the currency's smallest unit.** Paystack takes
 * `amount` in cents for ZAR, exactly as Stripe does, and there is no floating
 * point anywhere on the path: a price is read from `config/pricing.json` as
 * whole rands and multiplied by 100 once, here.
 *
 * **The reference is the idempotency key.** Paystack has no separate
 * idempotency header — it rejects a second transaction that reuses a reference.
 * So the caller's `idempotencyKey` becomes the reference, which makes a retried
 * checkout return the same transaction instead of opening a second one, and
 * makes our own records the thing that has to be unique rather than a promise
 * from a header.
 *
 * There is no equivalent of Stripe Tax here. Paystack does not work out what
 * VAT is owed where, so tax is recorded as zero and is not silently invented;
 * see docs/OPEN_ITEMS.md.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  WebhookVerificationError,
  type BillingChange,
  type BillingEvent,
  type CheckoutRequest,
  type CheckoutSession,
  type Currency,
  type PaymentProvider,
  type RefundRequest,
  type RefundResult,
  type SettledPayment,
  type SubscriptionState,
} from './provider.ts';

export const PAYSTACK_API = 'https://api.paystack.co';

/** How long a Paystack checkout link is good for. Their default is one hour. */
const CHECKOUT_TTL_MS = 3_600_000;

export interface PaystackProviderOptions {
  readonly secretKey: string;
  /** Whole units — rands, not cents. Multiplied once, in `amountFor`. */
  readonly prices: Readonly<Record<string, number>>;
  /** Paystack plan codes for the recurring tiers, created in their dashboard. */
  readonly planCodes: Readonly<Record<string, string>>;
  readonly currency?: Currency;
  /** Injectable so tests exercise this file rather than the network. */
  readonly fetchImpl?: typeof fetch;
}

interface PaystackEnvelope<T> {
  readonly status: boolean;
  readonly message: string;
  readonly data: T;
}

export class PaystackProvider implements PaymentProvider {
  readonly name = 'paystack' as const;
  readonly currency: Currency;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: PaystackProviderOptions) {
    this.currency = options.currency ?? 'ZAR';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async call<T>(
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown },
  ): Promise<T> {
    const response = await this.fetchImpl(`${PAYSTACK_API}${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${this.options.secretKey}`,
        'content-type': 'application/json',
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });

    const text = await response.text();
    let envelope: PaystackEnvelope<T>;
    try {
      envelope = JSON.parse(text) as PaystackEnvelope<T>;
    } catch {
      // Loudly, with the status: a payment call that fails silently is money
      // that either moved or did not, and nobody knows which.
      throw new Error(`Paystack ${path} returned ${response.status} that was not JSON: ${text}`);
    }
    if (!response.ok || !envelope.status) {
      throw new Error(`Paystack ${path} failed (${response.status}): ${envelope.message}`);
    }
    return envelope.data;
  }

  /** Whole units to the smallest unit, once, with no floating point left over. */
  private amountFor(plan: string): number {
    const price = this.options.prices[plan];
    if (price === undefined) {
      throw new Error(
        `No ${this.currency} price configured for plan "${plan}". Set one in config/pricing.json before offering that plan here — a price in another currency is a decision, not a conversion.`,
      );
    }
    return Math.round(price * 100);
  }

  async createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession> {
    if (request.currency !== this.currency) {
      throw new Error(
        `Paystack is configured for ${this.currency} and was asked for ${request.currency}.`,
      );
    }

    const planCode = this.options.planCodes[request.plan];
    const data = await this.call<{ authorization_url: string; reference: string }>(
      '/transaction/initialize',
      {
        method: 'POST',
        body: {
          email: request.customerEmail,
          amount: this.amountFor(request.plan),
          currency: this.currency,
          // Paystack rejects a reused reference, which is exactly the behaviour
          // an idempotency key is for.
          reference: request.idempotencyKey,
          callback_url: request.successUrl,
          ...(planCode ? { plan: planCode } : {}),
          metadata: {
            organisationId: request.organisationId,
            plan: request.plan,
            ...(request.appId ? { appId: request.appId } : {}),
            cancel_action: request.cancelUrl,
          },
        },
      },
    );

    return {
      id: data.reference,
      url: data.authorization_url,
      expiresAt: new Date(Date.now() + CHECKOUT_TTL_MS),
    };
  }

  async retrieveSession(reference: string): Promise<SettledPayment> {
    const data = await this.call<PaystackTransaction>(
      `/transaction/verify/${encodeURIComponent(reference)}`,
      { method: 'GET' },
    );
    return settledFromTransaction(data);
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    const data = await this.call<{ id: number; amount: number; status: string }>('/refund', {
      method: 'POST',
      body: {
        transaction: request.paymentReference,
        ...(request.amountCents === undefined ? {} : { amount: request.amountCents }),
        merchant_note: request.reason,
      },
    });
    return {
      id: String(data.id),
      amountCents: Number(data.amount ?? 0),
      // Paystack settles a refund asynchronously; 'processed' is the terminal
      // success and everything short of it is still in flight.
      status:
        data.status === 'processed' ? 'succeeded' : data.status === 'failed' ? 'failed' : 'pending',
    };
  }

  /**
   * Paystack signs with HMAC-SHA512 of the raw body, keyed by the *secret key*
   * itself — there is no separate webhook secret, and no timestamp in the
   * header. That means this signature does not expire, so replay protection
   * cannot come from the header the way Stripe's does; it comes from
   * `billing_events`, where a repeated event id is rejected by a unique
   * constraint before anything is applied.
   */
  verifyWebhook(payload: string | Buffer, signature: string): BillingEvent {
    const body = typeof payload === 'string' ? payload : payload.toString('utf8');
    const expected = createHmac('sha512', this.options.secretKey).update(body).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature ?? '');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new WebhookVerificationError('Paystack signature did not verify.');
    }

    let parsed: { event?: string; data?: Record<string, unknown> };
    try {
      parsed = JSON.parse(body) as { event?: string; data?: Record<string, unknown> };
    } catch {
      throw new WebhookVerificationError('Paystack payload was not JSON.');
    }
    const data = parsed.data ?? {};

    // Paystack does not send an event id. The transaction reference or the
    // subscription code is the stable identifier for the thing that happened,
    // and pairing it with the event name is what makes the idempotency
    // constraint in `billing_events` do its job.
    const subject =
      stringOf(data.reference) ??
      stringOf(data.subscription_code) ??
      stringOf(data.id) ??
      'unknown';

    return {
      id: `${parsed.event ?? 'unknown'}:${subject}`,
      type: parsed.event ?? 'unknown',
      createdAt: dateOf(data.paid_at) ?? dateOf(data.createdAt) ?? new Date(),
      data,
    };
  }

  interpret(event: BillingEvent): BillingChange {
    return interpretPaystackEvent(event, this.currency);
  }
}

interface PaystackTransaction {
  readonly reference?: string;
  readonly status?: string;
  readonly amount?: number;
  readonly currency?: string;
  readonly customer?: { customer_code?: string };
  readonly plan_object?: { plan_code?: string };
  readonly authorization?: { country_code?: string };
  readonly metadata?: Record<string, unknown>;
}

export function settledFromTransaction(transaction: PaystackTransaction): SettledPayment {
  const metadata = (transaction.metadata ?? {}) as Record<string, string>;
  return {
    sessionId: transaction.reference ?? '',
    paid: transaction.status === 'success',
    customerId: transaction.customer?.customer_code ?? '',
    subscriptionId: null,
    invoiceId: null,
    amountTotalCents: Number(transaction.amount ?? 0),
    // Paystack does not compute tax. Recording a zero is honest; inventing a
    // VAT split from a total would not be.
    amountTaxCents: 0,
    currency: (transaction.currency ?? 'ZAR').toUpperCase(),
    billingCountry: transaction.authorization?.country_code ?? null,
    metadata,
  };
}

const PAYSTACK_SUBSCRIPTION_STATE: Readonly<Record<string, SubscriptionState>> = {
  active: 'active',
  complete: 'cancelled',
  cancelled: 'cancelled',
  'non-renewing': 'cancelled',
  attention: 'past_due',
};

/** Paystack's vocabulary, translated into ours. */
export function interpretPaystackEvent(event: BillingEvent, currency: Currency): BillingChange {
  const data = event.data;
  const metadata = (data.metadata ?? {}) as Record<string, string>;
  const organisationId = metadata.organisationId ?? null;

  switch (event.type) {
    case 'charge.success': {
      const reference = stringOf(data.reference);
      if (!reference) return { kind: 'ignored', why: 'Charge with no reference.' };
      return {
        kind: 'payment_settled',
        organisationId,
        plan: metadata.plan ?? 'one_off',
        appId: metadata.appId ?? null,
        // A charge against a Paystack plan opens a subscription, but the
        // subscription code arrives on a separate `subscription.create` event.
        // Saying `false` here means this charge is recorded as the invoice it
        // is, and the subscription row is written when its own event lands —
        // rather than inventing a subscription id that would never match.
        recurring: false,
        customerId: stringOf(
          (data.customer as { customer_code?: string } | undefined)?.customer_code,
        ),
        subscriptionId: null,
        invoiceId: reference,
        paymentReference: reference,
        amountTotalCents: Number(data.amount ?? 0),
        amountTaxCents: 0,
        currency: (stringOf(data.currency) ?? currency).toUpperCase(),
        billingCountry:
          stringOf((data.authorization as { country_code?: string } | undefined)?.country_code) ??
          null,
      };
    }

    case 'subscription.create':
    case 'subscription.enable':
    case 'subscription.disable':
    case 'subscription.not_renewing': {
      const subscriptionId = stringOf(data.subscription_code);
      if (!subscriptionId) return { kind: 'ignored', why: 'Subscription event with no code.' };
      const declaredStatus = stringOf(data.status);
      return {
        kind: 'subscription_changed',
        organisationId,
        subscriptionId,
        customerId: stringOf(
          (data.customer as { customer_code?: string } | undefined)?.customer_code,
        ),
        plan: metadata.plan ?? null,
        status:
          event.type === 'subscription.disable' || event.type === 'subscription.not_renewing'
            ? 'cancelled'
            : (PAYSTACK_SUBSCRIPTION_STATE[declaredStatus ?? ''] ?? 'active'),
        periodStart: dateOf(data.createdAt)?.toISOString() ?? null,
        periodEnd: dateOf(data.next_payment_date)?.toISOString() ?? null,
      };
    }

    case 'invoice.payment_failed': {
      const invoiceId = stringOf(
        (data.transaction as { reference?: string } | undefined)?.reference ?? data.invoice_code,
      );
      if (!invoiceId) return { kind: 'ignored', why: 'Invoice event with no reference.' };
      return {
        kind: 'invoice_settled',
        organisationId,
        invoiceId,
        paid: false,
        amountDueCents: Number(data.amount ?? 0),
        amountPaidCents: 0,
        amountTaxCents: 0,
        currency: currency,
        hostedInvoiceUrl: null,
      };
    }

    case 'refund.processed': {
      const reference = stringOf(
        (data.transaction as { reference?: string } | undefined)?.reference ??
          data.transaction_reference,
      );
      if (!reference) return { kind: 'ignored', why: 'Refund with no transaction reference.' };
      return {
        kind: 'refund_settled',
        paymentReference: reference,
        amountRefundedCents: Number(data.amount ?? 0),
      };
    }

    default:
      return { kind: 'ignored', why: `No handler for ${event.type}.` };
  }
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function dateOf(value: unknown): Date | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
