/**
 * What the accessibility scan promises, in a form a test can read.
 *
 * Split out of `a11y-scan.mts` because that file ends in a top-level `await`
 * and cannot be imported. The pieces here are the ones worth checking without
 * building and serving the whole app: which routes are covered by seeding
 * rather than by a literal, and the guard that says whether the thing at an
 * address is the page we meant to scan.
 */

import type { Client } from 'pg';
import { seedBadgedApp } from '../tests/setup/seed.ts';

/**
 * Routes scanned only after something is seeded for them.
 *
 * They cannot be literals in the page list because the URL does not exist until
 * a badge does. Named here so `tests/accessibility.test.ts` can count them as
 * covered — a route scanned by a mechanism no test knows about is a route that
 * silently stops being scanned, which is how the verification page came to be
 * missing in the first place.
 */
export const SEEDED_ROUTES: readonly string[] = ['/a/[slug]'];

/**
 * Words that must appear on a page, or the scan was not of the page it thinks.
 *
 * A green gate that is green because it scanned something else is the failure
 * this guards against, and the verification page makes it easy: a slug that
 * does not resolve renders the not-found page, which is itself carefully built
 * and accessible. It would pass, and prove nothing about the page a stranger
 * actually lands on.
 *
 * The directory has the same shape of risk. A database missing a migration
 * renders an error page with no heading, and the scan then reports two
 * violations about a page that was never the point — a failure that tells the
 * truth about what it saw and lies about the cause.
 */
export const MUST_CONTAIN: Record<string, string> = {
  '/directory': 'How this list is ordered',
};

/**
 * Whether the thing at this address is the page we meant to scan.
 *
 * Returns the complaint, or null when all is well. Exported so it can be shown
 * to bite: a guard nobody has watched fail is a guard nobody should trust, and
 * this one exists precisely because a passing scan of the wrong page looks
 * exactly like a passing scan of the right one.
 */
export async function scannedTheWrongPage(
  origin: string,
  page: string,
  required: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (!required) return null;

  let response: Response;
  let body: string;
  try {
    response = await fetchImpl(`${origin}${page}`);
    body = await response.text();
  } catch (error) {
    return `${page}: could not be fetched to check what it is (${error instanceof Error ? error.message : String(error)}).`;
  }

  if (response.ok && body.includes(required)) return null;
  return (
    `${page}: expected to find ${JSON.stringify(required)} on this page and did not ` +
    `(HTTP ${response.status}). The scan would have run against the wrong page.`
  );
}

/**
 * Seeds a badge and returns the verification page that now exists.
 *
 * It lives here rather than in the scan so a test can run it and check that
 * what comes back is the route `SEEDED_ROUTES` promises. The promise is easy to
 * break silently: change the slug column, or the page's path, and the scan goes
 * on seeding something while the coverage test goes on believing a route is
 * covered — each half correct, the page unscanned.
 *
 * The content guard is registered here too, for the same reason. A badge that
 * did not resolve renders the not-found page, which is deliberately accessible
 * and would sail through the scan having proved nothing.
 */
export async function seedVerificationPage(client: Client): Promise<string> {
  const { slug } = await seedBadgedApp(client, 'a11y-scan');
  const page = `/a/${slug}`;
  // The tick list only renders for a badge that resolved, so it is the right
  // thing to insist on: the not-found page does not carry it.
  MUST_CONTAIN[page] = 'What was checked';
  return page;
}

/** Whether a concrete URL is an instance of one of the seeded route patterns. */
export function matchesSeededRoute(page: string): boolean {
  return SEEDED_ROUTES.some((route) =>
    new RegExp(`^${route.replace(/\[[^\]]+\]/g, '[^/]+')}$`).test(page),
  );
}
