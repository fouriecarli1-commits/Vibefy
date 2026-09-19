import { NextResponse } from 'next/server';
import { liveBadgeList, type BadgeRow } from '@vibefycode/badge';
import { readAsAnon } from '@/lib/sql';

/**
 * Every badge that is live, in one document.
 *
 * This exists so that nobody has to tell us what they are looking at. A browser
 * extension that asks our server "does this site have a badge" is an extension
 * that reports every page its user visits to us, whatever it promises in its
 * listing. Downloading this once an hour and checking locally does the same job
 * and cannot leak anything, which is why there is no per-domain lookup here to
 * be convenient instead.
 *
 * It is also the answer for a marketplace with a lot of listings: one request
 * rather than ten thousand.
 *
 * Cached for an hour. A badge suspended in that hour still reads as live in a
 * stale copy, which is why the document says in its own body that anything
 * making a decision that matters should ask about the one badge it cares about.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const rows = await readAsAnon(async (client) => {
    const { rows: found } = await client.query<BadgeRow>(
      `select public_id, slug, status, app_name, certified_origin,
              rubric_version, assessed_at, expires_at
         from public.badge_verification
        where status = 'active'
        order by public_id`,
    );
    return found;
  });

  const verifyOrigin = process.env.NEXT_PUBLIC_VERIFY_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? '';

  return NextResponse.json(liveBadgeList(rows, verifyOrigin), {
    headers: {
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=3600',
    },
  });
}
