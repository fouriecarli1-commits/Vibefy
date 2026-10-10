import { NextResponse, type NextRequest } from 'next/server';
import { renderBadgeSvg, renderBadgeUnavailableSvg, type BadgeStatus } from '@vibefycode/badge';
import { whyTheDatabaseRefused } from '@/lib/connection-string';
import { lookUpBadgeVerification } from '@/lib/badge-verification';
import { writeAsService } from '@/lib/sql';
import { originFrom } from '@/lib/verify-origin';

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

/**
 * The headers every badge response carries, whatever it is a picture of.
 *
 * There were three sets. The 503 and the 200 carried the content-security
 * policy, `nosniff` and the cross-origin header; the 404 served to an unknown
 * or revoked id carried none of the three. An SVG is a document a browser will
 * execute script from, which is what the policy and `nosniff` are for, so
 * having them on two paths out of three is having them nowhere in particular.
 *
 * It survived because the test for them reads this file rather than a
 * response: `expect(route).toContain("'x-content-type-options': 'nosniff'")`
 * is satisfied by any one of the three. One function now, and
 * `tests/the-headers-every-badge-carries.test.ts` asks each path what it
 * actually answered with.
 */
function badgeHeaders(cacheControl: string, extra: Record<string, string> = {}) {
  return {
    'content-type': 'image/svg+xml; charset=utf-8',
    'cache-control': cacheControl,
    'access-control-allow-origin': '*',
    /*
     * The image is never a document; a hostile SVG served inline is a script.
     *
     * `img-src data:` is not a loosening of that. The seal is the supplied
     * artwork embedded as a data URI, and `default-src 'none'` forbade it — so
     * from the moment the badge stopped being drawn, every browser loaded the
     * document and then refused the picture inside it. An empty frame on the
     * customer's website, and nothing in any log to say why.
     *
     * Only `data:`. No remote origin can be reached from inside the badge,
     * which is the property that mattered.
     */
    'content-security-policy':
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
    'x-content-type-options': 'nosniff',
    ...extra,
  };
}

/**
 * The origin of the page the badge is embedded on, from the referer.
 *
 * Named `originFrom` until 2026-10-10, which is also the name of the shared
 * helper in `@/lib/verify-origin` that turns a configured value into the
 * origin *we* are served from. Two different questions under one name, in the
 * one file that needs both — and the line below that builds the verification
 * URL read the environment variable raw rather than reaching for the shared
 * one, which is exactly the mistake a shadowed name invites.
 */
function embeddingOriginOf(request: NextRequest): string | null {
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

  /*
   * The embed snippet puts the customer's chosen size in the URL, so the
   * served artwork matches the space it will occupy. Clamped rather than
   * trusted: this is a public endpoint.
   *
   * The absent case has to be spelled out. `searchParams.get` answers `null`
   * when the parameter is not there, `Number(null)` is 0, and
   * `Number.isFinite(0)` is true — so a URL with no `size` came through the
   * branch meant for a size somebody chose and was clamped up to the floor of
   * 64. A garbage value took the `undefined` branch correctly, which is the
   * inversion: a missing parameter was treated as a choice and a nonsense one
   * as no choice.
   *
   * What that cost: `renderBadgeUnavailableSvg` is the only renderer that uses
   * this number, for the width and height of the frame shown when we cannot
   * answer. Every badge URL without `?size=` served that frame at 64 by 64
   * instead of full size — a small grey square where a badge should be, which
   * is exactly how "the badge is not showing" is described. `docs/DOEN.md`
   * sends him to `/badge/nonexistent-test-id.svg`, with no size parameter, as
   * the first test of a deployment.
   */
  const raw = request.nextUrl.searchParams.get('size')?.trim();
  const requested = raw ? Number(raw) : Number.NaN;
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
      // The success and not-found paths cache for five minutes, which is what
      // makes a revocation land quickly. Caching a transient failure for the
      // same five minutes would pin one bad second across every embed of every
      // badge on every site.
      headers: badgeHeaders('no-store'),
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
      headers: badgeHeaders('public, max-age=300'),
    });
  }

  /*
   * Through the shared resolver, which this route was the only caller not to
   * use.
   *
   * It read the two variables raw and fell back to the empty string, so the
   * two shapes `apps/web/lib/verify-origin.ts` exists to repair both reached
   * the badge: a bare `vibefycode.com` became `vibefycode.com/a/slug`, which
   * is a relative path wherever it is read; and the `.env.example` value
   * `http://localhost:3000/verify` became `/verify/a/slug`, which is a 404,
   * because the route is `/a/[slug]`. Both are written up in that file as
   * defects it fixes "for every caller", and this caller was building the URL
   * by hand ten lines from a local function with the same name as the shared
   * one.
   *
   * With neither variable set it now reads the request, so a deployment that
   * has configured nothing still produces the origin it is being served from
   * rather than an empty string.
   *
   * The pure `originFrom` rather than `resolveVerifyOrigin`, because this
   * route already has the request and the server wrapper reads `next/headers`
   * — which is the split that file describes: "so the decision can be tested
   * without a request, and without dragging Next's server-only modules into a
   * test project that has no business resolving them". The first attempt used
   * the wrapper and turned every success into a 503 under test.
   */
  const verificationUrl = `${originFrom(
    process.env.NEXT_PUBLIC_VERIFY_URL ?? process.env.NEXT_PUBLIC_SITE_URL,
    request.headers.get('x-forwarded-host') ?? request.headers.get('host'),
  )}/a/${badge.slug}`;

  const svg = renderBadgeSvg({
    status: badge.status,
    appName: badge.app_name,
    rubricVersion: badge.rubric_version,
    assessedOn: new Date(badge.assessed_at).toISOString().slice(0, 10),
    verificationUrl,
    ...(sizePx ? { sizePx } : {}),
  });

  const observed = embeddingOriginOf(request);
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
    /*
     * Five minutes. Long enough to be cheap, short enough that a revocation
     * reaches every embedded instance within minutes.
     *
     * `vary: 'Accept'` used to be here, under a comment saying the layout
     * depends on the size in the query string so caches must key on it. A
     * cache keys on the whole URL, query string included, without being asked;
     * `Accept` is a different header entirely and varying on it only fragments
     * the cache by browser. And the layout does not depend on the size any
     * more either — `renderBadgeSvg` stopped reading `sizePx` when the badge
     * started embedding the supplied artwork. A header whose comment names a
     * purpose it cannot serve, for a reason that is no longer true.
     */
    headers: badgeHeaders('public, max-age=300, must-revalidate', {
      'x-vibefycode-status': badge.status,
      'x-vibefycode-verify': verificationUrl,
    }),
  });
}
