import { NextResponse, type NextRequest } from 'next/server';
import {
  FakePaymentProvider,
  StripeProvider,
  WebhookVerificationError,
  applyBillingEvent,
  type PaymentProvider,
} from '@vibefy/billing';
import { writeAsService } from '@/lib/sql';

/**
 * The payment provider's webhook.
 *
 * Three things are true of this endpoint and are worth stating, because each of
 * them is a way people get this wrong:
 *
 *   1. The **raw body** is verified, before anything parses it. Verifying a
 *      re-serialised object verifies our serialiser, not the provider.
 *   2. An unverified payload is not an event. Anyone can POST JSON at a public
 *      URL, so a failed signature is a 400 and nothing else happens.
 *   3. Applying an event is idempotent by database constraint, not by hope. The
 *      provider will deliver some of these twice.
 */
export const dynamic = 'force-dynamic';

function provider(): PaymentProvider {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secretKey || !webhookSecret) {
    // Local development without Stripe keys. The fake verifies signatures with a
    // real HMAC, so the path being exercised is the same one, not a bypass.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be set in production.');
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

export async function POST(request: NextRequest) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature.' }, { status: 400 });
  }

  const rawBody = await request.text();

  let event;
  try {
    event = provider().verifyWebhook(rawBody, signature);
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      return NextResponse.json({ error: 'Signature did not verify.' }, { status: 400 });
    }
    throw error;
  }

  try {
    const applied = await writeAsService((client) => applyBillingEvent(client, event));
    // 200 on a duplicate too: the provider should stop retrying something we
    // have already handled, and telling it otherwise causes a retry storm.
    return NextResponse.json({ received: true, duplicate: applied.duplicate, note: applied.note });
  } catch (error) {
    // A 500 asks the provider to retry, which is what we want when our own
    // database was briefly unavailable.
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        message: 'billing webhook failed',
        eventId: event.id,
        error: String(error),
      }),
    );
    return NextResponse.json({ error: 'Could not apply the event.' }, { status: 500 });
  }
}
