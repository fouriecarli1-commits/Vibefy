import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthForm } from '@/components/auth-form';
import { signInProblem } from '@/lib/sign-in-problem';
import { ProviderSignIn } from '@/components/provider-sign-in';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  // Never the parameter itself: anybody can send a link carrying any text.
  const problem = signInProblem(error);
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Sign in</h1>
      {problem && (
        <p role="alert" className="rounded-xl border border-line bg-surface-muted p-4 text-sm">
          {problem}
        </p>
      )}
      <AuthForm mode="sign-in" next={next} />
      <ProviderSignIn mode="sign-in" next={next} />
      <p className="text-sm text-muted">
        {/* Before the offer to create another account, because somebody who
            cannot get in does not want a second one — their organisation,
            their applications and their assessments are all attached to the
            address they are locked out of. */}
        <Link href="/forgot-password">Forgotten your password?</Link>
      </p>
      <p className="text-sm text-muted">
        No account yet? <Link href="/sign-up">Create one</Link>.
      </p>
    </div>
  );
}
