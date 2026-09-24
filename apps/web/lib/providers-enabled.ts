import { SOCIAL_PROVIDERS, type SocialProviderId } from '@vibefycode/shared';

/**
 * Which sign-in providers this Supabase project actually has turned on.
 *
 * Asked of Supabase rather than of an environment variable, and that is the
 * whole point of the file.
 *
 * The first version hid the Google button behind `NEXT_PUBLIC_GOOGLE_SIGN_IN=on`.
 * The reasoning was sound — a button that is always there and always fails
 * teaches people the product is broken — and the result was the failure this
 * codebase spends its time removing: the page rendered nothing, and nothing
 * distinguishes "not configured yet" from "never built". Anré asked twice where
 * the Google sign-in was.
 *
 * GoTrue publishes what it has: `GET /auth/v1/settings` returns an `external`
 * object with a boolean per provider. So the source of truth is the thing that
 * actually decides whether a button can work, each button appears the moment its
 * provider is enabled in the dashboard, and there is no second switch to
 * remember for any of the nine.
 *
 * A failed request offers nothing, which is the same answer as a project with no
 * providers on. That is deliberate rather than overlooked: the alternative is a
 * button that redirects to an error, and `pnpm providers` asks the question
 * directly and gets the reason.
 */
export interface EnabledProviders {
  /** In `SOCIAL_PROVIDERS` order, which is fixed so the page does not reshuffle. */
  readonly enabled: readonly SocialProviderId[];
  /** Set when the question could not be asked at all, with the reason. */
  readonly unavailable: string | null;
}

export async function enabledProviders(): Promise<EnabledProviders> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return {
      enabled: [],
      unavailable: 'NEXT_PUBLIC_SUPABASE_URL or the anon key is not set.',
    };
  }

  try {
    /*
     * `next` is Next.js's own addition to `RequestInit`, and it is declared here
     * rather than suppressed: the root typecheck compiles this file without the
     * Next type augmentation loaded, and `@ts-expect-error` would hide any other
     * mistake in the same call.
     *
     * Five minutes. Enabling a provider is something somebody does once, and a
     * sign-in page that asks on every render is slower for everybody so that one
     * operator sees a change a little sooner.
     */
    const init: RequestInit & { next?: { revalidate: number } } = {
      headers: { apikey: key },
      next: { revalidate: 300 },
    };
    const response = await fetch(`${url.replace(/\/+$/, '')}/auth/v1/settings`, init);
    if (!response.ok) {
      return {
        enabled: [],
        unavailable: `Supabase answered ${response.status} for /auth/v1/settings.`,
      };
    }
    const settings = (await response.json()) as { external?: Record<string, unknown> };
    const external = settings.external ?? {};
    // `=== true`, because a field that is absent is not a field that is true and
    // a provider list that ever answers "yes" as a string would otherwise render
    // a button that cannot work.
    return {
      enabled: SOCIAL_PROVIDERS.filter((provider) => external[provider.id] === true).map(
        (provider) => provider.id,
      ),
      unavailable: null,
    };
  } catch (error) {
    return {
      enabled: [],
      unavailable: `Could not reach Supabase: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
