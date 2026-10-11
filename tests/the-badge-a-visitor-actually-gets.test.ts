/**
 * The whole chain, once, against a real row.
 *
 * Every link in the badge path has a test. The view has one, the column list
 * has one, the headers have one, the size has one, the renderer has several,
 * and the fallback to Supabase's API has one. The chain does not, and the chain
 * is what failed: for a week every badge on every customer's site rendered
 * grey, and the cause was blamed on the content-security policy and then on the
 * connection string before anybody looked at the snippet.
 *
 * What a chain test adds over the parts is the answer to the question nobody
 * could answer that week — is our side serving a badge at all? One run, one
 * seeded row, the real route handler, and the bytes a visitor's browser would
 * receive.
 *
 * It points `SUPABASE_DB_URL` at the test database, which is what the route
 * reads through `readAsAnon`, and sets `PGUSER` because the socket DSN names no
 * user and `pg` would otherwise connect as whoever is running the suite.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connect } from './setup/client.ts';
import { seedBadgedApp } from './setup/seed.ts';

interface BadgeRoute {
  GET: (
    request: unknown,
    context: { params: Promise<{ file: string }> },
  ) => Promise<{
    status: number;
    text: () => Promise<string>;
    headers: { get: (name: string) => string | null };
  }>;
}

let db: Client;
let publicId: string;
let slug: string;
let appName: string;

const before = {
  dsn: process.env.SUPABASE_DB_URL,
  user: process.env.PGUSER,
  verify: process.env.NEXT_PUBLIC_VERIFY_URL,
  site: process.env.NEXT_PUBLIC_SITE_URL,
};

beforeAll(async () => {
  db = await connect();
  const seeded = await seedBadgedApp(db, `chain-${Date.now()}`);
  slug = seeded.slug;
  const { rows } = await db.query<{ public_id: string; app_name: string }>(
    `select b.public_id, a.name as app_name
       from public.badges b join public.apps a on a.id = b.app_id
      where b.slug = $1`,
    [slug],
  );
  publicId = rows[0]!.public_id;
  appName = rows[0]!.app_name;

  process.env.SUPABASE_DB_URL = process.env.VIBEFYCODE_TEST_DSN;
  process.env.PGUSER = 'postgres';
  // Configured, so the verification URL in the response is the one an operator
  // chose rather than the host this fake request carries. The other case has
  // its own test.
  process.env.NEXT_PUBLIC_VERIFY_URL = 'https://vibefycode.com';
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

afterAll(async () => {
  await db.end();
  for (const [name, value] of Object.entries({
    SUPABASE_DB_URL: before.dsn,
    PGUSER: before.user,
    NEXT_PUBLIC_VERIFY_URL: before.verify,
    NEXT_PUBLIC_SITE_URL: before.site,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

async function fetchBadge(file: string, query = '') {
  /*
   * Through a variable, not a literal.
   *
   * The same indirection `tests/a-badge-that-cannot-be-checked.test.ts` uses,
   * and now I know why: a literal path in an `import()` is resolved by the
   * root typecheck, which then tries to compile a Next route handler in a
   * project that has no `next/server` types. The first version of this file
   * passed its own run and broke `pnpm typecheck`.
   */
  const here = '../apps/web/app/badge/[file]/route.ts';
  const route = (await import(/* @vite-ignore */ here)) as BadgeRoute;
  const request = {
    nextUrl: new URL(`https://vibefycode.com/badge/${file}${query}`),
    headers: new Headers({ 'user-agent': 'vitest', host: 'vibefycode.com' }),
  };
  const response = await route.GET(request, { params: Promise.resolve({ file }) });
  return { response, body: await response.text() };
}

describe('a badge that exists', () => {
  it('is served as an SVG a browser will render', async () => {
    const { response, body } = await fetchBadge(`${publicId}.svg`, '?size=256');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8');
    expect(body).toMatch(/^<svg/);
    expect(body).toContain('</svg>');
  });

  it('carries the mark and the application it is about', async () => {
    // The two things a visitor reads off the image. If the view stops handing
    // over `app_name`, this is where it shows rather than on somebody's page.
    const { body } = await fetchBadge(`${publicId}.svg`);
    expect(body).toContain('Verified by');
    expect(body).toContain(appName);
  });

  it('points at its own verification page, from the configured origin', async () => {
    const { response, body } = await fetchBadge(`${publicId}.svg`);
    expect(response.headers.get('x-vibefycode-verify')).toBe(`https://vibefycode.com/a/${slug}`);
    expect(body).toContain(`https://vibefycode.com/a/${slug}`);
  });

  it('says it is live, in a header a marketplace can read without parsing the picture', async () => {
    const { response } = await fetchBadge(`${publicId}.svg`);
    expect(response.headers.get('x-vibefycode-status')).toBe('active');
  });

  it('carries the headers that make it safe to embed and quick to revoke', async () => {
    const { response } = await fetchBadge(`${publicId}.svg`);
    expect(response.headers.get('cache-control')).toMatch(/max-age=300/);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('is the same artwork whether or not a size is asked for', () => {
    /*
     * Written first as "renders at full size when no size is asked for", with
     * a `width > 64` assertion — and restoring the missing-size defect left it
     * green. `renderBadgeSvg` stopped reading `sizePx` when the badge began
     * embedding the supplied artwork; only `renderBadgeUnavailableSvg` uses
     * it, which is why the defect showed on the unavailable frame and why
     * `tests/the-badge-that-came-back-small.test.ts` is where it is held.
     *
     * So this says what is actually true of a live badge, which is worth
     * pinning on its own: the parameter travels in the URL for the embed's
     * sake and does not change the bytes.
     */
    return Promise.all([
      fetchBadge(`${publicId}.svg`),
      fetchBadge(`${publicId}.svg`, '?size=512'),
    ]).then(([plain, sized]) => {
      expect(sized.body).toBe(plain.body);
      expect(plain.body).toMatch(/width="\d+"/);
    });
  });
});

describe('a badge that does not', () => {
  it('reads as not verified rather than as a broken image', async () => {
    // Deliberately not a 404 with no body: an unknown id on somebody's website
    // should read as "not verified", not as an image they might ignore.
    const { response, body } = await fetchBadge('this-id-was-never-issued.svg');
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8');
    expect(body).toMatch(/^<svg/);
  });

  it('is refused outright when the file is not an svg', async () => {
    const { response } = await fetchBadge(`${publicId}.png`);
    expect(response.status).toBe(404);
  });
});
