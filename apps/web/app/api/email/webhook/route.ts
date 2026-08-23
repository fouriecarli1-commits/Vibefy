import { NextResponse, type NextRequest } from 'next/server';
import {
  EmailWebhookVerificationError,
  applyEmailEvent,
  verifyEmailWebhook,
} from '@vibefycode/notify';
import { writeAsService } from '@/lib/sql';

/**
 * The email provider's webhook — bounces and complaints.
 *
 * Same shape as the payment webhook, and for the same reasons: the raw body is
 * verified before anything parses it, an unverified payload is a 400 and
 * nothing else, and applying is idempotent by primary key.
 *
 * Unconfigured is a 404, not a 200. An endpoint that silently accepts anything
 * when a secret is missing is worse than one that is not there — it looks like
 * it is working.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Not configured.' }, { status: 404 });
  }

  const rawBody = await request.text();

  let event;
  try {
    event = verifyEmailWebhook(
      rawBody,
      {
        id: request.headers.get('svix-id'),
        timestamp: request.headers.get('svix-timestamp'),
        signature: request.headers.get('svix-signature'),
      },
      secret,
    );
  } catch (error) {
    if (error instanceof EmailWebhookVerificationError) {
      return NextResponse.json({ error: 'Signature did not verify.' }, { status: 400 });
    }
    throw error;
  }

  try {
    const applied = await writeAsService((client) => applyEmailEvent(client, event));
    return NextResponse.json({ received: true, kind: applied.kind, note: applied.note });
  } catch (error) {
    // A 500 asks the provider to redeliver, which is what we want when our own
    // database was briefly unavailable. Suppression is idempotent, so a
    // redelivery of one we half-applied costs nothing.
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        message: 'email webhook failed',
        eventType: event.type,
        error: String(error),
      }),
    );
    return NextResponse.json({ error: 'Could not apply the event.' }, { status: 500 });
  }
}
