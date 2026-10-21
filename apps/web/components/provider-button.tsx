'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { isPlaceholderOrigin, siteOriginFor } from '@/lib/verify-origin';
import { providerLabel, type SocialProviderId } from '@vibefycode/shared';

/**
 * Signing in with somebody else's account.
 *
 * Supabase's own OAuth, for the same reason the second step is Supabase's own
 * TOTP: the brief says no custom auth, and this is the part of a login least
 * forgiving of a bespoke implementation. One component for all nine providers,
 * because nine copies of this is eight chances for one of them to forget the
 * consent parameter.
 *
 * ## Why it carries the documents
 *
 * Signing up with a provider skips the moment where a password sign-up records
 * which version of the Terms and the Privacy Policy somebody accepted. That
 * record is evidence rather than a checkbox, so the versions travel to the
 * callback and are checked there against what we publish. `accepted` is passed
 * only by the sign-up page: clicking a button under the sentence that says so is
 * the acceptance, and a sign-in is not one.
 *
 * ## Why there is no logo
 *
 * Eight brand marks drawn from memory are eight subtly wrong logos, and several
 * of these companies publish licence terms about theirs. A product whose whole
 * argument is that it does not redraw somebody else's mark cannot open with
 * redrawn marks on its front door. The provider's name, in the same button as
 * the rest, until the real assets come from each provider's own kit.
 */
export function ProviderButton({
  provider,
  mode,
  next,
  accepted,
}: {
  provider: SocialProviderId;
  mode: 'sign-in' | 'sign-up';
  next?: string | undefined;
  accepted?: string | undefined;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = providerLabel(provider);

  async function go() {
    setBusy(true);
    setError(null);
    const supabase = createClient();

    /*
     * The hand-back has to come home to the host that started the flow.
     *
     * This read `window.location.origin`, which is whichever hostname the
     * visitor happens to be on. A deployment answering on both `vibefycode.com`
     * and `www.vibefycode.com` therefore sends one of two different addresses
     * to Supabase, and the consequences of guessing wrong are not symmetrical:
     *
     *   · Supabase refuses a `redirect_to` that is not in its allow-list and
     *     falls back to the Site URL — so the visitor lands somewhere with
     *     nothing on the address, which is the "that link arrived with nothing
     *     on it" page, for a sign-in that never failed as far as they saw;
     *   · the PKCE verifier is stored in a cookie on the host that starts the
     *     flow, and a cookie set on `www.` is not sent to the apex. Even a
     *     redirect that is allowed then arrives at a callback that cannot
     *     finish it.
     *
     * So the flow starts on the host this deployment calls its own. When
     * `NEXT_PUBLIC_SITE_URL` says nothing, the current origin is the only
     * answer available and nothing changes — `siteOriginFor` is the same
     * resolver the console's own links use, and the browser has no request to
     * read a host from.
     */
    const canonical = siteOriginFor(null);
    if (!isPlaceholderOrigin(canonical) && canonical !== window.location.origin) {
      // Same page, the other hostname. The sign-in then happens entirely on one
      // host: the verifier, the hand-back and the session cookie.
      window.location.replace(`${canonical}${window.location.pathname}${window.location.search}`);
      return;
    }

    const callback = new URL('/auth/callback', window.location.origin);
    callback.searchParams.set('next', next ?? '/console');
    if (mode === 'sign-up' && accepted) callback.searchParams.set('accepted', accepted);

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: callback.toString() },
    });
    // Reached only when the redirect did not happen. Said plainly rather than
    // left as a button that does nothing when pressed.
    if (oauthError) {
      setBusy(false);
      setError(
        `${label} sign-in is not available right now. You can still use an email address and password. (${oauthError.message})`,
      );
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void go()}
        disabled={busy}
        className="flex w-full items-center justify-center gap-3 rounded-lg border border-line-strong px-4 py-3 font-medium disabled:opacity-60"
      >
        {busy ? 'Redirecting…' : `${mode === 'sign-up' ? 'Sign up' : 'Sign in'} with ${label}`}
      </button>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
