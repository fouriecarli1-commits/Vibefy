import { GoogleButton } from '@/components/google-button';
import { declaredConsents } from '@/lib/consent';

/**
 * The providers, where the operator has configured any.
 *
 * Read on the server so the decision is made once, in the environment that
 * knows, rather than shipped to the browser as a flag somebody could flip. It
 * is absent rather than broken when Google is not set up: the client id, the
 * secret and a redirect URI on a real domain are all operator work, and this
 * product does not have a domain yet.
 *
 * The divider says "or", not "or continue with" — there is nothing to continue
 * from. Somebody arriving here has not started anything yet.
 */
export async function ProviderSignIn({
  mode,
  next,
}: {
  mode: 'sign-in' | 'sign-up';
  next?: string | undefined;
}) {
  if (process.env.NEXT_PUBLIC_GOOGLE_SIGN_IN !== 'on') return null;
  const accepted = mode === 'sign-up' ? await declaredConsents() : undefined;

  return (
    <div className="max-w-sm space-y-4">
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        <span className="text-sm text-muted">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <GoogleButton mode={mode} next={next} accepted={accepted} />
      {mode === 'sign-up' && (
        <p className="text-sm text-muted">
          {/* The same sentence the password form carries, because it is the
              sentence that makes the consent record true. A button that records
              acceptance without saying so records something that did not
              happen. */}
          Signing up with Google records your acceptance of the{' '}
          <a href="/legal/terms-of-service">Terms of Service</a> and the{' '}
          <a href="/legal/privacy-policy">Privacy Policy</a>, with the version, the timestamp and a
          hash of the exact wording. Both are drafts pending legal review.
        </p>
      )}
    </div>
  );
}
