'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

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

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return setStatus({ kind: 'error', message: error.message });
    router.push(next ?? '/console');
    router.refresh();
  }

  const busy = status.kind === 'busy';

  return (
    <form onSubmit={onSubmit} className="max-w-sm space-y-5" noValidate>
      {mode === 'sign-up' && (
        <div className="space-y-1.5">
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

      <div className="space-y-1.5">
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

      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={12}
          autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
          aria-describedby="password-hint"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2"
        />
        <p id="password-hint" className="text-sm text-muted">
          At least 12 characters. Use a passphrase you have not used elsewhere.
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
        className="w-full rounded-lg bg-accent px-4 py-2.5 font-medium text-white disabled:opacity-60"
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
