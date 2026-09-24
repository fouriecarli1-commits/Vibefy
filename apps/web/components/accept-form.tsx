'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { acceptDocuments } from '@/app/auth/accept/actions';

/**
 * One button, and it is the acceptance.
 *
 * No checkbox. A checkbox beside a button records that somebody found the
 * checkbox, and the thing we have to be able to show later is that they were
 * shown the documents and chose to continue — which is what the sentence above
 * this button says and what pressing it means.
 */
export function AcceptForm({ next }: { next: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<{ kind: 'idle' | 'busy' | 'error'; message?: string }>({
    kind: 'idle',
  });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ kind: 'busy' });
    const result = await acceptDocuments();
    if (result.error) return setStatus({ kind: 'error', message: result.error });
    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <p className="max-w-prose text-sm text-muted">
        Continuing records your acceptance of both documents, with the version, the timestamp and a
        hash of the exact wording as it stands now.
      </p>
      <button
        type="submit"
        disabled={status.kind === 'busy'}
        className="rounded-lg bg-accent px-5 py-3 font-medium text-on-accent disabled:opacity-60"
      >
        {status.kind === 'busy' ? 'Recording…' : 'I accept — continue'}
      </button>
      <div role="status" aria-live="polite" className="min-h-6 text-sm">
        {status.kind === 'error' && <p className="text-bad">{status.message}</p>}
      </div>
    </form>
  );
}
