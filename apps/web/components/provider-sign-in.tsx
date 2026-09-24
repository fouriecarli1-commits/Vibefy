import { ProviderButton } from '@/components/provider-button';
import { declaredConsents } from '@/lib/consent';
import { enabledProviders } from '@/lib/providers-enabled';

/**
 * The providers, where the Supabase project has any turned on.
 *
 * Asked of Supabase rather than of an environment variable — see
 * `lib/providers-enabled.ts` for why that changed. The short version: a flag the
 * operator has to remember to set is a second thing that can be wrong, and when
 * it was wrong the page rendered nothing, which is indistinguishable from the
 * feature never having been built.
 *
 * Absent rather than broken is still the rule. A button that redirects to an
 * error teaches people the product is broken, and `pnpm providers` is how the
 * operator asks why it is not there and gets a reason rather than a blank space.
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
  const providers = await enabledProviders();
  if (providers.enabled.length === 0) return null;
  const accepted = mode === 'sign-up' ? await declaredConsents() : undefined;

  return (
    <div className="max-w-sm space-y-4">
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        <span className="text-sm text-muted">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      {providers.enabled.map((provider) => (
        <ProviderButton
          key={provider}
          provider={provider}
          mode={mode}
          next={next}
          accepted={accepted}
        />
      ))}
      {mode === 'sign-up' && (
        <p className="text-sm text-muted">
          {/* The same sentence the password form carries, because it is the
              sentence that makes the consent record true. A button that records
              acceptance without saying so records something that did not
              happen. */}
          Signing up with any of these records your acceptance of the{' '}
          <a href="/legal/terms-of-service">Terms of Service</a> and the{' '}
          <a href="/legal/privacy-policy">Privacy Policy</a>, with the version, the timestamp and a
          hash of the exact wording. Both are drafts pending legal review.
        </p>
      )}
    </div>
  );
}
