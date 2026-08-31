'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * What somebody sees when we cannot answer at all.
 *
 * Without this file the framework's generic failure page stands here, and a
 * verification page that fails anonymously is worse than one that fails: the
 * visitor cannot tell whether the badge is fraudulent or our database is down,
 * and the two have opposite meanings.
 *
 * So the page refuses to imply either. It says what broke, says the outage is
 * ours, and states in as many words that this is not evidence for or against the
 * badge — because a page that shrugs will be read as evidence by whoever wants
 * it to be.
 */
export default function VerificationError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is what ties this to a server log line. Printed rather than
    // swallowed so a customer can quote it to us.
    console.error('Verification page failed', error);
  }, [error]);

  return (
    <article className="max-w-3xl space-y-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">We could not reach our records</h1>
        <p className="max-w-prose text-muted">
          Something on our side failed while looking this badge up. The fault is ours, and it says
          nothing whatever about the application whose mark you clicked — this page is not evidence
          that the badge is genuine, and it is not evidence that it is not. Only a page that loads
          answers that.
        </p>
      </header>

      <section className="space-y-3 rounded-xl border border-line p-5">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-accent px-4 py-2.5 font-medium text-on-accent"
        >
          Try again
        </button>
        {error.digest && (
          <p className="text-sm text-muted">
            If it keeps failing, quote this reference:{' '}
            <code className="break-all">{error.digest}</code>
          </p>
        )}
      </section>

      <footer className="border-t border-line pt-6 text-sm text-muted">
        <p>
          You can also <Link href="/verify">check the signed payload</Link> yourself against the key
          we publish — that path does not depend on this page, though it tells you only that a badge
          was issued, never whether it is still live.{' '}
          <Link href="/legal/ip-takedown">Report improper display</Link>.
        </p>
      </footer>
    </article>
  );
}
