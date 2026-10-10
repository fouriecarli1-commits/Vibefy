import { NextResponse, type NextRequest } from 'next/server';
import { liveBadgeList, type BadgeRow } from '@vibefycode/badge';
import { readAsAnon } from '@/lib/sql';
import { verifyOriginForRequest } from '@/lib/verify-origin';

/**
 * Every badge whose owner chose to be listed, in one document.
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
 * It is not every live badge, and the first version of it was. A customer may
 * opt out of the public directory and stay certified — the independence policy
 * promises it in those words — and a machine-readable document of every badged
 * origin republished, in the most reusable form available, exactly what they
 * asked us not to publish. The rule now lives in `public.listed_badges`, where
 * it can be tested rather than remembered.
 *
 * Cached for an hour. A badge suspended in that hour still reads as live in a
 * stale copy, which is why the document says in its own body that anything
 * making a decision that matters should ask about the one badge it cares about.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const rows = await readAsAnon(async (client) => {
    const { rows: found } = await client.query<BadgeRow>(
      `select public_id, slug, status, app_name, certified_origin,
              rubric_version, assessed_at, expires_at
         from public.listed_badges
        order by public_id`,
    );
    return found;
  });

  // Through the shared resolver, like the two single-badge routes. This one
  // had no request parameter at all, which is the small thing that made
  // reading the environment raw look like the only option: one document,
  // every live badge, every `verificationPage` in it relative.
  const verifyOrigin = verifyOriginForRequest(request);

  return NextResponse.json(liveBadgeList(rows, verifyOrigin), {
    headers: {
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=3600',
    },
  });
}
