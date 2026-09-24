import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AcceptForm } from '@/components/accept-form';
import { missingConsents } from '@/lib/consent';
import { consentPayload } from '@/lib/legal';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Before you continue', robots: { index: false } };

/**
 * The acceptance an account cannot exist without.
 *
 * Reached from the auth callback when the signed-in account has no current
 * acceptance on record — which, before this existed, was every account created
 * by a provider button on the sign-in page. Signing in with a provider creates
 * an account when there is not one already, and only the sign-up page passes the
 * document versions along, so those accounts reached the console with nothing
 * recording that anybody had agreed to anything.
 *
 * It is a wall rather than a banner. A notice somebody can dismiss produces a
 * consent record for the people who happened to click it, which is worse than
 * none: it looks like a rule and is a sample.
 */
export default async function AcceptPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { next } = await searchParams;
  // Resolved against our own origin only, exactly as the callback does. An open
  // redirect on a page people arrive at mid-sign-in is how phishing gets a
  // foothold.
  const destination = next?.startsWith('/') && !next.startsWith('//') ? next : '/console';

  // Somebody who has already accepted has no business being held here — they can
  // reach this address by typing it, and a page that refuses to let them past
  // would be a wall with nothing behind it.
  if ((await missingConsents()).length === 0) redirect(destination);

  return (
    <div className="max-w-xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Before you continue</h1>
        <p className="text-muted">
          You are signed in as {user.email}. Your account was created through a sign-in provider,
          which skips the step where we record what you agreed to — so this is that step. It is
          asked once.
        </p>
      </div>

      <ul className="space-y-3">
        {consentPayload().map((entry) => (
          <li key={entry.documentType} className="rounded-xl border border-line p-5">
            <a
              href={`/legal/${entry.documentType.replace(/_/g, '-')}`}
              className="font-medium"
              target="_blank"
              rel="noopener"
            >
              {entry.documentType === 'terms_of_service' ? 'Terms of Service' : 'Privacy Policy'}
            </a>
            <p className="mt-1 text-sm text-muted">
              Version {entry.version}. What we record is this version and a hash of its exact
              wording, so you can prove later what you agreed to rather than taking our word for it.
            </p>
          </li>
        ))}
      </ul>

      <AcceptForm next={destination} />

      <p className="text-sm text-muted">
        Both documents are drafts pending legal review, and the page says so wherever they appear.
      </p>
    </div>
  );
}
