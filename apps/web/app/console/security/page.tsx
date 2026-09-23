import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MfaPanel } from '@/components/mfa-panel';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Sign-in security', robots: { index: false } };

/**
 * The account's own security, as opposed to the applications we assess.
 *
 * A second step is optional and stays optional. Requiring it of a solo builder
 * who is trying a free assessment would cost us the customer and buy them
 * nothing; the accounts worth protecting this way are the ones that can issue
 * a badge, invite a colleague or see a client's findings, and the people who
 * hold those know why. What we owe everybody is that the option is here,
 * standard, and that turning it on cannot quietly lock them out.
 */
export default async function SecurityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/console/security');

  return (
    <div className="max-w-2xl space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Sign-in security</h1>
        <p className="text-muted">
          Signed in as {user.email}. A second step means a password on its own is not enough to
          reach your account — so a password that leaks somewhere else does not become a way in
          here.
        </p>
      </div>
      <MfaPanel />
    </div>
  );
}
