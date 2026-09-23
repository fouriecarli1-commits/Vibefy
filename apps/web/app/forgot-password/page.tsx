import type { Metadata } from 'next';
import Link from 'next/link';
import { ForgotPasswordForm } from '@/components/forgot-password-form';

export const metadata: Metadata = { title: 'Reset your password' };

/**
 * The way back in.
 *
 * There was none. Sign-in offered a password field and a link to create a
 * second account, which is not a recovery route — it is a suggestion that you
 * abandon the organisation, the applications and the assessments attached to
 * the address you cannot get into. The first person this locked out was the
 * owner of this product.
 */
export default function ForgotPasswordPage() {
  return (
    <div className="max-w-sm space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Reset your password</h1>
        <p className="text-muted">
          Give us the address you signed up with and we will email you a link that lets you set a
          new password. The link expires, and using it signs you in.
        </p>
      </div>
      <ForgotPasswordForm />
      <p className="text-sm text-muted">
        Remembered it? <Link href="/sign-in">Sign in</Link>.
      </p>
    </div>
  );
}
