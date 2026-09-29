/**
 * A badge that cannot be checked is not a broken image.
 *
 * `/badge/[file]` already decided this question once, correctly, and wrote the
 * reasoning down:
 *
 *     // Deliberately not a 404 image: an unknown badge id on someone's website
 *     // should read as "not verified", not as a broken image they might ignore.
 *
 * That policy covered exactly one failure — the badge id is not in the view.
 * Every other way the handler can fail returned nothing at all. `readAsAnon`
 * throws when the database will not answer, when `SUPABASE_DB_URL` is wrong or
 * missing, when the pool is exhausted, when a statement times out; the route
 * catches none of it, so Next returns a 500 with an HTML body, and an `<img>`
 * pointed at it renders its `alt` attribute.
 *
 * Which is the exact outcome the comment forbids, arriving through the door it
 * did not look at. It is also worse than it sounds: the customer sees words
 * where their trust mark used to be and has no way to tell whether we revoked
 * them or our database is down, and the first thing they will assume is the
 * former.
 *
 * Reported from a live embed: "die badge wys nie meer nie, daar is net woorde
 * wat wys."
 *
 * ## Why not simply reuse the revoked artwork
 *
 * Because it would be a lie in the one case that matters. "Revoked" is a
 * statement about the badge; "we could not reach our own database" is a
 * statement about us, and printing the first when the second is true tells a
 * visitor that a customer in good standing was struck off. The unavailable state
 * is deliberately neither: no seal, no mark, no colour, nothing that reads as
 * endorsement or as condemnation.
 *
 * ## Why it must not be cached
 *
 * The success and not-found paths cache for five minutes, which is right — that
 * window is what makes revocation land quickly. Caching a transient failure for
 * the same five minutes would pin one bad second across every embed of every
 * badge. This path is `no-store`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderBadgeUnavailableSvg, renderBadgeSvg } from '../packages/badge/src/render.ts';

/**
 * The parts of the request this route reads, and nothing else.
 *
 * `next/server` resolves from `apps/web`, not from the workspace root, and
 * dragging it in here would make a test about a failure path depend on the
 * framework's module layout. The route asks for a search parameter and four
 * headers; this is those.
 */
interface BadgeRoute {
  GET(
    request: unknown,
    context: { params: Promise<{ file: string }> },
  ): Promise<{ status: number; headers: Headers; text(): Promise<string> }>;
}

/**
 * The route, loaded through a specifier TypeScript does not follow.
 *
 * `apps/web` compiles with `moduleResolution: bundler` and the workspace root
 * with `nodenext`, so a literal import of a route file from here drags
 * `next/server` and the `@/` alias into a project that resolves neither — and
 * the root typecheck fails on a file `apps/web` already checks correctly. The
 * shape above is what this test uses and is asserted by using it.
 */
async function loadRoute(): Promise<BadgeRoute> {
  const here = '../apps/web/app/badge/[file]/route.ts';
  return (await import(/* @vite-ignore */ here)) as BadgeRoute;
}

function aRequestFor(url: string) {
  return {
    nextUrl: new URL(url),
    headers: new Headers({ 'user-agent': 'vitest' }),
  };
}

const previous = process.env.SUPABASE_DB_URL;

beforeAll(() => {
  // Nothing listens on port 1. The connection is refused immediately, which is
  // the fastest honest way to make the read fail.
  process.env.SUPABASE_DB_URL = 'postgresql://postgres@127.0.0.1:1/none';
});

afterAll(() => {
  if (previous === undefined) delete process.env.SUPABASE_DB_URL;
  else process.env.SUPABASE_DB_URL = previous;
});

describe('the image served when we cannot answer', () => {
  it('is an SVG, so the embed renders something rather than its alt text', () => {
    const svg = renderBadgeUnavailableSvg();
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('</svg>');
  });

  it('claims nothing, in either direction', () => {
    const svg = renderBadgeUnavailableSvg().toLowerCase();
    expect(svg).not.toMatch(/verified by/);
    expect(svg).not.toMatch(/revoked|suspended|expired/);
  });

  it('says what is actually true, in words a visitor can read', () => {
    const svg = renderBadgeUnavailableSvg();
    expect(svg).toMatch(/VibefyCode/);
    expect(svg).toMatch(/could not be checked|status unavailable/i);
  });

  it('is not the revoked artwork wearing a different name', () => {
    expect(renderBadgeUnavailableSvg()).not.toBe(renderBadgeSvg({ status: 'revoked' }));
    // And carries none of the seal artwork, which is what would make it read as
    // a judgement about the customer.
    expect(renderBadgeUnavailableSvg()).not.toContain('data:image');
  });

  it('carries an accessible name, like every other badge state', () => {
    const svg = renderBadgeUnavailableSvg();
    expect(svg).toContain('role="img"');
    expect(svg).toMatch(/aria-label="[^"]{20,}"/);
    expect(svg).toContain('<title>');
  });
});

describe('the route, when the database will not answer', () => {
  it('serves that image instead of failing', async () => {
    const { GET } = await loadRoute();

    const response = await GET(aRequestFor('https://vibefycode.com/badge/abc123.svg?size=128'), {
      params: Promise.resolve({ file: 'abc123.svg' }),
    });

    expect(response.headers.get('content-type')).toMatch(/image\/svg\+xml/);
    const body = await response.text();
    expect(body).toMatch(/^<svg/);
    expect(body).toMatch(/could not be checked|status unavailable/i);
  });

  it('does not cache the failure across every embed', async () => {
    const { GET } = await loadRoute();

    const response = await GET(aRequestFor('https://vibefycode.com/badge/abc123.svg'), {
      params: Promise.resolve({ file: 'abc123.svg' }),
    });
    expect(response.headers.get('cache-control')).toMatch(/no-store/);
  });

  it('answers 503 rather than 404, because the badge is not what is missing', async () => {
    const { GET } = await loadRoute();

    const response = await GET(aRequestFor('https://vibefycode.com/badge/abc123.svg'), {
      params: Promise.resolve({ file: 'abc123.svg' }),
    });
    expect(response.status).toBe(503);
  });
});
