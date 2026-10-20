import type { EmailOtpType } from '@supabase/supabase-js';

/**
 * What a confirmation link is actually carrying.
 *
 * Three shapes reach `/auth/callback`, and it read one of them:
 *
 *   · `?code=…`, which is exchanged for a session;
 *   · `?token_hash=…&type=signup`, which Supabase's newer email templates send
 *     instead, and which is verified rather than exchanged;
 *   · `?error=access_denied&error_code=otp_expired&error_description=…`, a
 *     refusal being handed back, with no code on it at all.
 *
 * The second and third both arrived as "no code", so both were answered with
 * the sentence written for the first: "that link had nothing left to
 * exchange — it was probably opened twice". Probably. The parameter saying
 * which was on the same URL.
 *
 * A link that expired needs a new one. A link that was already spent usually
 * was not spent by the person holding it — mail clients and security scanners
 * follow links in a message before anybody clicks, and the token is one-use —
 * so "try again, more carefully" is advice they cannot act on. And a project on
 * the newer template had every confirmation land here with nothing this route
 * would look at.
 *
 * Separated from the route because a route handler needs a Next request to run
 * and this is the part worth proving: the deciding, not the redirecting.
 */
/**
 * The refusals this product has a sentence for.
 *
 * A code from the provider, matched against this list and never rendered. What
 * the page shows is our own sentence, chosen by the match; a code that is not
 * here gets the general one. That is the whole safety property: anybody can
 * send a link with any `error_code=` on it, so the page must be incapable of
 * printing text an attacker chose.
 *
 * Narrow on purpose. These are the ones Supabase actually sends, and each has a
 * different answer for the person reading it — which is the point. Lumping them
 * together is how somebody who declined a Google consent screen was told their
 * confirmation link had expired.
 */
export const PROVIDER_REFUSALS = [
  'otp_expired',
  'access_denied',
  'bad_oauth_state',
  'flow_state_expired',
  'flow_state_not_found',
  'provider_disabled',
  'signup_disabled',
  'validation_failed',
  'server_error',
  'unexpected_failure',
] as const;

export type ProviderRefusal = (typeof PROVIDER_REFUSALS)[number];

export type SignInLink =
  | { readonly kind: 'refused'; readonly refusal: ProviderRefusal | null }
  | { readonly kind: 'email_link'; readonly type: EmailOtpType }
  | { readonly kind: 'email_link_unknown_type' }
  | { readonly kind: 'code'; readonly code: string }
  | { readonly kind: 'nothing' };

/**
 * The kinds of email link that are accepted, as Supabase names them.
 *
 * Checked against a list rather than passed through: `type` arrives from the
 * address bar, and verifying one is the call that takes a session out of a
 * token somebody else chose.
 */
export const EMAIL_LINK_TYPES: readonly EmailOtpType[] = [
  'signup',
  'magiclink',
  'recovery',
  'invite',
  'email',
  'email_change',
];

export function readSignInLink(params: URLSearchParams): SignInLink {
  /*
   * The refusal first, and before the code.
   *
   * A URL carrying both is a link that failed; answering it as a code would
   * send somebody into an exchange that cannot succeed and report the failure
   * as ours rather than as the provider's.
   */
  const error = params.get('error');
  const errorCode = params.get('error_code');
  if (error || errorCode) {
    /*
     * `error_code` first, because it is the specific one.
     *
     * Supabase sends `error=access_denied&error_code=otp_expired` for a spent
     * email link and a bare `error=access_denied` when somebody closes a
     * provider's consent screen. Read loosely, both say "access denied" — and
     * the first draft of this matched on that, so a person who changed their
     * mind at Google was told their confirmation link had expired. Each of
     * these has a different thing for the reader to do next, so each is matched
     * exactly.
     */
    const named = [errorCode, error].find((candidate) =>
      PROVIDER_REFUSALS.some((known) => known === candidate),
    );
    return {
      kind: 'refused',
      refusal: (PROVIDER_REFUSALS.find((known) => known === named) ??
        null) as ProviderRefusal | null,
    };
  }

  const code = params.get('code');
  if (code) return { kind: 'code', code };

  const tokenHash = params.get('token_hash');
  const type = params.get('type');
  if (tokenHash && type) {
    const known = EMAIL_LINK_TYPES.find((candidate) => candidate === type);
    return known ? { kind: 'email_link', type: known } : { kind: 'email_link_unknown_type' };
  }

  return { kind: 'nothing' };
}
