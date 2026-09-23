'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/** The same floor the sign-up form asks for, stated in one place. */
const MINIMUM = 12;

export function NewPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [status, setStatus] = useState<{ kind: 'idle' | 'busy' | 'error'; message?: string }>({
    kind: 'idle',
  });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < MINIMUM) {
      return setStatus({
        kind: 'error',
        message: `Use at least ${MINIMUM} characters. A passphrase is easier to remember than a short password and harder to guess.`,
      });
    }
    setStatus({ kind: 'busy' });
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return setStatus({ kind: 'error', message: error.message });
    router.push('/console');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div className="space-y-2">
        <label htmlFor="new-password" className="block text-sm font-medium">
          New password
        </label>
        {/* One field, and an eye rather than a second field to type it into
            twice. Confirming a password by typing it again catches a typo only
            if the same typo is not made twice, and it cannot be checked at all
            by somebody who cannot see either field. Showing what was typed
            catches every typo, including the repeated one. */}
        <div className="relative">
          <input
            id="new-password"
            name="password"
            type={revealed ? 'text' : 'password'}
            required
            minLength={MINIMUM}
            autoComplete="new-password"
            aria-describedby="new-password-hint"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 pe-24"
          />
          <button
            type="button"
            onClick={() => setRevealed((shown) => !shown)}
            aria-controls="new-password"
            className="absolute inset-y-0 end-0 px-3 text-sm font-medium text-muted underline underline-offset-2"
          >
            {revealed ? 'Hide' : 'Show'}
            <span className="sr-only"> password</span>
          </button>
        </div>
        <p id="new-password-hint" className="text-sm text-muted">
          At least {MINIMUM} characters. Use a passphrase you have not used elsewhere.
          {revealed ? ' Your password is visible on screen.' : ''}
        </p>
      </div>

      <button
        type="submit"
        disabled={status.kind === 'busy'}
        className="w-full rounded-lg bg-accent px-4 py-3 font-medium text-on-accent disabled:opacity-60"
      >
        {status.kind === 'busy' ? 'Working…' : 'Set password and continue'}
      </button>

      <div role="status" aria-live="polite" className="min-h-6 text-sm">
        {status.kind === 'error' && <p className="text-bad">{status.message}</p>}
      </div>
    </form>
  );
}
