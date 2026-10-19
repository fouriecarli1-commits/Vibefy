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
export type SignInLink =
  | { readonly kind: 'refused'; readonly spent: boolean }
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
    return { kind: 'refused', spent: /expired|access_denied/i.test(`${error} ${errorCode}`) };
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
