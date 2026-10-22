import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { whoIsSignedIn } from '@/lib/who-is-signed-in';
import { readSignInLink } from '@/lib/sign-in-link';
import { missingConsents, recordProviderConsents, recordSignUpConsents } from '@/lib/consent';

/**
 * Turns a confirmation link into a session, whichever shape it arrives in.
 *
 * Three of them reach this route: a `code` to exchange, a `token_hash` and a
 * `type` to verify, and a refusal the provider is handing back. It read the
 * first and ignored the other two, so an expired link, a link a mail scanner
 * had already spent, and a project whose email template is the newer one all
 * ended on the sign-in page saying "that link had nothing left to exchange" —
 * a sentence written for one of those three and true of one of them.
 *
 * `next` is resolved against our own origin only — an open redirect on an auth
 * callback is how phishing gets a foothold.
 */

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const requestedNext = searchParams.get('next') ?? '/console';
  const next =
    requestedNext.startsWith('/') && !requestedNext.startsWith('//') ? requestedNext : '/console';

  const supabase = await createClient();
  const link = readSignInLink(searchParams);

  if (link.kind === 'refused') {
    // The provider's words go to the log, never to the page: the page renders a
    // sentence of ours, chosen by a code of ours.
    console.error('a sign-in link came back from the provider with an error', {
      error: searchParams.get('error'),
      code: searchParams.get('error_code'),
      description: searchParams.get('error_description'),
      means:
        'The link was refused before any session existed. otp_expired or access_denied is an ' +
        'expired or already-used email link — mail scanners follow links before the recipient ' +
        'does, which spends them.',
    });
    /*
     * The code the provider named, when it is one we have a sentence for.
     *
     * Not an echo: `readSignInLink` matched it against a fixed list before it
     * got here, so the parameter below is one of ten strings we chose, and the
     * page renders a sentence of ours for each. A refusal we do not recognise
     * falls back to the general sentence, which is also what somebody sending a
     * link with `error_code=` of their own invention gets.
     */
    return NextResponse.redirect(`${origin}/sign-in?error=${link.refusal ?? 'provider_refused'}`);
  }

  if (link.kind === 'email_link_unknown_type') {
    console.error('a sign-in link named a kind of confirmation this route does not accept', {
      type: searchParams.get('type'),
    });
    return NextResponse.redirect(`${origin}/sign-in?error=provider_refused`);
  }

  if (link.kind === 'email_link') {
    const { error: otpError } = await supabase.auth.verifyOtp({
      token_hash: searchParams.get('token_hash') ?? '',
      type: link.type,
    });
    if (otpError) {
      console.error('an email confirmation link could not be verified', {
        type: link.type,
        error: otpError.message,
      });
      // The same sentence a spent link gets from the other path, under the
      // same code, so the two ways an email link can fail do not read as two
      // different problems to the person holding one link.
      const spent = /expired|invalid/i.test(otpError.message);
      return NextResponse.redirect(
        `${origin}/sign-in?error=${spent ? 'otp_expired' : 'exchange_failed'}`,
      );
    }
    return await onceSignedIn(origin, next, searchParams);
  }

  if (link.kind === 'nothing') {
    /*
     * Already signed in, and sent to the sign-in page anyway.
     *
     * This address ends up in a browser's history and its autocomplete, so it
     * is opened again — after a sign-in that worked, from a second tab, from
     * the bar. There is nothing on it, so the only answer this route had was
     * "that link arrived with nothing on it to exchange", shown to somebody
     * who is signed in and could simply have been let through. Every one of
     * those looks, to the person, exactly like the failure they have been
     * fighting.
     *
     * Asked of the session cookie rather than the URL, which is the one source
     * that can tell the two apart.
     */
    const user = await whoIsSignedIn(supabase);
    if (user) return NextResponse.redirect(`${origin}${next}`);

    /*
     * Nothing to exchange, and now it is written down.
     *
     * The page has always said this plainly; the log said nothing, so a
     * deployment where every confirmation landed here looked, from the inside,
     * like a deployment nobody was using. The parameter names are reported and
     * never their values: a token on this URL is a session.
     */
    console.error('a sign-in callback arrived with nothing to exchange', {
      parameters: [...searchParams.keys()].sort(),
      means:
        'No code, no token_hash, no error and no session. A link opened in a different browser ' +
        'from the one that asked for it, a redirect that dropped the query string, this address ' +
        'reopened from history, or a Supabase Site URL pointing at this path instead of at the ' +
        'origin — which sends every fallback here with nothing on it.',
    });
    return NextResponse.redirect(`${origin}/sign-in?error=missing_code`);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(link.code);

  if (error) {
    /*
     * A code we choose, and the real message in the log.
     *
     * This put `error.message` into the address bar, where it was read by
     * nobody — `/sign-in` took `next` and ignored everything else — and where,
     * the day somebody rendered it, it would have been text an attacker could
     * choose by sending a link. The sentence the customer sees is now ours;
     * the provider's is ours to debug with.
     */
    console.error('the sign-in code could not be exchanged for a session', {
      error: error.message,
    });
    return NextResponse.redirect(`${origin}/sign-in?error=exchange_failed`);
  }

  return await onceSignedIn(origin, next, searchParams);
}

/**
 * What has to happen on every path that produces a session, whichever link it
 * came from. Written once because the second path through this route — an email
 * link carrying `token_hash` — would otherwise have signed somebody in without
 * a consent record and past the door below.
 */
async function onceSignedIn(
  origin: string,
  next: string,
  searchParams: URLSearchParams,
): Promise<NextResponse> {
  /*
   * The acceptance a provider sign-up would otherwise never record.
   *
   * A password sign-up carries the accepted versions in its metadata and
   * `recordSignUpConsents` materialises them on the first authenticated
   * request. An OAuth sign-up has no such moment, so without this an account
   * created with Google had no consent record at all. What arrives here is a
   * claim and is checked against the registry we publish now.
   */
  await recordProviderConsents(searchParams.get('accepted'));
  // The password path carries its acceptance in the sign-up metadata, and this
  // is the first authenticated moment it can be written down. Idempotent: the
  // consents table is append-only and this finds an existing record.
  await recordSignUpConsents();

  /*
   * Nobody reaches the console without an acceptance on record.
   *
   * Signing in with a provider *creates* an account when there is not one
   * already, so the buttons on the sign-in page could produce an account with
   * full access and nothing recording that anybody agreed to anything — the
   * sign-up page is the only one that passes `accepted`, and a provider account
   * has no sign-up metadata either.
   *
   * Asked here rather than on each console page: this is the one door every
   * route that creates an account comes through, and a check on the far side is
   * a check somebody adding the tenth provider next year has to remember.
   */
  const missing = await missingConsents();
  if (missing.length > 0) {
    const accept = new URL('/auth/accept', origin);
    accept.searchParams.set('next', next);
    return NextResponse.redirect(accept.toString());
  }

  return NextResponse.redirect(`${origin}${next}`);
}
