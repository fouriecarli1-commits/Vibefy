import { NextResponse, type NextRequest } from 'next/server';
import { renderBadgeSvg, type BadgeStatus } from '@vibefy/badge';
import { readAsAnon, writeAsService } from '@/lib/sql';

/**
 * The badge image.
 *
 * Rendered here, on every load, rather than handed out as a file. That is the
 * entire revocation mechanism: a customer cannot keep displaying a mark that
 * says "verified" after we have suspended it, because they never had a copy.
 *
 * Two other things happen on this path:
 *
 *   · The cache window is five minutes, so a revocation reaches every embedded
 *     instance within minutes rather than whenever a CDN feels like it.
 *   · The requesting origin is compared against the one this badge is licensed
 *     for. A mismatch is recorded — that is how a copied badge is caught, and it
 *     is the only reason this endpoint looks at a referrer at all.
 */
export const dynamic = 'force-dynamic';

function originFrom(request: NextRequest): string | null {
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  }
  return request.headers.get('origin');
}

export async function GET(
  request: NextRequest,
  // The segment is `{id}.svg` rather than a bare id, so the URL a customer
  // embeds ends in .svg and reads as an image everywhere it appears.
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  if (!file.endsWith('.svg')) {
    return NextResponse.json({ error: 'Badges are served as .svg' }, { status: 404 });
  }
  const id = file.slice(0, -4);

  const badge = await readAsAnon(async (client) => {
    const { rows } = await client.query<{
      status: BadgeStatus;
      slug: string;
      app_name: string;
      rubric_version: string;
      assessed_at: string;
      certified_origin: string;
    }>(
      `select status, slug, app_name, rubric_version, assessed_at, certified_origin
         from public.badge_verification where public_id = $1`,
      [id],
    );
    return rows[0] ?? null;
  });

  if (!badge) {
    // Deliberately not a 404 image: an unknown badge id on someone's website
    // should read as "not verified", not as a broken image they might ignore.
    const svg = renderBadgeSvg({ status: 'revoked' });
    return new NextResponse(svg, {
      status: 404,
      headers: {
        'content-type': 'image/svg+xml; charset=utf-8',
        'cache-control': 'public, max-age=300',
      },
    });
  }

  const siteUrl = process.env.NEXT_PUBLIC_VERIFY_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? '';
  const verificationUrl = `${siteUrl.replace(/\/+$/, '')}/a/${badge.slug}`;

  const svg = renderBadgeSvg({
    status: badge.status,
    appName: badge.app_name,
    rubricVersion: badge.rubric_version,
    assessedOn: new Date(badge.assessed_at).toISOString().slice(0, 10),
    verificationUrl,
  });

  const observed = originFrom(request);
  if (observed) {
    const mismatch = observed !== badge.certified_origin;
    // Fire and forget: telemetry must never delay or fail the image.
    void writeAsService(async (client) => {
      await client.query(
        `insert into public.badge_events (badge_id, organisation_id, event_type, observed_origin, ip, user_agent)
         select b.id, b.organisation_id, $2::text::public.badge_event_type, $3, $4, $5
           from public.badges b
          where b.public_id = $1
            and not exists (
              -- One event per badge, per origin, per hour. Telemetry that grows
              -- with pageviews is a bill, not a signal.
              select 1 from public.badge_events e
               where e.badge_id = b.id
                 and e.observed_origin is not distinct from $3
                 and e.event_type = $2::text::public.badge_event_type
                 and e.occurred_at > now() - interval '1 hour'
            )`,
        [
          id,
          mismatch ? 'origin_mismatch' : 'embed_observed',
          observed,
          request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
          request.headers.get('user-agent'),
        ],
      );
    }).catch(() => undefined);
  }

  return new NextResponse(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      // Five minutes. Long enough to be cheap, short enough that a revocation
      // reaches every embedded instance within minutes.
      'cache-control': 'public, max-age=300, must-revalidate',
      'access-control-allow-origin': '*',
      'x-vibefy-status': badge.status,
      'x-vibefy-verify': verificationUrl,
      // The image is never a document; a hostile SVG served inline is a script.
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'x-content-type-options': 'nosniff',
    },
  });
}
