/**
 * Stripe.
 *
 * Checkout, Billing and Tax, used as hosted surfaces so that no card detail ever
 * reaches us. Prices are resolved from configuration at call time rather than
 * hardcoded, so changing what we charge does not require a deploy.
 */
import Stripe from 'stripe';
import pricing from '../../../config/pricing.json' with { type: 'json' };
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

export interface StripeProviderOptions {
  readonly secretKey: string;
  readonly webhookSecret: string;
  /** Maps our plan ids to Stripe price ids. */
  readonly priceIds: Readonly<Record<string, string>>;
  readonly client?: Stripe;
}

export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe' as const;
  /**
   * Stripe takes the rest of the world, in dollars. South African customers go
   * to Paystack — see `packages/billing/src/routing.ts` for who is sent where
   * and why.
   */
  readonly currency: Currency = 'USD';
  private readonly stripe: Stripe;

  constructor(private readonly options: StripeProviderOptions) {
    this.stripe = options.client ?? new Stripe(options.secretKey);
  }

  private priceFor(plan: string): string {
    const priceId = this.options.priceIds[plan];
    if (!priceId) {
      throw new Error(
        `No Stripe price configured for plan "${plan}". Set it before offering that plan.`,
      );
    }
    return priceId;
  }

  private modeFor(plan: string): 'payment' | 'subscription' {
    const tier = pricing.tiers.find((entry) => entry.id === plan);
    return tier?.billing === 'monthly' ? 'subscription' : 'payment';
  }

  async createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession> {
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: this.modeFor(request.plan),
        line_items: [{ price: this.priceFor(request.plan), quantity: 1 }],
        customer_email: request.customerEmail,
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
        // Stripe Tax works out what is owed where. Getting VAT wrong is a
        // liability we have no reason to take on ourselves.
        automatic_tax: { enabled: true },
        billing_address_collection: 'required',
        metadata: {
          organisationId: request.organisationId,
          plan: request.plan,
          ...(request.appId ? { appId: request.appId } : {}),
        },
      },
      { idempotencyKey: request.idempotencyKey },
    );

    if (!session.url) throw new Error('Stripe returned a checkout session with no URL.');

    return {
      id: session.id,
      url: session.url,
      expiresAt: new Date((session.expires_at ?? Math.floor(Date.now() / 1000) + 3600) * 1000),
    };
  }

  async retrieveSession(sessionId: string): Promise<SettledPayment> {
    const session = await this.stripe.checkout.sessions.retrieve(sessionId);
    return settledFromSession(session);
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    const refund = await this.stripe.refunds.create(
      {
        payment_intent: request.paymentReference,
        ...(request.amountCents !== undefined ? { amount: request.amountCents } : {}),
        metadata: { reason: request.reason },
      },
      { idempotencyKey: request.idempotencyKey },
    );
    return {
      id: refund.id,
      amountCents: refund.amount,
      status:
        refund.status === 'succeeded'
          ? 'succeeded'
          : refund.status === 'pending'
            ? 'pending'
            : 'failed',
    };
  }

  verifyWebhook(payload: string | Buffer, signature: string): BillingEvent {
    try {
      const event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        this.options.webhookSecret,
      );
      return {
        id: event.id,
        type: event.type,
        createdAt: new Date(event.created * 1000),
        data: event.data.object as unknown as Record<string, unknown>,
      };
    } catch (error) {
      throw new WebhookVerificationError(
        `Webhook signature did not verify: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  interpret(event: BillingEvent): BillingChange {
    return interpretStripeEvent(event);
  }
}

/**
 * Stripe's vocabulary, translated into ours.
 *
 * Everything below used to live inside the shared event handler, reading
 * Stripe's field names directly. That was fine while Stripe was the only
 * provider and became a problem the moment it was not: the alternative to this
 * function is a second handler that drifts from the first.
 */
const STRIPE_SUBSCRIPTION_STATE: Readonly<Record<string, SubscriptionState>> = {
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  paused: 'paused',
  canceled: 'cancelled',
  incomplete: 'incomplete',
  incomplete_expired: 'incomplete',
  unpaid: 'past_due',
};

export function interpretStripeEvent(event: BillingEvent): BillingChange {
  const data = event.data;
  const metadata = (data.metadata ?? {}) as Record<string, string>;
  const organisationId = metadata.organisationId ?? null;

  switch (event.type) {
    case 'checkout.session.completed': {
      const subscriptionId = stringOrNull(data.subscription);
      return {
        kind: 'payment_settled',
        organisationId,
        plan: metadata.plan ?? 'one_off',
        appId: metadata.appId ?? null,
        recurring: String(data.mode ?? 'payment') === 'subscription' && subscriptionId !== null,
        customerId: stringOrNull(data.customer),
        subscriptionId,
        // A session with no invoice still has to be findable, or a refund has
        // nothing to attach to and a retry inserts a second row.
        invoiceId: stringOrNull(data.invoice) ?? `session_${String(data.id ?? event.id)}`,
        paymentReference: stringOrNull(data.payment_intent),
        amountTotalCents: Number(data.amount_total ?? 0),
        amountTaxCents: Number(
          (data as { total_details?: { amount_tax?: number } }).total_details?.amount_tax ?? 0,
        ),
        currency: String(data.currency ?? 'usd').toUpperCase(),
        billingCountry:
          (data as { customer_details?: { address?: { country?: string } } }).customer_details
            ?.address?.country ?? null,
      };
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscriptionId = String(data.id ?? '');
      if (!subscriptionId) return { kind: 'ignored', why: 'Subscription event with no id.' };
      return {
        kind: 'subscription_changed',
        organisationId,
        subscriptionId,
        customerId: stringOrNull(data.customer),
        plan: metadata.plan ?? null,
        status:
          event.type === 'customer.subscription.deleted'
            ? 'cancelled'
            : (STRIPE_SUBSCRIPTION_STATE[String(data.status ?? '')] ?? 'incomplete'),
        periodStart: unixOrNull(data.current_period_start),
        periodEnd: unixOrNull(data.current_period_end),
      };
    }

    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const invoiceId = String(data.id ?? '');
      if (!invoiceId) return { kind: 'ignored', why: 'Invoice event with no id.' };
      return {
        kind: 'invoice_settled',
        organisationId,
        invoiceId,
        paid: event.type === 'invoice.paid',
        amountDueCents: Number(data.amount_due ?? 0),
        amountPaidCents: Number(data.amount_paid ?? 0),
        amountTaxCents: Number(data.tax ?? 0),
        currency: String(data.currency ?? 'usd').toUpperCase(),
        hostedInvoiceUrl: stringOrNull(data.hosted_invoice_url),
      };
    }

    case 'charge.refunded': {
      const reference = stringOrNull(data.payment_intent);
      if (!reference) return { kind: 'ignored', why: 'Refund with no payment reference.' };
      return {
        kind: 'refund_settled',
        paymentReference: reference,
        amountRefundedCents: Number(data.amount_refunded ?? 0),
      };
    }

    default:
      return { kind: 'ignored', why: `No handler for ${event.type}.` };
  }
}

function stringOrNull(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
}

function unixOrNull(value: unknown): string | null {
  return typeof value === 'number' ? new Date(value * 1000).toISOString() : null;
}

export function settledFromSession(session: Stripe.Checkout.Session): SettledPayment {
  const customer =
    typeof session.customer === 'string' ? session.customer : (session.customer?.id ?? '');
  const subscription =
    typeof session.subscription === 'string'
      ? session.subscription
      : (session.subscription?.id ?? null);
  const invoice =
    typeof session.invoice === 'string' ? session.invoice : (session.invoice?.id ?? null);

  return {
    sessionId: session.id,
    paid: session.payment_status === 'paid' || session.payment_status === 'no_payment_required',
    customerId: customer,
    subscriptionId: subscription,
    invoiceId: invoice,
    amountTotalCents: session.amount_total ?? 0,
    amountTaxCents: session.total_details?.amount_tax ?? 0,
    currency: (session.currency ?? 'usd').toUpperCase(),
    billingCountry: session.customer_details?.address?.country ?? null,
    metadata: (session.metadata ?? {}) as Record<string, string>,
  };
}
