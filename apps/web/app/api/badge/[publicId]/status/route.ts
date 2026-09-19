import { NextResponse, type NextRequest } from 'next/server';
import { badgeStatus, type BadgeRow } from '@vibefycode/badge';
import { readAsAnon } from '@/lib/sql';

/**
 * Is this badge live, and what does it cover.
 *
 * The sibling route beside this one returns the signed payload, which is what
 * somebody checking a badge cryptographically needs. This returns the four
 * facts a marketplace actually wants before it renders our mark beside a
 * listing: is it live, what was it measured against, when was that, and when
 * does it stop being current.
 *
 * Public, unauthenticated and CORS-open, because a verification scheme that
 * needs a relationship with the issuer to use is not much of a scheme. Cached
 * for five minutes, which is also the honest rate limit: an in-process counter
 * in a serverless function counts one instance's traffic and nothing else, and
 * calling that a rate limit would be describing a courtesy as a control.
 *
 * A badge that does not exist gets 404 with a sentence, not an empty object —
 * "no badge with this id" and "we have never assessed this application" are
 * different answers, and only the first one is ours to give.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ publicId: string }> },
) {
  const { publicId } = await params;

  const row = await readAsAnon(async (client) => {
    const { rows } = await client.query<BadgeRow>(
      `select public_id, slug, status, app_name, certified_origin,
              rubric_version, assessed_at, expires_at
         from public.badge_verification where public_id = $1`,
      [publicId],
    );
    return rows[0] ?? null;
  });

  const headers = {
    'access-control-allow-origin': '*',
    'cache-control': 'public, max-age=300',
  };

  if (!row) {
    return NextResponse.json(
      {
        error: 'No badge with that identifier has been issued by VibefyCode.',
        note: 'This says nothing about the application it may have been claimed for. We only answer about badges we issued.',
      },
      { status: 404, headers },
    );
  }

  const verifyOrigin = process.env.NEXT_PUBLIC_VERIFY_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? '';
  return NextResponse.json(badgeStatus(row, verifyOrigin), { headers });
}
