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
let appId: string;

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
  appId = seeded.appId;
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

/**
 * The two addresses a marketplace is told to use, against the same row.
 *
 * Both were changed on 2026-10-11 to carry the paid-relationship disclosure
 * the independence policy promises wherever a rating appears, and both read a
 * column that had to be added to a view for it. A change to a select list is
 * exactly the kind that passes a source-reading test and fails against a
 * database, so they are asked here too.
 */
describe('the machine-readable answers', () => {
  interface StatusRoute {
    GET: (
      request: unknown,
      context: { params: Promise<{ publicId: string }> },
    ) => Promise<{ status: number; json: () => Promise<Record<string, unknown>> }>;
  }
  interface ListRoute {
    GET: (request: unknown) => Promise<{
      status: number;
      json: () => Promise<{ badges: Record<string, unknown>[]; count: number }>;
    }>;
  }

  const aRequest = () => ({
    nextUrl: new URL('https://vibefycode.com/api'),
    headers: new Headers({ host: 'vibefycode.com' }),
  });

  async function status(id: string) {
    const here = '../apps/web/app/api/badge/[publicId]/status/route.ts';
    const route = (await import(/* @vite-ignore */ here)) as StatusRoute;
    const response = await route.GET(aRequest(), {
      params: Promise.resolve({ publicId: id }),
    });
    return { response, body: await response.json() };
  }

  async function live() {
    const here = '../apps/web/app/api/badges/live/route.ts';
    const route = (await import(/* @vite-ignore */ here)) as ListRoute;
    const response = await route.GET(aRequest());
    return { response, body: await response.json() };
  }

  it('answers about one badge with the facts and the limits', async () => {
    const { response, body } = await status(publicId);
    expect(response.status).toBe(200);
    expect(body.badgeId).toBe(publicId);
    expect(body.isLive).toBe(true);
    expect(body.state).toBe('live');
    expect(body.appName).toBe(appName);
    expect(body.verificationPage).toBe(`https://vibefycode.com/a/${slug}`);
    expect(String(body.limits)).toMatch(/not a statement that the application has no defects/i);
  });

  it('says there is no paid relationship when there is none', async () => {
    // Null rather than a sentence, because a disclosure on every badge is a
    // disclosure on none.
    const { body } = await status(publicId);
    expect(body.paidRelationship).toBeNull();
  });

  it('discloses one when the owner has bought marketing services', async () => {
    /*
     * The column reached this answer through a view, which is the half a
     * source-reading test cannot check. Set on the organisation, read back
     * through `badge_verification`.
     */
    await db.query(
      `update public.organisations set is_marketing_client = true, marketing_client_since = now()
        where id = (select organisation_id from public.apps where id = $1)`,
      [appId],
    );
    try {
      const { body } = await status(publicId);
      expect(String(body.paidRelationship)).toMatch(/purchased marketing services/i);
    } finally {
      await db.query(
        `update public.organisations set is_marketing_client = false, marketing_client_since = null
          where id = (select organisation_id from public.apps where id = $1)`,
        [appId],
      );
    }
  });

  it('answers 404 with a sentence for a badge nobody issued', async () => {
    const { response, body } = await status('never-issued-at-all');
    expect(response.status).toBe(404);
    expect(String(body.error)).toMatch(/no badge with that identifier/i);
    // "We have never assessed this application" is a different claim, and not
    // ours to make from an identifier.
    expect(String(body.note)).toMatch(/says nothing about the application/i);
  });

  it('lists a badge whose owner chose to be listed, with the same disclosure field', async () => {
    const { rows } = await db.query<{ organisation_id: string }>(
      'select organisation_id from public.apps where id = $1',
      [appId],
    );
    await db.query(
      `insert into public.directory_listings (app_id, organisation_id, state)
       values ($1, $2, 'listed'::public.listing_state)
       on conflict (app_id) do update set state = excluded.state`,
      [appId, rows[0]!.organisation_id],
    );

    const { response, body } = await live();
    expect(response.status).toBe(200);
    const mine = body.badges.find((entry) => entry.badgeId === publicId);
    expect(mine, 'the listed badge is not in the document').toBeDefined();
    expect(mine!.verificationPage).toBe(`https://vibefycode.com/a/${slug}`);
    expect(mine!.paidRelationship).toBeNull();
  });
});
