'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Asking for a reset link.
 *
 * The one rule that shapes this component: **the answer is the same whether or
 * not the address has an account.** A form that says "no account with that
 * address" is a way for anybody to find out who our customers are, one address
 * at a time, without signing in — and the people it would tell are the same
 * people who would find that list worth having. Supabase does not distinguish
 * either, and this does not undo that by reporting its errors differently.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'busy' | 'sent'>('idle');

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('busy');
    const supabase = createClient();
    /*
     * The error is deliberately not surfaced.
     *
     * A failure here is almost always rate limiting or a transport problem,
     * and the one thing it must never do is differ visibly between an address
     * that has an account and one that does not. Showing the same sentence
     * either way costs somebody with a genuine transport failure one retry;
     * showing two different sentences costs every customer their privacy.
     */
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent('/auth/new-password')}`,
    });
    setStatus('sent');
  }

  if (status === 'sent') {
    return (
      <div role="status" aria-live="polite" className="space-y-3 rounded-xl border border-line p-5">
        <p className="font-medium">If that address has an account, the link is on its way.</p>
        <p className="text-sm text-muted">
          It is good for one use and expires. If nothing arrives in a few minutes, check the spam
          folder and that the address is the one you signed up with — we cannot tell you whether it
          is, because answering that question for you would answer it for anybody.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div className="space-y-2">
        <label htmlFor="reset-email" className="block text-sm font-medium">
          Email
        </label>
        <input
          id="reset-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2"
        />
      </div>
      <button
        type="submit"
        disabled={status === 'busy'}
        className="w-full rounded-lg bg-accent px-4 py-3 font-medium text-on-accent disabled:opacity-60"
      >
        {status === 'busy' ? 'Working…' : 'Email me a reset link'}
      </button>
    </form>
  );
}
