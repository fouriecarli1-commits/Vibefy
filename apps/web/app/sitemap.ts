import type { MetadataRoute } from 'next';
import { TRAP_ARTICLES } from '@vibefycode/trustcheck';
import { listLegalDocuments } from '@/lib/legal';
import { sitemapEntries, type SitemapEntry } from '@/lib/sitemap-entries';
import { readAsAnon } from '@/lib/sql';
import { resolveVerifyOrigin } from '@/lib/verify-origin.server';

/**
 * The sitemap, which did not exist either.
 *
 * It matters more here than on most sites. The two surfaces this product is
 * found through are the directory and one verification page per customer, and
 * a verification page is linked from exactly one place — a badge in somebody
 * else's footer, which is an image. Nothing crawlable points at it.
 *
 * The fixed pages come from a list. The rest is a query, and the query is the
 * part that can fail.
 */
export const dynamic = 'force-dynamic';

/**
 * The pages only the database knows about.
 *
 * Returns what it has rather than throwing: a sitemap missing its dynamic half
 * is a worse sitemap, and a sitemap that 500s is none at all. The failure is
 * logged because it is ours and nobody else can see it — this runs for a
 * crawler, so a silent half-sitemap would be invisible until somebody wondered
 * why the verification pages never appeared in search.
 */
async function fromTheDatabase(): Promise<SitemapEntry[]> {
  try {
    return await readAsAnon(async (client) => {
      // The same rule `/a/[slug]` applies to itself: it sets
      // `robots: { index: badge.status === 'active' }`, so offering a crawler
      // any other badge would be offering a page we have told it not to index.
      const verification = await client.query<{ slug: string; assessed_at: string }>(
        `select slug, assessed_at from public.badge_verification where status = 'active'`,
      );
      // The view already answers only for a published profile whose badge is
      // live; one row per application, so the handles repeat.
      const builders = await client.query<{ handle: string }>(
        `select distinct handle from public.builder_profile_public`,
      );
      return [
        ...verification.rows.map((row) => ({
          url: `/a/${row.slug}`,
          lastModified: new Date(row.assessed_at),
        })),
        ...builders.rows.map((row) => ({ url: `/b/${row.handle}` })),
      ];
    });
  } catch (error) {
    console.error('sitemap could not read the published pages', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await resolveVerifyOrigin();
  return sitemapEntries(origin, [
    ...listLegalDocuments().map((document) => ({ url: `/legal/${document.slug}` })),
    ...TRAP_ARTICLES.map((article) => ({ url: `/trust-check/traps/${article.slug}` })),
    ...(await fromTheDatabase()),
  ]);
}
