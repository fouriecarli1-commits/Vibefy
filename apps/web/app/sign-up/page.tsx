import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthForm } from '@/components/auth-form';
import { consentPayload } from '@/lib/legal';

export const metadata: Metadata = { title: 'Create an account' };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Create an account</h1>
      <p className="max-w-prose text-muted">
        You get a personal workspace immediately. Submitting an app for assessment requires
        verifying that you are entitled to authorise testing of it — that step comes in M1.
      </p>
      <AuthForm mode="sign-up" next={next} acceptedDocuments={consentPayload()} />
      <p className="text-sm text-muted">
        Already have one? <Link href="/sign-in">Sign in</Link>.
      </p>
    </div>
  );
}
