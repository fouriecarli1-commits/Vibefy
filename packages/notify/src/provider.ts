/**
 * The email boundary.
 *
 * Same shape as the payment boundary, for the same reason: a delivery path that
 * only works when someone has exported an API key is a delivery path nobody
 * tests. The fake in `fake.ts` implements this interface completely, so the
 * sweep, the templates, the suppression handling and the bounce path are all
 * exercised in CI without an account anywhere.
 *
 * Nothing above this interface knows which provider is behind it.
 */

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  /** Always sent. Some people read mail as text, and every client can render it. */
  readonly text: string;
  readonly html: string;
  /** Threads related notices in the recipient's client rather than stacking them. */
  readonly headers?: Readonly<Record<string, string>>;
}

export type SendFailureKind =
  /** The address does not exist. Permanent, and the address is suppressed. */
  | 'hard_bounce'
  /** A mailbox full, a greylist, a provider hiccup. Worth another sweep. */
  | 'soft_bounce'
  /** We are refusing to send: suppressed address, missing configuration. */
  | 'refused'
  /** The provider itself failed. The batch is retried rather than recorded. */
  | 'provider_error';

export type SendResult =
  | { readonly sent: true; readonly providerId: string | null }
  | { readonly sent: false; readonly kind: SendFailureKind; readonly detail: string };

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<SendResult>;
}

/** A provider-error result should stop the sweep recording anything for that message. */
export function isRetryable(result: SendResult): boolean {
  return !result.sent && (result.kind === 'soft_bounce' || result.kind === 'provider_error');
}

/** A hard bounce is the only failure that costs the address its place on the list. */
export function suppresses(result: SendResult): boolean {
  return !result.sent && result.kind === 'hard_bounce';
}
