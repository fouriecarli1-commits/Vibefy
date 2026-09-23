'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { decideSecondStep } from '@/lib/second-step';

type Mode = 'sign-in' | 'sign-up';

/**
 * Sign-in and sign-up. Acceptance of the Terms and the Privacy Policy is
 * recorded at sign-up with the version, timestamp and user — the consents table
 * is append-only, so this record is evidence rather than a checkbox.
 */
export interface AcceptedDocument {
  documentType: string;
  version: string;
  sha256: string;
}

export function AuthForm({
  mode,
  next,
  acceptedDocuments = [],
}: {
  mode: Mode;
  next?: string | undefined;
  acceptedDocuments?: AcceptedDocument[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [code, setCode] = useState('');
  const [secondStep, setSecondStep] = useState<{
    factorId: string;
    challengeId: string;
  } | null>(null);
  const [status, setStatus] = useState<{
    kind: 'idle' | 'busy' | 'error' | 'sent';
    message?: string;
  }>({ kind: 'idle' });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ kind: 'busy' });
    const supabase = createClient();

    if (mode === 'sign-up') {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // Carried in metadata because there is no session yet to write a
          // consent row under; lib/consent.ts materialises it on first sign-in.
          data: {
            full_name: fullName,
            accepted_documents: acceptedDocuments,
            accepted_at: new Date().toISOString(),
          },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next ?? '/console')}`,
        },
      });
      if (error) return setStatus({ kind: 'error', message: error.message });
      return setStatus({
        kind: 'sent',
        message:
          'Check your email for the confirmation link. Locally, it lands in Inbucket on port 54324.',
      });
    }

    // Before a password is accepted, ask whether this address belongs to a
    // domain that requires single sign-on. A workspace that has enforced SSO has
    // done so precisely so that a password cannot be an alternative route in.
    const { data: routing } = await supabase.rpc('sso_routing', { candidate_email: email });
    const route = Array.isArray(routing) ? routing[0] : routing;
    if (route?.email_domain) {
      const { error: ssoError } = await supabase.auth.signInWithSSO({
        domain: String(route.email_domain),
      });
      if (ssoError) {
        return setStatus({
          kind: 'error',
          message: `${route.email_domain} signs in through your organisation’s identity provider, and password sign-in is refused for it. ${ssoError.message}`,
        });
      }
      return setStatus({
        kind: 'busy',
        message: 'Redirecting you to your organisation’s identity provider…',
      });
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return setStatus({ kind: 'error', message: error.message });

    /*
     * The half of a second step that is easy to forget.
     *
     * Enrolling a factor is the visible half and does nothing on its own:
     * `signInWithPassword` succeeds against an account with TOTP enrolled and
     * hands back a session at assurance level one. Navigating here would let a
     * password alone reach the console of an account whose owner believes they
     * have turned that off — the feature would look enabled on the settings
     * page and be enforced nowhere.
     *
     * So the level is asked for rather than assumed. `nextLevel` is what this
     * account requires; `currentLevel` is what the session has. Where they
     * differ, the password bought nothing yet.
     */
    const { data: assurance, error: assuranceError } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const decision = decideSecondStep(assuranceError ? null : (assurance ?? null));
    if (decision.kind === 'refuse') {
      // Signing out first. A session that may be one step short of what this
      // account requires is not one to leave in the browser while we explain.
      await supabase.auth.signOut();
      return setStatus({
        kind: 'error',
        message: assuranceError
          ? `${decision.because} (${assuranceError.message})`
          : decision.because,
      });
    }
    if (decision.kind === 'second_step') {
      const { data: factors, error: factorError } = await supabase.auth.mfa.listFactors();
      const factor = factors?.totp?.[0];
      if (factorError || !factor) {
        await supabase.auth.signOut();
        return setStatus({
          kind: 'error',
          message:
            'This account needs a code from an authenticator app, and we could not find the enrolled device to ask for one. Write to us rather than creating a second account — everything you have is attached to this one.',
        });
      }
      const challenge = await supabase.auth.mfa.challenge({ factorId: factor.id });
      if (challenge.error || !challenge.data) {
        await supabase.auth.signOut();
        return setStatus({
          kind: 'error',
          message: challenge.error?.message ?? 'The second step could not be started.',
        });
      }
      setSecondStep({ factorId: factor.id, challengeId: challenge.data.id });
      return setStatus({ kind: 'idle' });
    }

    router.push(next ?? '/console');
    router.refresh();
  }

  async function onSecondStep(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!secondStep) return;
    setStatus({ kind: 'busy' });
    const supabase = createClient();
    const { error } = await supabase.auth.mfa.verify({
      factorId: secondStep.factorId,
      challengeId: secondStep.challengeId,
      code: code.trim(),
    });
    if (error) {
      return setStatus({
        kind: 'error',
        message: `${error.message} Codes change every thirty seconds — if the last one expired while you typed it, the next one will work.`,
      });
    }
    router.push(next ?? '/console');
    router.refresh();
  }

  const busy = status.kind === 'busy';

  /*
   * The second step replaces the form rather than appearing beneath it.
   *
   * The password has already been accepted at this point. Leaving the email and
   * password fields on screen invites somebody to retype them, which starts the
   * whole exchange again and invalidates the challenge they were about to
   * answer — so the one thing left to do is the only thing on screen.
   */
  if (secondStep) {
    return (
      <form onSubmit={onSecondStep} className="max-w-sm space-y-5" noValidate>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">One more step</h2>
          <p className="text-sm text-muted">
            Your password was accepted. Open your authenticator app and type the six-digit code it
            shows for VibefyCode.
          </p>
        </div>
        <div className="space-y-2">
          <label htmlFor="sign-in-code" className="block text-sm font-medium">
            The six-digit code
          </label>
          <input
            id="sign-in-code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            required
            autoFocus
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className="w-full max-w-40 rounded-lg border border-line-strong bg-surface px-3 py-2 text-lg tracking-widest"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-accent px-4 py-3 font-medium text-on-accent disabled:opacity-60"
        >
          {busy ? 'Checking…' : 'Continue'}
        </button>
        <div role="status" aria-live="polite" className="min-h-6 text-sm">
          {status.kind === 'error' && <p className="text-bad">{status.message}</p>}
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="max-w-sm space-y-5" noValidate>
      {mode === 'sign-up' && (
        <div className="space-y-2">
          <label htmlFor="full-name" className="block text-sm font-medium">
            Your name
          </label>
          <input
            id="full-name"
            name="name"
            type="text"
            autoComplete="name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2"
          />
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor="email" className="block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="password" className="block text-sm font-medium">
          Password
        </label>
        {/* The eye.

            We ask for at least twelve characters and tell people to use a
            passphrase they have not used elsewhere, and then gave them no way
            to see what they had typed. A long passphrase typed blind on a
            phone is how somebody ends up with an account whose password is not
            what they think it is — on sign-up there is no second field to
            catch it, so the first they learn of the typo is the day they
            cannot get back in.

            It is a button, not a checkbox, and it says what it will do next
            rather than what the field is doing now: a screen reader reading
            "Show password" is unambiguous, where a checkbox labelled
            "password" leaves the reader working out which state is which. */}
        <div className="relative">
          <input
            id="password"
            name="password"
            type={revealed ? 'text' : 'password'}
            required
            minLength={12}
            autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
            aria-describedby="password-hint"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 pe-24"
          />
          <button
            type="button"
            onClick={() => setRevealed((shown) => !shown)}
            aria-controls="password"
            className="absolute inset-y-0 end-0 px-3 text-sm font-medium text-muted underline underline-offset-2"
          >
            {revealed ? 'Hide' : 'Show'}
            <span className="sr-only"> password</span>
          </button>
        </div>
        <p id="password-hint" className="text-sm text-muted">
          At least 12 characters. Use a passphrase you have not used elsewhere.
          {revealed ? ' Your password is visible on screen.' : ''}
        </p>
      </div>

      {mode === 'sign-up' && (
        <p className="text-sm text-muted">
          Creating an account records your acceptance of the{' '}
          <a href="/legal/terms-of-service">Terms of Service</a> and the{' '}
          <a href="/legal/privacy-policy">Privacy Policy</a>, with the version, the timestamp and a
          hash of the exact wording. Both are drafts pending legal review.
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-accent px-4 py-3 font-medium text-on-accent disabled:opacity-60"
      >
        {busy ? 'Working…' : mode === 'sign-up' ? 'Create account' : 'Sign in'}
      </button>

      <div role="status" aria-live="polite" className="min-h-6 text-sm">
        {status.kind === 'error' && <p className="text-bad">{status.message}</p>}
        {status.kind === 'sent' && <p className="text-ok">{status.message}</p>}
      </div>
    </form>
  );
}
