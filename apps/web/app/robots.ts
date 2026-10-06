import type { MetadataRoute } from 'next';
import { PRIVATE_PREFIXES } from '@/lib/sitemap-entries';
import { resolveVerifyOrigin } from '@/lib/verify-origin.server';

/**
 * `robots.txt`, which did not exist.
 *
 * Googlebot was getting a 404 for it on the live site. That is not fatal — a
 * missing file reads as "crawl everything" — and "crawl everything" is wrong
 * here: the console, the review queue and the admin pages are all behind a
 * sign-in and all cost a request to find that out.
 *
 * The disallow list is the one in `sitemap-entries.ts`, so a path cannot be
 * forbidden here and offered there.
 */
export const dynamic = 'force-dynamic';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await resolveVerifyOrigin();
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: PRIVATE_PREFIXES.map((path) => `${path}/`) }],
    sitemap: `${origin}/sitemap.xml`,
  };
}
