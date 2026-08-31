import { NextResponse, type NextRequest } from 'next/server';
import { WebhookVerificationError, applyBillingEvent } from '@vibefycode/billing';
import { writeAsService } from '@/lib/sql';
import { PaymentsNotConfiguredError, providerNamed } from '@/lib/payments';
import { readWebhookBody } from '@/lib/webhook-body';

/**
 * Paystack's webhook.
 *
 * The same three rules as the Stripe endpoint — raw body verified before
 * anything parses it, an unverified payload is not an event, and applying one
 * is idempotent by database constraint rather than by hope — with one
 * difference that matters.
 *
 * Paystack's signature is an HMAC of the body keyed by the secret key, with no
 * timestamp in it. So unlike Stripe's, it never expires: a payload captured
 * today verifies perfectly a year from now. Replay protection therefore cannot
 * live here at all. It lives in `billing_events`, where the unique constraint
 * on (provider, event id) rejects a repeat before a single record changes —
 * which is why the id this provider synthesises from the transaction reference
 * has to be stable for the same underlying event, and is.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const signature = request.headers.get('x-paystack-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature.' }, { status: 400 });
  }

  const body = await readWebhookBody(request);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });

  let payments;
  try {
    payments = providerNamed('paystack');
  } catch (error) {
    if (error instanceof PaymentsNotConfiguredError) {
      // 503 rather than 500: Paystack retries a 5xx, and this one becomes
      // correct the moment the key is set rather than needing a redelivery by
      // hand.
      return NextResponse.json({ error: 'Paystack is not configured here.' }, { status: 503 });
    }
    throw error;
  }

  let event;
  try {
    event = payments.verifyWebhook(body.raw, signature);
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      return NextResponse.json({ error: 'Signature did not verify.' }, { status: 400 });
    }
    throw error;
  }

  try {
    const applied = await writeAsService((client) => applyBillingEvent(client, payments, event));
    // 200 on a duplicate too: the provider should stop retrying something we
    // have already handled, and telling it otherwise causes a retry storm.
    return NextResponse.json({ received: true, duplicate: applied.duplicate, note: applied.note });
  } catch (error) {
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        message: 'paystack webhook failed',
        eventId: event.id,
        error: String(error),
      }),
    );
    return NextResponse.json({ error: 'Could not apply the event.' }, { status: 500 });
  }
}
