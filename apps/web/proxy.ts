import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { whoIsSignedIn } from '@/lib/who-is-signed-in';

/**
 * Said once a minute rather than once a request.
 *
 * This file runs on every route that is not a static asset. A configuration
 * fault here is the same fault on every request, and a line per request would
 * bury the one line somebody is looking for.
 */
let complainedAt = 0;
function sayOnce(message: string, detail: Record<string, unknown>): void {
  const now = Date.now();
  if (now - complainedAt < 60_000) return;
  complainedAt = now;
  console.error(message, detail);
}

/**
 * Next 16 calls this file the proxy; it is the former middleware convention.
 * Refreshes the Supabase session on every request and keeps the console behind
 * authentication. The redirect here is a convenience, not the security boundary:
 * row-level security is, and it holds even if this file is deleted.
 *
 * Which is the reasoning this file did not follow. It read both variables with
 * `!` and built the client before anything else, so a deployment with one of
 * them missing or mistyped threw here — on the matcher below, which is every
 * route but the static assets. The home page, `/how-it-works`, `/methodology`,
 * the legal documents and the pricing table read no database at all and went
 * down with it: a marketing site returning 500 because of a variable only the
 * console needs.
 *
 * So the two faults it can have are handled rather than thrown:
 *
 *   · the variables are not set, which is a deployment that was never
 *     finished, and
 *   · the client or the session refresh throws, which is Supabase being
 *     unreachable or an answer we cannot parse.
 *
 * Both let the request through. Nothing is exposed by that, and saying why
 * matters more than the line of code: a `/console` page is not protected by
 * this redirect. Every one of them calls `getUser()` itself and redirects when
 * there is nobody, every query they make runs under row-level security as the
 * caller, and with these variables absent no page can reach the database at
 * all. What the redirect buys is not having to render a console page to find
 * out — a convenience, exactly as the paragraph above says, and a convenience
 * is not worth the public pages.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    sayOnce('the session cannot be refreshed, so every request is being let through', {
      missing: [
        url ? null : 'NEXT_PUBLIC_SUPABASE_URL',
        anonKey ? null : 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      ].filter(Boolean),
      means:
        'Set it in the deployment and redeploy. Until then nobody can sign in, and the pages that need no database still work.',
    });
    return response;
  }

  try {
    return await refreshAndGuard(request, url, anonKey);
  } catch (error) {
    sayOnce('the session could not be refreshed on this request', {
      error: error instanceof Error ? error.message : String(error),
      means:
        'Supabase could not be reached or answered something unexpected. Requests are let through; a signed-in page still checks for itself.',
    });
    return NextResponse.next({ request });
  }
}

async function refreshAndGuard(
  request: NextRequest,
  url: string,
  anonKey: string,
): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  /*
   * The question, and what it means when it cannot be answered.
   *
   * `getUser` does not throw on an auth failure — it answers with an error in
   * the result — so the `catch` above never saw this case. A customer with a
   * live session whose session could not be confirmed was treated as nobody and
   * sent to the sign-in page: the first thing in the request path, redirecting
   * to the page that implies their password is the problem, silently. This is
   * the same defect as in the seventy pages behind it, and this is where it is
   * felt first.
   *
   * `whoIsSignedIn` carries its own saying-once, keyed per message rather than
   * the single timestamp `sayOnce` above holds, which is what lets a second
   * fault be heard while the first is still happening.
   */
  const user = await whoIsSignedIn(supabase);

  if (!user && request.nextUrl.pathname.startsWith('/console')) {
    const signIn = request.nextUrl.clone();
    signIn.pathname = '/sign-in';
    signIn.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(signIn);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|brand/|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)'],
};
