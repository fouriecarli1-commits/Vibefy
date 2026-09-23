import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { NewPasswordForm } from '@/components/new-password-form';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Set a new password', robots: { index: false } };

/**
 * Setting the new password, after the link in the email has been followed.
 *
 * Reached only with a session, because that is what following the link
 * produces. Somebody who opens this address directly has proved nothing and is
 * sent to ask for a link, rather than shown a form that cannot work — a form
 * that fails on submit teaches the reader that the product is broken, when in
 * fact they are simply in the wrong place.
 */
export default async function NewPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/forgot-password');

  return (
    <div className="max-w-sm space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Set a new password</h1>
        <p className="text-muted">
          You are signed in as {user.email}. Choose a new password and it takes effect immediately.
        </p>
      </div>
      <NewPasswordForm />
    </div>
  );
}
