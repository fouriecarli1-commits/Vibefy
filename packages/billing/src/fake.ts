/**
 * A payment provider for tests.
 *
 * It signs its webhooks with a real HMAC in the same format Stripe uses, so the
 * verification path is genuinely exercised rather than stubbed past — a test
 * that skips signature checking is a test that would not notice if we did too.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
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

export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake';
  readonly checkoutRequests: CheckoutRequest[] = [];
  readonly refundRequests: RefundRequest[] = [];
  private readonly settlements = new Map<string, SettledPayment>();
  private counter = 0;

  constructor(private readonly webhookSecret = 'whsec_fake_testing_secret') {}

  /** Lets a test decide what a session settled as. */
  settle(sessionId: string, settlement: Partial<SettledPayment>): void {
    this.settlements.set(sessionId, {
      sessionId,
      paid: true,
      customerId: 'cus_fake',
      subscriptionId: null,
      invoiceId: 'in_fake',
      amountTotalCents: 7900,
      amountTaxCents: 0,
      currency: 'USD',
      billingCountry: 'GB',
      metadata: {},
      ...settlement,
    });
  }

  async createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession> {
    const existing = this.checkoutRequests.find(
      (candidate) => candidate.idempotencyKey === request.idempotencyKey,
    );
    if (existing) {
      const index = this.checkoutRequests.indexOf(existing);
      return {
        id: `cs_fake_${index}`,
        url: `https://checkout.example/session/cs_fake_${index}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      };
    }

    this.checkoutRequests.push(request);
    const id = `cs_fake_${this.counter++}`;
    return {
      id,
      url: `https://checkout.example/session/${id}`,
      expiresAt: new Date(Date.now() + 3_600_000),
    };
  }

  async retrieveSession(sessionId: string): Promise<SettledPayment> {
    const settlement = this.settlements.get(sessionId);
    if (!settlement)
      throw new Error(`No settlement recorded for ${sessionId}. Call settle() first.`);
    return settlement;
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    this.refundRequests.push(request);
    return {
      id: `re_fake_${this.refundRequests.length}`,
      amountCents: request.amountCents ?? 0,
      status: 'succeeded',
    };
  }

  /** Produces a correctly signed payload, the way the provider would. */
  sign(payload: string, timestamp = Math.floor(Date.now() / 1000)): string {
    const signature = createHmac('sha256', this.webhookSecret)
      .update(`${timestamp}.${payload}`)
      .digest('hex');
    return `t=${timestamp},v1=${signature}`;
  }

  verifyWebhook(payload: string | Buffer, signature: string): BillingEvent {
    const body = typeof payload === 'string' ? payload : payload.toString('utf8');
    const parts = Object.fromEntries(
      signature.split(',').map((part) => part.split('=') as [string, string]),
    );
    if (!parts.t || !parts.v1) throw new WebhookVerificationError('Malformed signature header.');

    const expected = createHmac('sha256', this.webhookSecret)
      .update(`${parts.t}.${body}`)
      .digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(parts.v1);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new WebhookVerificationError('Signature did not verify.');
    }

    // Replay window. A correctly signed payload from three days ago is still a
    // correctly signed payload, and accepting it is how replay attacks work.
    const ageSeconds = Math.abs(Date.now() / 1000 - Number(parts.t));
    if (ageSeconds > 300)
      throw new WebhookVerificationError('Signature timestamp is outside the tolerance window.');

    const parsed = JSON.parse(body) as {
      id: string;
      type: string;
      created: number;
      data: { object: Record<string, unknown> };
    };
    return {
      id: parsed.id,
      type: parsed.type,
      createdAt: new Date(parsed.created * 1000),
      data: parsed.data.object,
    };
  }
}
