/**
 * Bounce and complaint webhooks.
 *
 * Suppression at send time only catches the failures the provider notices while
 * we are still holding the connection. Most bounces are not like that: the
 * provider accepts the message, tries for a while, and tells us hours later. Any
 * address that fails that way is retried by the sweep on every run until the
 * sweep gives up — which is exactly the behaviour that ruins a sender's
 * reputation, and then none of the alerts arrive for anybody.
 *
 * The three rules of the payment webhook hold here for the same reasons:
 *
 *   1. The **raw body** is verified, before anything parses it. Verifying a
 *      re-serialised object verifies our serialiser, not the provider.
 *   2. An unverified payload is not an event. This URL is public, so a failed
 *      signature is a 400 and nothing else happens — no row, no suppression.
 *   3. Applying an event is idempotent by database constraint. `email` is the
 *      primary key of `email_suppressions`, so a redelivery is a no-op.
 *
 * Resend signs with Svix. The scheme is small enough to implement directly and
 * the alternative is a dependency in the path that decides whether an
 * unauthenticated POST may write to our database.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** The smallest database surface this needs. `pg.PoolClient` satisfies it. */
export interface SqlExecutor {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

export class EmailWebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailWebhookVerificationError';
  }
}

export interface SvixHeaders {
  readonly id: string | null;
  readonly timestamp: string | null;
  readonly signature: string | null;
}

export type EmailEventKind = 'hard_bounce' | 'soft_bounce' | 'complaint' | 'delivered' | 'other';

export interface EmailEvent {
  /** The provider's message id, or the delivery id when there is no message id. */
  readonly id: string;
  readonly type: string;
  readonly kind: EmailEventKind;
  readonly recipients: readonly string[];
  readonly detail: string;
  readonly occurredAt: Date;
}

/** Svix tolerates five minutes of clock skew; so do we, in both directions. */
const TOLERANCE_SECONDS = 300;

function secretBytes(secret: string): Buffer {
  // Svix secrets are handed out as `whsec_<base64>`. Both forms are accepted
  // because operators copy them either way, and getting this wrong fails closed
  // rather than silently accepting everything.
  const raw = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  return Buffer.from(raw, 'base64');
}

/**
 * Verifies the signature over the raw body and returns the normalised event.
 *
 * Throws for anything it cannot prove came from the provider. The caller turns
 * that into a 400; it must never turn it into a partial apply.
 */
export function verifyEmailWebhook(
  rawBody: string,
  headers: SvixHeaders,
  secret: string,
  now: Date = new Date(),
): EmailEvent {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) {
    throw new EmailWebhookVerificationError('Missing signature headers.');
  }

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) {
    throw new EmailWebhookVerificationError('Signature timestamp is not a number.');
  }
  if (Math.abs(now.getTime() / 1000 - seconds) > TOLERANCE_SECONDS) {
    // A correctly signed payload from three days ago is still a correctly signed
    // payload, and accepting it is how replay attacks work.
    throw new EmailWebhookVerificationError('Signature timestamp is outside the tolerance window.');
  }

  const expected = createHmac('sha256', secretBytes(secret))
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest();

  // The header carries a space-separated list so the provider can rotate its
  // secret without a gap. Any one of them matching is enough.
  const offered = signature
    .split(' ')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1,'))
    .map((part) => Buffer.from(part.slice('v1,'.length), 'base64'));

  const matched = offered.some(
    (candidate) => candidate.length === expected.length && timingSafeEqual(candidate, expected),
  );
  if (!matched) throw new EmailWebhookVerificationError('Signature did not verify.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new EmailWebhookVerificationError('Signed payload is not JSON.');
  }

  return normaliseEvent(parsed, id, now);
}

/** Signs a body the way the provider does. Used by the tests and by nothing else. */
export function signEmailWebhook(
  rawBody: string,
  secret: string,
  id: string,
  timestamp: number,
): SvixHeaders {
  const signature = createHmac('sha256', secretBytes(secret))
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest('base64');
  return { id, timestamp: String(timestamp), signature: `v1,${signature}` };
}

function normaliseEvent(payload: unknown, fallbackId: string, now: Date): EmailEvent {
  const body = (payload ?? {}) as {
    type?: unknown;
    created_at?: unknown;
    data?: Record<string, unknown>;
  };
  const type = typeof body.type === 'string' ? body.type : 'unknown';
  const data = (body.data ?? {}) as Record<string, unknown>;

  // `to` is an array on every Resend event; a single string is accepted too so a
  // provider swap does not need a change here.
  const recipients = toAddresses(data.to);

  const occurredAt = new Date(String(body.created_at ?? now.toISOString()));

  const bounce = (data.bounce ?? {}) as { type?: unknown; subType?: unknown; message?: unknown };
  const bounceType = String(bounce.type ?? '').toLowerCase();

  let kind: EmailEventKind;
  let detail: string;
  switch (type) {
    case 'email.bounced':
      // Only a permanent bounce costs the address its place on the list. A
      // transient one is a full mailbox or a greylist, and suppressing for that
      // would quietly drop a customer who is still reachable tomorrow.
      kind = bounceType === 'permanent' ? 'hard_bounce' : 'soft_bounce';
      detail = `Bounce (${bounce.type ?? 'unknown'}${bounce.subType ? `/${String(bounce.subType)}` : ''}): ${String(bounce.message ?? 'no detail supplied')}`;
      break;
    case 'email.complained':
      kind = 'complaint';
      detail = 'Recipient marked a message as spam.';
      break;
    case 'email.delivered':
      kind = 'delivered';
      detail = 'Delivered.';
      break;
    default:
      kind = 'other';
      detail = `Event ${type} recorded; no handler.`;
  }

  return {
    id: typeof data.email_id === 'string' ? data.email_id : fallbackId,
    type,
    kind,
    recipients,
    detail,
    occurredAt: Number.isNaN(occurredAt.getTime()) ? now : occurredAt,
  };
}

function toAddresses(value: unknown): string[] {
  if (typeof value === 'string') return value.length > 0 ? [value] : [];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return [];
}

export interface AppliedEmailEvent {
  readonly kind: EmailEventKind;
  readonly suppressed: readonly string[];
  readonly note: string;
}

/**
 * Applies a verified event.
 *
 * Nothing here writes anything but a suppression row, and only for the two
 * kinds that mean "stop writing to this address". Deliveries and opens are the
 * provider's business; keeping our own copy of who opened what would be an
 * analytics store of customer behaviour that this product has no reason to hold.
 */
export async function applyEmailEvent(
  sql: SqlExecutor,
  event: EmailEvent,
): Promise<AppliedEmailEvent> {
  if (event.kind !== 'hard_bounce' && event.kind !== 'complaint') {
    return { kind: event.kind, suppressed: [], note: event.detail };
  }
  if (event.recipients.length === 0) {
    return { kind: event.kind, suppressed: [], note: 'Event named no recipient; nothing applied.' };
  }

  const suppressionKind = event.kind === 'complaint' ? 'complaint' : 'hard_bounce';
  const reason = event.detail.slice(0, 500);
  const suppressed: string[] = [];

  for (const address of event.recipients) {
    const inserted = await sql.query<{ email: string }>(
      `insert into public.email_suppressions (email, reason, kind)
       values ($1, $2, $3)
       on conflict (email) do nothing
       returning email`,
      [address, reason, suppressionKind],
    );
    if (inserted.rows.length > 0) suppressed.push(address);
  }

  return {
    kind: event.kind,
    suppressed,
    note:
      suppressed.length > 0
        ? `Suppressed ${suppressed.join(', ')}.`
        : 'Already suppressed; nothing changed.',
  };
}
