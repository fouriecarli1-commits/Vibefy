import { NextResponse, type NextRequest } from 'next/server';
import { renderBadgeSvg, renderBadgeUnavailableSvg, type BadgeStatus } from '@vibefycode/badge';
import { whyTheDatabaseRefused } from '@/lib/connection-string';
import { lookUpBadgeVerification } from '@/lib/badge-verification';
import { writeAsService } from '@/lib/sql';

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

  // The embed snippet puts the customer's chosen size in the URL, so the served
  // artwork matches the space it will occupy. Clamped rather than trusted: this
  // is a public endpoint and the number only ever picks a layout.
  const requested = Number(request.nextUrl.searchParams.get('size'));
  const sizePx = Number.isFinite(requested)
    ? Math.min(Math.max(Math.round(requested), 64), 1024)
    : undefined;

  /*
   * Nothing on this path may fail to return a picture.
   *
   * The not-found branch below already decided this question, and wrote down
   * why: "an unknown badge id on someone's website should read as 'not
   * verified', not as a broken image they might ignore." That reasoning is
   * right, and it covered exactly one failure. `readAsAnon` throws when the
   * database will not answer — a wrong connection string, an exhausted pool, a
   * statement timeout — and none of it was caught, so Next returned a 500 with
   * an HTML body and the customer's page rendered the `alt` attribute. Words
   * where a trust mark used to be, which is the outcome that comment forbids,
   * arriving through the door it did not look at.
   *
   * Worse than it sounds: the owner cannot tell from a broken image whether we
   * revoked them or our database is down, and the first thing anybody assumes is
   * the former.
   *
   * Reported from a live embed before it was found by reading.
   */
  try {
    return await serveBadge(request, id, sizePx);
  } catch (error) {
    // Logged, because the whole point is that this state is ours to fix and the
    // customer cannot see it. A badge silently serving "unavailable" for a week
    // would be the same defect one layer further down.
    const detail = error instanceof Error ? error.message : String(error);
    // Where the message misleads, the explanation travels beside it rather
    // than replacing it. A tripped pooler breaker reads exactly like our own
    // bad password and is not one.
    const means = whyTheDatabaseRefused(detail);
    console.error('badge image could not be served', {
      publicId: id,
      error: detail,
      ...(means === null ? {} : { means }),
    });
    return new NextResponse(renderBadgeUnavailableSvg(sizePx), {
      // Not 404: the badge is not what is missing. Not 500 with an HTML body,
      // which is where this started.
      status: 503,
      headers: {
        'content-type': 'image/svg+xml; charset=utf-8',
        // The success and not-found paths cache for five minutes, which is what
        // makes a revocation land quickly. Caching a transient failure for the
        // same five minutes would pin one bad second across every embed of every
        // badge on every site.
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
        'content-security-policy':
          "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
        'x-content-type-options': 'nosniff',
      },
    });
  }
}

async function serveBadge(
  request: NextRequest,
  id: string,
  sizePx: number | undefined,
): Promise<NextResponse> {
  // Through `lookUpBadgeVerification`, which tries the direct connection and
  // then Supabase's own API with the public key. This route is the one that
  // renders on a customer's website, so it is the one whose failure the whole
  // internet sees — and the view it reads is published, so there is no reason
  // for a wrong connection string to be the end of it. The fallback logs
  // itself, loudly, every time.
  const { row: badge } = await lookUpBadgeVerification(id);

  if (!badge) {
    // Deliberately not a 404 image: an unknown badge id on someone's website
    // should read as "not verified", not as a broken image they might ignore.
    const svg = renderBadgeSvg({ status: 'revoked', ...(sizePx ? { sizePx } : {}) });
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
    ...(sizePx ? { sizePx } : {}),
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
      // The layout depends on the size in the query string, so caches must key on it.
      vary: 'Accept',
      'access-control-allow-origin': '*',
      'x-vibefycode-status': badge.status,
      'x-vibefycode-verify': verificationUrl,
      // The image is never a document; a hostile SVG served inline is a script.
      //
      // `img-src data:` is not a loosening of that. The seal is the supplied
      // artwork embedded as a data URI, and `default-src 'none'` forbade it —
      // so from the moment the badge stopped being drawn, every browser loaded
      // the document and then refused the picture inside it. An empty frame on
      // the customer's website, and nothing in any log to say why.
      //
      // Only `data:`. No remote origin can be reached from inside the badge,
      // which is the property that mattered.
      'content-security-policy':
        "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
      'x-content-type-options': 'nosniff',
    },
  });
}
