/**
 * The origin a badge is served from, as it will actually resolve.
 *
 * This existed as `NEXT_PUBLIC_VERIFY_URL ?? NEXT_PUBLIC_SITE_URL ??
 * 'https://verify.vibefycode.example'`, and on a deployment where neither
 * variable was set the console handed out an embed snippet pointing at a domain
 * that does not exist. The customer's page would have shown a broken image, and
 * every part of that failure looks like their mistake rather than ours.
 *
 * The console already knows the answer: it is being served from the origin the
 * badge is served from. So it reads the request rather than requiring somebody
 * to have configured a variable whose absence is silent.
 *
 * The environment variables still win, because a deployment that serves the
 * console and the badges from different hostnames is a thing somebody may want,
 * and only they can say so.
 *
 * Split across two files so the decision can be tested without a request, and
 * without dragging Next's server-only modules into a test project that has no
 * business resolving them. Reading headers and choosing an origin are different
 * jobs; only the second one has rules worth pinning down.
 */
function schemeFor(host: string): 'http' | 'https' {
  // Localhost is the one place http is right, and getting it wrong there means
  // the snippet is untestable on the machine it was written on.
  return host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
}

/**
 * An origin, from whatever a person actually typed into the variable.
 *
 * Two shapes get written there by anybody reading the name as "the site's
 * address", and both used to be accepted unchanged:
 *
 *   · **A bare host** — `vibefycode.com`. Every caller builds
 *     `${origin}/a/${slug}`, so that produced `vibefycode.com/a/abc`, which a
 *     browser reads as a *relative* path: resolved against whatever page it
 *     appears on, and in an embed snippet on a customer's website, against
 *     *their* domain. `new URL()` on it throws outright.
 *   · **A host with a path** — and `.env.example` shipped
 *     `NEXT_PUBLIC_VERIFY_URL=http://localhost:3000/verify`, which made every
 *     badge URL `/verify/a/${slug}`. The route is `/a/[slug]`. Every badge
 *     anybody clicked was a 404.
 *
 * The scheme is not guessed: it is the same rule this file already applies to
 * the request host. The path, query and fragment are dropped because the
 * function returns an origin and every caller appends to it — a prefix was never
 * supported by any route.
 *
 * An unparseable value falls through rather than being used. The request host is
 * true by construction, and preferring a typo to a fact is how the placeholder
 * domain reached a customer's website the first time.
 */
function configuredOrigin(configured: string | undefined): string | null {
  const declared = configured?.trim();
  if (!declared) return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(declared)
    ? declared
    : `${schemeFor(declared)}://${declared}`;

  try {
    const url = new URL(withScheme);
    if (!url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function originFrom(configured: string | undefined, host: string | null): string {
  const declared = configuredOrigin(configured);
  if (declared) return declared;

  if (host) {
    return `${schemeFor(host)}://${host}`;
  }

  // Nothing left to infer from. The snippet would be wrong either way, so it is
  // better for it to be obviously wrong than plausibly wrong.
  return 'https://verify.vibefycode.example';
}

/** Whether we are about to hand somebody a snippet that cannot work. */
export function isPlaceholderOrigin(origin: string): boolean {
  return origin.includes('vibefycode.example');
}
