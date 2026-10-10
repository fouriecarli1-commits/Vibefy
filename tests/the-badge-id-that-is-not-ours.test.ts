/**
 * The first thing `docs/DOEN.md` tells him to do.
 *
 *     ### Toets
 *     In 'n privaat venster:
 *     https://vibefycode.com/badge/nonexistent-test-id.svg
 *
 *     · Badge wat "revoked" sê → klaar. Gaan na stap 1b.
 *     · Grys raampie → Vercel → Logs …
 *
 * An id nobody holds has to come back as a badge reading revoked. That is the
 * pass condition for his whole deployment check, and the other branch sends
 * him into the Vercel logs hunting a connection-string message. So the two
 * outcomes are not interchangeable: if an unknown id ever served the
 * unavailable frame, or a bare 404 with no image, the document would send him
 * to debug a database that is working perfectly.
 *
 * The route was otherwise asserted by reading its source — three tests check
 * that `route.ts` contains `renderBadgeSvg` and the word `revoked`, which is
 * equally true of a commented-out branch.
 *
 * The lookup is replaced rather than driven through a real database. Two
 * attempts to use the test database failed for reasons worth recording,
 * because both produced the *other* branch and so would have left this file
 * green on the wrong half of its own distinction:
 *
 *   - `VIBEFYCODE_TEST_DSN` names no user (`postgresql:///vibefycode_test`
 *     over a socket; every helper supplies `user: 'postgres'` itself), so `pg`
 *     reports "no PostgreSQL user name specified in startup packet".
 *   - With the user added, the route's own connection-string check refuses it:
 *     it requires a string ending `/postgres`, which is the Supabase shape it
 *     was written to diagnose for Anré.
 *
 * Whether a nonexistent id yields no row is a property of the view and is
 * tested there. What is untested, and what the document rests on, is what this
 * route does once the lookup has said no.
 *
 * `tests/a-badge-that-cannot-be-checked.test.ts` covers the other branch — a
 * lookup that cannot answer at all.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/** The lookup says there is no such badge, which is the case under test. */
vi.mock('@/lib/badge-verification', () => ({
  lookUpBadgeVerification: async () => ({ row: null, throughFallback: false }),
}));

type BadgeRoute = {
  GET: (
    request: unknown,
    context: { params: Promise<{ file: string }> },
  ) => Promise<{ status: number; headers: Headers; text: () => Promise<string> }>;
};

/** Loaded through a specifier TypeScript does not follow, as the sibling file explains. */
async function loadRoute(): Promise<BadgeRoute> {
  const here = '../apps/web/app/badge/[file]/route.ts';
  return (await import(/* @vite-ignore */ here)) as BadgeRoute;
}

const aRequestFor = (url: string) => ({
  nextUrl: new URL(url),
  headers: new Headers({ 'user-agent': 'vitest' }),
});

const previous = process.env.NEXT_PUBLIC_SITE_URL;

beforeAll(() => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://vibefycode.com';
});

afterAll(() => {
  if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = previous;
});

describe('a badge id nobody holds', () => {
  const ask = async (file: string) => {
    const { GET } = await loadRoute();
    return GET(aRequestFor(`https://vibefycode.com/badge/${file}`), {
      params: Promise.resolve({ file }),
    });
  };

  it('is served as an SVG, so a direct visit renders a picture', async () => {
    const response = await ask('nonexistent-test-id.svg');
    expect(response.headers.get('content-type')).toMatch(/image\/svg\+xml/);
    const body = await response.text();
    expect(body.startsWith('<svg'), body.slice(0, 40)).toBe(true);
  });

  it('reads revoked, which is the word he is told to look for', async () => {
    const body = await (await ask('nonexistent-test-id.svg')).text();
    expect(body.toLowerCase()).toContain('revoked');
  });

  it('is not the unavailable frame, which would send him to debug a working database', async () => {
    // The two outcomes are the two branches of his instruction. Serving the
    // "we cannot answer" image for an id that simply does not exist points him
    // at the Vercel logs for a connection string that is fine.
    const body = await (await ask('nonexistent-test-id.svg')).text();
    expect(body.toLowerCase()).not.toContain('unavailable');
    expect(body.toLowerCase()).not.toContain('cannot');
  });

  it('says 404, because the id really is not ours', async () => {
    expect((await ask('nonexistent-test-id.svg')).status).toBe(404);
  });

  it('answers the same for the id the document actually names', async () => {
    // Quoted from docs/DOEN.md rather than invented, so a change to the
    // document that this file does not follow shows up here.
    const { readFileSync } = await import('node:fs');
    const doen = readFileSync('docs/DOEN.md', 'utf8');
    const quoted = /vibefycode\.com\/badge\/([A-Za-z0-9._-]+)/.exec(doen)?.[1];
    expect(quoted, 'docs/DOEN.md no longer names a badge file to test with').toBeTruthy();
    const response = await ask(quoted!);
    expect(response.headers.get('content-type')).toMatch(/image\/svg\+xml/);
    expect((await response.text()).toLowerCase()).toContain('revoked');
  });
});
