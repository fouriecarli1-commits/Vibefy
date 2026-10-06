/**
 * What a crawler is told exists.
 *
 * Nothing told it anything. The live log showed Googlebot taking a 404 for
 * `/robots.txt`, and there was no sitemap at all — on a product whose two
 * public surfaces are a directory and one verification page per customer, and
 * where a verification page is linked from exactly one place: a badge in
 * somebody else's footer, which is an image. Nothing crawlable points at it.
 *
 * Three rules are worth holding, and none of them needs a database.
 *
 *   · Nothing behind a sign-in is offered. The console, the review queue and
 *     the admin pages all cost a request to discover they are private.
 *   · A path forbidden in `robots.txt` is not offered in the sitemap. The two
 *     files read one list for exactly this reason; a crawler given a
 *     contradiction resolves it by ignoring us.
 *   · The database half can fail without taking the rest. A sitemap missing
 *     its dynamic half is worse; a sitemap that throws is none at all.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PRIVATE_PREFIXES,
  PUBLIC_PATHS,
  isPrivatePath,
  sitemapEntries,
} from '../apps/web/lib/sitemap-entries.ts';

const ORIGIN = 'https://vibefycode.com';

describe('the pages a crawler is sent to', () => {
  it('names none of the ones behind a sign-in', () => {
    for (const entry of sitemapEntries(ORIGIN)) {
      expect(isPrivatePath(entry.url.slice(ORIGIN.length)), entry.url).toBe(false);
    }
  });

  it('offers nothing robots.txt forbids, whatever a row says', () => {
    // `discovered` comes from query results, which is where a path nobody
    // intended arrives from.
    const entries = sitemapEntries(ORIGIN, [
      { url: '/console/billing' },
      { url: '/admin/costs' },
      { url: '/a/kettle' },
    ]);
    expect(entries.map((entry) => entry.url)).toContain(`${ORIGIN}/a/kettle`);
    expect(entries.map((entry) => entry.url)).not.toContain(`${ORIGIN}/console/billing`);
    expect(entries.map((entry) => entry.url)).not.toContain(`${ORIGIN}/admin/costs`);
  });

  it('does not forbid a prefix it also publishes', () => {
    for (const path of PUBLIC_PATHS) {
      expect(isPrivatePath(path), path).toBe(false);
    }
  });

  it('treats a prefix as a path segment rather than a string', () => {
    // `/reviewers-guide` is not `/review`. A `startsWith` on the bare prefix
    // would hide a page that only shares its first letters.
    expect(isPrivatePath('/review')).toBe(true);
    expect(isPrivatePath('/review/badges')).toBe(true);
    expect(isPrivatePath('/reviewers-guide')).toBe(false);
  });

  it('still lists the fixed pages when the database said nothing', () => {
    // The route logs that failure and returns an empty array. The sitemap it
    // produces has to still be a sitemap.
    const entries = sitemapEntries(ORIGIN, []);
    expect(entries.length).toBe(PUBLIC_PATHS.length);
    expect(entries.map((entry) => entry.url)).toContain(`${ORIGIN}/directory`);
  });

  it('writes absolute addresses, and each one once', () => {
    const entries = sitemapEntries(ORIGIN, [{ url: '/directory' }, { url: '/a/kettle' }]);
    for (const entry of entries) expect(entry.url.startsWith(`${ORIGIN}/`)).toBe(true);
    expect(new Set(entries.map((entry) => entry.url)).size).toBe(entries.length);
  });

  it('does not double the slash when the origin carries one', () => {
    const entries = sitemapEntries('https://vibefycode.com/', [{ url: '/directory' }]);
    expect(entries.map((entry) => entry.url)).toContain('https://vibefycode.com/directory');
  });

  it('names only pages that exist', () => {
    // A sitemap is a list of promises. A renamed or removed route leaves a 404
    // in it, and the list is hand-written precisely so that adding a page is a
    // decision — which means it can also go stale.
    for (const path of PUBLIC_PATHS) {
      const file = join(process.cwd(), 'apps/web/app', path === '/' ? '' : path, 'page.tsx');
      expect(existsSync(file), `${path} is in the sitemap and has no page`).toBe(true);
    }
  });

  it('keeps the badge image out of it', () => {
    // A crawler following a badge records the mark without the sentence that
    // qualifies it, which is the one thing this product cannot allow.
    expect(PRIVATE_PREFIXES).toContain('/badge');
  });
});
