/**
 * What each badge response actually answers with.
 *
 * `/badge/{id}.svg` has three outcomes: the badge, a revoked frame for an id
 * nobody holds, and an unavailable frame when the status cannot be checked.
 * All three are SVG served to third-party websites, and an SVG is a document a
 * browser will execute script from — which is what the content-security policy
 * and `x-content-type-options: nosniff` are for.
 *
 * Two of the three carried them. The 404 served for an unknown or revoked id
 * carried no policy, no `nosniff` and no cross-origin header at all.
 *
 * It survived because the test for them reads the route's source rather than a
 * response: `expect(route).toContain("'x-content-type-options': 'nosniff'")`
 * is satisfied by any one of the three paths having it. The fourth signature
 * in the runbook's list sitting on top of the second — a matcher looking at
 * text, standing in for three behaviours.
 *
 * So this asks each path, and compares them to each other rather than to a
 * list written here, because the thing worth asserting is that there is one
 * answer and not three.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const ROW = {
  public_id: 'live-badge',
  slug: 'an-app',
  status: 'active',
  score: 85,
  rubric_version: '1.1.0',
  assessed_at: '2026-10-01T00:00:00.000Z',
  issued_at: '2026-10-01T00:00:00.000Z',
  expires_at: '2027-10-01T00:00:00.000Z',
  certified_origin: 'https://an-app.example',
  signature: 'x',
  signing_key_id: 'k1',
  payload: '{}',
  app_name: 'An App',
  owner_is_marketing_client: false,
  owner_has_remediation: false,
  exit_measurement: null,
};

/** Each outcome, chosen by the id asked for. */
vi.mock('@/lib/badge-verification', () => ({
  lookUpBadgeVerification: async (id: string) => {
    if (id === 'unavailable') throw new Error('the database did not answer');
    if (id === 'unknown') return { row: null, throughFallback: false };
    return { row: ROW, throughFallback: false };
  },
}));
vi.mock('@/lib/sql', () => ({ writeAsService: async () => undefined }));

type BadgeRoute = {
  GET: (
    request: unknown,
    context: { params: Promise<{ file: string }> },
  ) => Promise<{ status: number; headers: Headers; text: () => Promise<string> }>;
};

const previous = process.env.NEXT_PUBLIC_SITE_URL;
beforeAll(() => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://vibefycode.com';
});
afterAll(() => {
  if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = previous;
});

async function ask(id: string) {
  const here = '../apps/web/app/badge/[file]/route.ts';
  const { GET } = (await import(/* @vite-ignore */ here)) as BadgeRoute;
  return GET(
    {
      nextUrl: new URL(`https://vibefycode.com/badge/${id}.svg?size=240`),
      // A host header, because every real request carries one and the
      // verification origin falls back to it.
      headers: new Headers({ 'user-agent': 'vitest', host: 'vibefycode.com' }),
    },
    { params: Promise.resolve({ file: `${id}.svg` }) },
  );
}

/** The header every response must carry, and what each one is for. */
const REQUIRED = [
  ['content-type', /image\/svg\+xml/, 'an embed renders a picture rather than its alt text'],
  [
    'content-security-policy',
    /default-src 'none'/,
    'an SVG is a document, and a document runs script',
  ],
  ['content-security-policy', /sandbox/, 'nothing inside the badge may navigate or submit'],
  [
    'content-security-policy',
    /img-src data:/,
    'the supplied artwork is a data URI and nothing else is allowed',
  ],
  [
    'x-content-type-options',
    /nosniff/,
    'the browser must not decide this is something other than an image',
  ],
  ['access-control-allow-origin', /\*/, 'it is embedded on somebody else’s site by design'],
] as const;

describe('the verification URL the badge carries', () => {
  /*
   * `apps/web/lib/verify-origin.ts` exists to repair two shapes somebody
   * writes into the variable, and it says it does so "for every caller": a
   * bare `vibefycode.com`, which makes `vibefycode.com/a/slug` — a relative
   * path wherever it is read — and the `.env.example` value
   * `http://localhost:3000/verify`, which makes `/verify/a/slug`, a 404,
   * because the route is `/a/[slug]`.
   *
   * This route was the only caller not using it. It read the two variables raw
   * and fell back to the empty string, ten lines from a local function with
   * the same name as the shared one — which is what a shadowed name invites.
   */
  const previousVerify = process.env.NEXT_PUBLIC_VERIFY_URL;

  afterAll(() => {
    if (previousVerify === undefined) delete process.env.NEXT_PUBLIC_VERIFY_URL;
    else process.env.NEXT_PUBLIC_VERIFY_URL = previousVerify;
  });

  const verifyHeaderWith = async (configured: string | undefined) => {
    if (configured === undefined) delete process.env.NEXT_PUBLIC_VERIFY_URL;
    else process.env.NEXT_PUBLIC_VERIFY_URL = configured;
    return (await ask('live-badge')).headers.get('x-vibefycode-verify');
  };

  it('is absolute when the variable is absolute', async () => {
    expect(await verifyHeaderWith('https://vibefycode.com')).toBe(
      'https://vibefycode.com/a/an-app',
    );
  });

  it('is repaired when the variable is a bare host', async () => {
    // Was `vibefycode.com/a/an-app`, which is a relative path.
    expect(await verifyHeaderWith('vibefycode.com')).toBe('https://vibefycode.com/a/an-app');
  });

  it('is repaired when the variable carries a path', async () => {
    // Was `http://localhost:3000/verify/a/an-app`, and the route is /a/[slug].
    expect(await verifyHeaderWith('http://localhost:3000/verify')).toBe(
      'http://localhost:3000/a/an-app',
    );
  });

  it('falls back to the host the request arrived on, not to an empty string', async () => {
    /*
     * Was `/a/an-app`. A deployment that has configured nothing now gets the
     * origin it is being served from, which is the whole reason
     * `verify-origin.ts` reads the request at all.
     *
     * The first draft of this case gave the fake request no host header, which
     * no real request lacks, and then asserted against a value the code could
     * not produce — so it failed on the fixture rather than on the code. The
     * harness carries a host now, like a request.
     */
    const previousSite = process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    try {
      expect(await verifyHeaderWith(undefined)).toBe('https://vibefycode.com/a/an-app');
    } finally {
      if (previousSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
      else process.env.NEXT_PUBLIC_SITE_URL = previousSite;
    }
  });
});

describe('every outcome of a badge request', () => {
  const outcomes = ['live-badge', 'unknown', 'unavailable'] as const;

  it('is the three this file is about', async () => {
    // The anchor. Each case below is a loop over these, and the statuses are
    // asserted so that a route answering 200 to everything would fail here
    // rather than quietly pass the header checks.
    const statuses = await Promise.all(outcomes.map(async (id) => (await ask(id)).status));
    expect(statuses).toEqual([200, 404, 503]);
  });

  it.each(outcomes)('%s carries every header a public SVG needs', async (id) => {
    const { headers } = await ask(id);
    for (const [header, pattern, why] of REQUIRED) {
      expect(headers.get(header) ?? '', `${id}: ${header} — ${why}`).toMatch(pattern);
    }
  });

  it('answers with the same policy on all three, not three policies', async () => {
    const policies = await Promise.all(
      outcomes.map(async (id) => (await ask(id)).headers.get('content-security-policy')),
    );
    expect(new Set(policies).size, `three different policies: ${policies.join(' | ')}`).toBe(1);
  });

  it('caches the two it can stand by, and never the one it cannot', async () => {
    expect((await ask('live-badge')).headers.get('cache-control')).toMatch(/max-age=300/);
    expect((await ask('unknown')).headers.get('cache-control')).toMatch(/max-age=300/);
    // One bad second pinned across every embed of every badge on every site.
    expect((await ask('unavailable')).headers.get('cache-control')).toBe('no-store');
  });

  it('varies on nothing, because it negotiates nothing', async () => {
    // `vary: Accept` was here under a comment saying caches must key on the
    // size in the query string. A cache keys on the whole URL without being
    // asked, `Accept` is a different header, and the size no longer changes
    // the picture at all.
    for (const id of outcomes) {
      expect((await ask(id)).headers.get('vary'), id).toBeNull();
    }
  });

  it('says the status and the verification page on the one that has them', async () => {
    const live = await ask('live-badge');
    expect(live.headers.get('x-vibefycode-status')).toBe('active');
    expect(live.headers.get('x-vibefycode-verify')).toBe('https://vibefycode.com/a/an-app');
    // And not on the others, where there is no badge to describe.
    expect((await ask('unknown')).headers.get('x-vibefycode-status')).toBeNull();
    expect((await ask('unavailable')).headers.get('x-vibefycode-status')).toBeNull();
  });
});
