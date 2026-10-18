/**
 * The site's public pages, when the console's configuration is wrong.
 *
 * `apps/web/proxy.ts` — Next 16's name for the middleware — runs on every route
 * but the static assets, and its own docstring says what it is for: "The
 * redirect here is a convenience, not the security boundary: row-level security
 * is, and it holds even if this file is deleted."
 *
 * It did not follow that reasoning. It read both Supabase variables with `!`
 * and built the client before anything else, so a deployment with one of them
 * missing or mistyped threw here — on every matched route. The home page,
 * `/how-it-works`, `/methodology`, the legal documents and the pricing table
 * read no database at all and went down with it: a marketing site returning 500
 * over a variable only the console needs. The same for a Supabase that cannot
 * be reached, which is a state this product has already been in for days at a
 * time.
 *
 * Both faults now let the request through, and nothing is exposed by that: a
 * `/console` page calls `getUser()` itself and redirects when there is nobody,
 * every query runs under row-level security as the caller, and with these
 * variables absent no page can reach the database at all. What the redirect
 * saves is rendering a console page to find out.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { proxy } from './proxy.ts';

/*
 * Beside the file rather than in `tests/`, because `next/server` is a
 * dependency of `apps/web` and resolves from here. The root suite picks it up
 * through the `apps/web` glob in `vitest.config.ts`.
 */
const source = readFileSync(new URL('./proxy.ts', import.meta.url), 'utf8');
const ask = (path: string) => new NextRequest(`https://vibefycode.com${path}`);

let url: string | undefined;
let key: string | undefined;

beforeEach(() => {
  url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

afterEach(() => {
  if (url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  if (key === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = key;
});

describe('a deployment missing its Supabase variables', () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it('serves the pages that read no database', async () => {
    const response = await proxy(ask('/'));
    expect(response.status).toBe(200);
    // `next()` carries this header; a redirect would carry a location instead.
    expect(response.headers.get('location')).toBeNull();
  });

  it('serves the public verification page, which a stranger is reading', async () => {
    const response = await proxy(ask('/a/kettle'));
    expect(response.status).toBe(200);
  });

  it('lets a console request through to the page, which checks for itself', async () => {
    const response = await proxy(ask('/console/apps/some-id'));
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });
});

describe('a url that is not a url', () => {
  /*
   * The realistic version of this, and the one the empty-variable check above
   * does not cover: a value is set and it is the wrong kind of thing — a host
   * with no scheme, a connection string pasted into the wrong field, a stray
   * character. Measured rather than assumed: `createServerClient` throws
   * "Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL" on this, while a
   * well-formed address nothing answers on does not throw at all — it returns
   * "Auth session missing!" like any visitor without a cookie. So this is the
   * case that reaches the `catch`, and it is why there is one.
   */
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'db.vibefycode.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'not-a-real-key';
  });

  it('does not take the public pages down with it', async () => {
    const response = await proxy(ask('/'));
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('does not take a console request down either', async () => {
    const response = await proxy(ask('/console'));
    expect(response.status).toBe(200);
  });
});

describe('the file itself', () => {
  it('still guards the console when it can read a session', () => {
    // The positive control: the convenience redirect is still there, and the
    // cases above are about what happens when it cannot run.
    expect(source).toContain("request.nextUrl.pathname.startsWith('/console')");
    expect(source).toContain('NextResponse.redirect(signIn)');
  });

  it('reads the two variables without asserting they are there', () => {
    expect(source).not.toContain('process.env.NEXT_PUBLIC_SUPABASE_URL!');
    expect(source).not.toContain('process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!');
  });

  it('says which variable is missing, once a minute rather than once a request', () => {
    expect(source).toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(source).toContain('60_000');
  });
});
