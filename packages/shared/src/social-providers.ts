/**
 * The providers somebody may sign in with, and what each one is called.
 *
 * The ids are Supabase's own, because they are what `/auth/v1/settings` reports
 * and what `signInWithOAuth` accepts. Two of them are not what you would guess:
 * X is still `twitter` in GoTrue, and LinkedIn is `linkedin_oidc` — the older
 * `linkedin` id is deprecated and enabling it gets you a provider that answers
 * and then fails at the token exchange.
 *
 * Order is deliberate and fixed: the ones most people have, first. It is not
 * reordered by popularity or by anything we measure, because a sign-in page that
 * rearranges itself is a sign-in page people misclick.
 *
 * ## No logos, yet
 *
 * There are no brand marks here on purpose. Drawing eight of them from memory
 * produces eight subtly wrong logos, and several of these companies publish
 * licence terms about their marks — Apple's are specific enough that a
 * "Sign in with Apple" button drawn freehand is a breach rather than an
 * approximation. A product whose whole argument is that it does not redraw
 * somebody else's mark cannot open with eight redrawn marks on its front door.
 *
 * So: the provider's name, in a button of the same shape as the others, until
 * the real assets come from each provider's own kit. `docs/OPEN_ITEMS.md` says
 * what that needs.
 */
export const SOCIAL_PROVIDERS = [
  { id: 'google', label: 'Google' },
  { id: 'apple', label: 'Apple' },
  { id: 'github', label: 'GitHub' },
  { id: 'discord', label: 'Discord' },
  { id: 'twitter', label: 'X' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'linkedin_oidc', label: 'LinkedIn' },
  { id: 'spotify', label: 'Spotify' },
  { id: 'twitch', label: 'Twitch' },
] as const;

export type SocialProviderId = (typeof SOCIAL_PROVIDERS)[number]['id'];

export function providerLabel(id: SocialProviderId): string {
  const provider = SOCIAL_PROVIDERS.find((entry) => entry.id === id);
  // Refusing beats guessing: a provider with no label would render a button
  // saying "undefined", and the id is not a name anybody recognises.
  if (!provider) throw new Error(`No label is defined for the provider "${id}".`);
  return provider.label;
}
