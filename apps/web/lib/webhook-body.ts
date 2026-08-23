/**
 * Reading a webhook body without trusting whoever sent it.
 *
 * Both webhook endpoints are public and unauthenticated until a signature has
 * been checked — and a signature cannot be checked until the body has been
 * read. That is the window: anyone on the internet can make us buffer whatever
 * they send before we are in a position to refuse it.
 *
 * A signed event from either provider is a few kilobytes. Anything past the cap
 * is refused without being read, which is the only point at which refusing it
 * costs nothing.
 */
import type { NextRequest } from 'next/server';

/** Generous by two orders of magnitude, and still small enough to be harmless. */
export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

export type WebhookBody =
  | { readonly ok: true; readonly raw: string }
  | { readonly ok: false; readonly status: 413; readonly error: string };

export async function readWebhookBody(request: NextRequest): Promise<WebhookBody> {
  const declared = Number(request.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BODY_BYTES) {
    return { ok: false, status: 413, error: 'Payload too large.' };
  }

  const raw = await request.text();
  // Checked again after reading: `content-length` is a claim, and a chunked
  // request does not make one at all.
  if (Buffer.byteLength(raw, 'utf8') > MAX_WEBHOOK_BODY_BYTES) {
    return { ok: false, status: 413, error: 'Payload too large.' };
  }
  return { ok: true, raw };
}
