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
export function originFrom(configured: string | undefined, host: string | null): string {
  if (configured) return configured.replace(/\/+$/, '');

  if (host) {
    // Localhost is the one place http is right, and getting it wrong there
    // means the snippet is untestable on the machine it was written on.
    const protocol =
      host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
    return `${protocol}://${host}`;
  }

  // Nothing left to infer from. The snippet would be wrong either way, so it is
  // better for it to be obviously wrong than plausibly wrong.
  return 'https://verify.vibefycode.example';
}

/** Whether we are about to hand somebody a snippet that cannot work. */
export function isPlaceholderOrigin(origin: string): boolean {
  return origin.includes('vibefycode.example');
}
