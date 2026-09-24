'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
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
