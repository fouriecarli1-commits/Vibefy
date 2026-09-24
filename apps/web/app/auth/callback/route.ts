import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { missingConsents, recordProviderConsents, recordSignUpConsents } from '@/lib/consent';

/**
 * Exchanges the email confirmation code for a session. `next` is resolved
 * against our own origin only — an open redirect on an auth callback is how
 * phishing gets a foothold.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const requestedNext = searchParams.get('next') ?? '/console';
  const next =
    requestedNext.startsWith('/') && !requestedNext.startsWith('//') ? requestedNext : '/console';

  if (!code) {
    return NextResponse.redirect(`${origin}/sign-in?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/sign-in?error=${encodeURIComponent(error.message)}`);
  }

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
