'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Signing in with Google.
 *
 * Supabase's own OAuth, for the same reason the second step is Supabase's own
 * TOTP: the brief says no custom auth, and this is the part of a login that is
 * least forgiving of a bespoke implementation.
 *
 * ## Why it can be absent
 *
 * The provider has to be enabled in the Supabase project with a client id and
 * secret from a Google Cloud project, and the redirect URI has to be a real
 * domain — which this product does not have yet; the primary domain is itself
 * an open item. A button that is always there and always fails teaches people
 * the product is broken, so it appears only where the operator has said the
 * provider is configured, and the sentence above it does not promise it
 * otherwise.
 *
 * ## Why it carries the documents
 *
 * Signing up with a provider skips the moment where a password sign-up records
 * which version of the Terms and the Privacy Policy somebody accepted. That
 * record is evidence rather than a checkbox, so the versions travel to the
 * callback and are checked there against what we publish. `accepted` is passed
 * only by the sign-up page: clicking a button under the sentence that says so
 * is the acceptance, and a sign-in is not one.
 */
export function GoogleButton({
  mode,
  next,
  accepted,
}: {
  mode: 'sign-in' | 'sign-up';
  next?: string | undefined;
  accepted?: string | undefined;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const callback = new URL('/auth/callback', window.location.origin);
    callback.searchParams.set('next', next ?? '/console');
    if (mode === 'sign-up' && accepted) callback.searchParams.set('accepted', accepted);

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callback.toString() },
    });
    // Reached only when the redirect did not happen. Said plainly rather than
    // left as a button that does nothing when pressed.
    if (oauthError) {
      setBusy(false);
      setError(
        `Google sign-in is not available right now. You can still use an email address and password. (${oauthError.message})`,
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
        {/* Google's own mark, drawn rather than fetched: a login button that
            waits on a third party's CDN is a login button that is sometimes
            blank. It is used unaltered and at its own proportions. */}
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
          />
          <path
            fill="#34A853"
            d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
          />
          <path
            fill="#FBBC05"
            d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
          />
          <path
            fill="#EA4335"
            d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
          />
        </svg>
        {busy ? 'Redirecting…' : mode === 'sign-up' ? 'Sign up with Google' : 'Sign in with Google'}
      </button>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
