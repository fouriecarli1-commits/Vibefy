/**
 * The payment boundary.
 *
 * Everything that touches money goes through this interface, which exists for
 * two reasons. The first is that the test suite must be able to exercise the
 * whole billing path without a network or a live key — a payments test that only
 * runs when someone remembers to export a secret is a payments test that does
 * not run. The second is that card data must never reach our systems, and an
 * interface that has no field for one cannot accidentally carry one.
 *
 * Note what is absent: there is no method that accepts a card number, and no
 * type in this file has a field for one. Customers reach Stripe's hosted
 * checkout directly; we see an identifier and an amount afterwards.
 */
export type PlanId = 'one_off' | 'certified' | 'agency' | 'organisation';

/**
 * The currencies we actually charge in.
 *
 * A closed set on purpose. A price in another currency is a business decision,
 * not arithmetic: nothing here converts one into another, and a plan with no
 * price set in the currency somebody is buying in is refused rather than
 * guessed at. See `config/pricing.json`.
 */
export type Currency = 'USD' | 'ZAR';

export type ProviderName = 'stripe' | 'paystack';

export interface CheckoutRequest {
  readonly organisationId: string;
  readonly plan: PlanId;
  readonly currency: Currency;
  readonly customerEmail: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
  /** The app a one-off report is being bought for, when there is one. */
  readonly appId?: string;
  readonly idempotencyKey: string;
}

export interface CheckoutSession {
  readonly id: string;
  readonly url: string;
  readonly expiresAt: Date;
}

export interface SettledPayment {
  readonly sessionId: string;
  readonly paid: boolean;
  readonly customerId: string;
  readonly subscriptionId: string | null;
  readonly invoiceId: string | null;
  readonly amountTotalCents: number;
  readonly amountTaxCents: number;
  readonly currency: string;
  readonly billingCountry: string | null;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface RefundRequest {
  readonly paymentReference: string;
  readonly amountCents?: number;
  readonly reason: string;
  readonly idempotencyKey: string;
}

export interface RefundResult {
  readonly id: string;
  readonly amountCents: number;
  readonly status: 'succeeded' | 'pending' | 'failed';
}

/** A provider event, already verified. Never construct one from unverified input. */
export interface BillingEvent {
  readonly id: string;
  readonly type: string;
  readonly createdAt: Date;
  /** Exactly what the provider sent. Recorded unedited; never reshaped. */
  readonly data: Record<string, unknown>;
}

/**
 * What an event means to our records, said in our own words.
 *
 * With one provider the handler could read Stripe's field names directly and
 * nobody was worse off. With two, that would have meant either a second handler
 * that drifts from the first, or teaching Paystack to impersonate Stripe —
 * which is the same lie as a column called `stripe_subscription_id` holding a
 * Paystack code, moved into TypeScript.
 *
 * So each provider translates its own vocabulary into this one. The translation
 * lives with the provider that knows its own payloads, and the code that
 * changes our records reads one shape and cannot tell which provider it came
 * from — which is the point.
 *
 * `ignored` is deliberately a value rather than a null: providers send a great
 * many events, most of which mean nothing to us, and "we saw this and decided
 * it changes nothing" is worth writing into the audit row.
 */
export type SubscriptionState =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'paused'
  | 'cancelled'
  | 'incomplete';

export interface PaymentSettled {
  readonly kind: 'payment_settled';
  readonly organisationId: string | null;
  readonly plan: string;
  readonly appId: string | null;
  /** Whether this payment opened a subscription rather than buying one report. */
  readonly recurring: boolean;
  readonly customerId: string | null;
  readonly subscriptionId: string | null;
  readonly invoiceId: string;
  readonly paymentReference: string | null;
  readonly amountTotalCents: number;
  readonly amountTaxCents: number;
  readonly currency: string;
  readonly billingCountry: string | null;
}

export interface SubscriptionChanged {
  readonly kind: 'subscription_changed';
  readonly organisationId: string | null;
  readonly subscriptionId: string;
  readonly customerId: string | null;
  readonly plan: string | null;
  readonly status: SubscriptionState;
  /** ISO timestamps, or null where the provider did not say. */
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
}

export interface InvoiceSettled {
  readonly kind: 'invoice_settled';
  readonly organisationId: string | null;
  readonly invoiceId: string;
  readonly paid: boolean;
  readonly amountDueCents: number;
  readonly amountPaidCents: number;
  readonly amountTaxCents: number;
  readonly currency: string;
  readonly hostedInvoiceUrl: string | null;
}

export interface RefundSettled {
  readonly kind: 'refund_settled';
  readonly paymentReference: string;
  readonly amountRefundedCents: number;
}

export interface IgnoredChange {
  readonly kind: 'ignored';
  readonly why: string;
}

export type BillingChange =
  | PaymentSettled
  | SubscriptionChanged
  | InvoiceSettled
  | RefundSettled
  | IgnoredChange;

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

export interface PaymentProvider {
  readonly name: ProviderName;
  /** The one currency this provider is configured to charge in. */
  readonly currency: Currency;
  createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession>;
  retrieveSession(sessionId: string): Promise<SettledPayment>;
  refund(request: RefundRequest): Promise<RefundResult>;
  /**
   * Verifies the signature and returns the event. An unverified payload is not
   * an event — anyone can POST JSON at a public URL.
   */
  verifyWebhook(payload: string | Buffer, signature: string): BillingEvent;
  /**
   * Translates one of this provider's events into what it means to our records.
   * Reads the event; never touches the database and never has an opinion about
   * what should happen next.
   */
  interpret(event: BillingEvent): BillingChange;
}
