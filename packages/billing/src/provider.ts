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

export interface CheckoutRequest {
  readonly organisationId: string;
  readonly plan: PlanId;
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
  readonly data: Record<string, unknown>;
}

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

export interface PaymentProvider {
  readonly name: string;
  createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession>;
  retrieveSession(sessionId: string): Promise<SettledPayment>;
  refund(request: RefundRequest): Promise<RefundResult>;
  /**
   * Verifies the signature and returns the event. An unverified payload is not
   * an event — anyone can POST JSON at a public URL.
   */
  verifyWebhook(payload: string | Buffer, signature: string): BillingEvent;
}
