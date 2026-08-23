import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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

  return NextResponse.redirect(`${origin}${next}`);
}
