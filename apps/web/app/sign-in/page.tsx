import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthForm } from '@/components/auth-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Sign in</h1>
      <AuthForm mode="sign-in" next={next} />
      <p className="text-sm text-muted">
        No account yet? <Link href="/sign-up">Create one</Link>.
      </p>
    </div>
  );
}
