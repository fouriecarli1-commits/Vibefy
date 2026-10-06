/**
 * What a crawler is told exists, and what it is told to stay out of.
 *
 * Nothing told Google anything. There was no `robots.txt` — the live log shows
 * Googlebot getting a 404 for it — and no sitemap, on a product whose two
 * public surfaces are a directory and a verification page per customer. Those
 * are the pages a buyer searches for by name, and they are the pages nobody
 * links to from anywhere else.
 *
 * The lists are here rather than in the route files because `robots.ts` and
 * `sitemap.ts` have to agree: a path disallowed in one and offered in the other
 * is a contradiction a crawler resolves by ignoring us. One list, two readers.
 *
 * Nothing here decides whether a page may be indexed — the pages do that, in
 * their own `metadata.robots`. `/a/[slug]` is indexable only while its badge is
 * active, and the sitemap must apply the same rule, or we are offering a
 * crawler pages we have told it not to index.
 */

export interface SitemapEntry {
  readonly url: string;
  readonly lastModified?: Date;
}

/**
 * The public pages, written out rather than discovered.
 *
 * A route is public because somebody decided it is, not because it has no
 * `console` in its path. Adding a page is adding a line here, which is a
 * decision somebody makes once.
 */
export const PUBLIC_PATHS: readonly string[] = [
  '/',
  '/directory',
  '/how-it-works',
  '/methodology',
  '/services',
  '/services/remediation',
  '/glossary',
  '/trust-check',
  '/pre-flight',
  '/advertise',
  '/games',
  '/legal',
  '/verify',
];

/**
 * Prefixes no crawler is sent to, and the same list `robots.ts` disallows.
 *
 * `/badge` is here because a badge is an image a page embeds, not a page; a
 * crawler following it would record the mark without the sentence that
 * qualifies it, which is the one thing this product cannot allow. `/b` is
 * absent on purpose: a published builder profile is public and is listed from
 * the sitemap, by handle.
 */
export const PRIVATE_PREFIXES: readonly string[] = [
  '/admin',
  '/api',
  '/auth',
  '/badge',
  '/console',
  '/forgot-password',
  '/invite',
  '/review',
  '/sign-in',
  '/sign-up',
];

export function isPrivatePath(path: string): boolean {
  return PRIVATE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * The whole sitemap, from an origin and whatever the database could tell us.
 *
 * `discovered` is every path that is not a fixed page: the legal documents, the
 * trap articles, and the verification and builder pages that only a query
 * knows about. It is a parameter rather than a fetch so that this function is
 * the part a test can hold — the rules worth pinning down are which paths may
 * appear and what shape they come out in, and neither of those needs a
 * database.
 */
export function sitemapEntries(
  origin: string,
  discovered: readonly SitemapEntry[] = [],
): SitemapEntry[] {
  const base = origin.replace(/\/+$/, '');
  const seen = new Set<string>();
  const entries: SitemapEntry[] = [];

  const all: readonly SitemapEntry[] = [
    ...PUBLIC_PATHS.map((url): SitemapEntry => ({ url })),
    ...discovered,
  ];

  for (const entry of all) {
    // `discovered` comes from rows, and a row is the place a path nobody
    // intended can come from. The prefixes are checked against every entry
    // rather than trusted per source.
    if (isPrivatePath(entry.url)) continue;
    const url = entry.url.startsWith('http') ? entry.url : `${base}${entry.url}`;
    if (seen.has(url)) continue;
    seen.add(url);
    entries.push(entry.lastModified ? { url, lastModified: entry.lastModified } : { url });
  }

  return entries;
}
