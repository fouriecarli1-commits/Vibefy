import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { recordProviderConsents } from '@/lib/consent';

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

  return NextResponse.redirect(`${origin}${next}`);
}
