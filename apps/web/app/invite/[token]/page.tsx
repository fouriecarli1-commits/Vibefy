import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { createClient } from '@/lib/supabase/server';
import { acceptInvitation } from '@/app/console/workspace/actions';

export const metadata: Metadata = { title: 'Invitation' };

/**
 * Accepting an invitation.
 *
 * The page shows nothing about the workspace before the invitation is accepted —
 * not its name, not its size. A link that leaks who else uses VibefyCode to anyone
 * it is forwarded to is a link that leaks a customer list.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=/invite/${token}`);

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">You have been invited to a workspace</h1>
      <p className="text-muted">
        You are signed in as {user.email}. An invitation only works for the address it was sent to —
        if this one was sent to a different address, sign in as that address instead.
      </p>
      <div className="rounded-xl border border-line p-5">
        <ActionForm action={acceptInvitation} submitLabel="Accept invitation">
          <input type="hidden" name="token" value={token} />
        </ActionForm>
      </div>
      <p className="text-sm text-muted">
        Once you accept, everyone in the workspace can see that you are a member.{' '}
        <Link href="/legal/privacy-policy">What we hold about you</Link>.
      </p>
    </div>
  );
}
