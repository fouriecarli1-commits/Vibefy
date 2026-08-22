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
  type BillingEvent,
  type CheckoutRequest,
  type CheckoutSession,
  type PaymentProvider,
  type RefundRequest,
  type RefundResult,
  type SettledPayment,
} from './provider.ts';

export interface StripeProviderOptions {
  readonly secretKey: string;
  readonly webhookSecret: string;
  /** Maps our plan ids to Stripe price ids. */
  readonly priceIds: Readonly<Record<string, string>>;
  readonly client?: Stripe;
}

export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe';
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
