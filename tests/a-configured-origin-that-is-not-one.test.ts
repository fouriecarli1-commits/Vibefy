/**
 * A configured origin that is not an origin.
 *
 * `originFrom` took whatever the deployment was told and, apart from stripping
 * trailing slashes, used it. Two shapes get put in that variable by anybody
 * reading it as "the site's address", and both broke silently:
 *
 *   · **A bare host** — `vibefycode.com`. Every caller builds
 *     `${origin}/a/${slug}`, so the badge URL became `vibefycode.com/a/abc`,
 *     which a browser reads as a *relative* path. On the verification page it
 *     resolves against whatever page it appears on; in an embed snippet on a
 *     customer's own website it resolves against *their* domain. `new URL()` on
 *     it throws outright. Nothing says so anywhere.
 *   · **A host with a path** — and `.env.example` shipped exactly this, as
 *     `NEXT_PUBLIC_VERIFY_URL=http://localhost:3000/verify`. Badge URLs became
 *     `/verify/a/${slug}`, and the route is `/a/[slug]`, so every badge anybody
 *     clicked returned 404. There is no `/verify/a` route and never was.
 *
 * Found the way the placeholder domain was: the founder set
 * `NEXT_PUBLIC_SITE_HOST=vibefycode.com` on Vercel — a variable this codebase
 * does not read at all — and the bare host in the value is what a person
 * naturally writes. The variable name is a conversation; the shape is a defect,
 * because the code would have accepted it and produced broken links.
 *
 * The scheme is not guessed. `originFrom` already decides it from the request
 * host one branch down — http for localhost and 127.0.0.1, https for everything
 * else — and this is that same rule applied to a configured value.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPlaceholderOrigin, originFrom } from '../apps/web/lib/verify-origin.ts';

describe('a bare host', () => {
  it('becomes an origin rather than a relative path', () => {
    expect(originFrom('vibefycode.com', null)).toBe('https://vibefycode.com');
  });

  it('is http on localhost, by the same rule the request host uses', () => {
    expect(originFrom('localhost:3000', null)).toBe('http://localhost:3000');
    expect(originFrom('127.0.0.1:3000', null)).toBe('http://127.0.0.1:3000');
  });

  it('builds a URL that a browser reads as absolute', () => {
    const origin = originFrom('vibefycode.com', null);
    expect(new URL(`${origin}/a/abc`).href).toBe('https://vibefycode.com/a/abc');
  });
});

describe('a configured value carrying more than an origin', () => {
  it('is reduced to its origin, because that is what every caller appends to', () => {
    expect(originFrom('http://localhost:3000/verify', null)).toBe('http://localhost:3000');
    expect(originFrom('https://vibefycode.com/verify/', null)).toBe('https://vibefycode.com');
  });

  it('keeps a non-default port, which is not decoration', () => {
    expect(originFrom('https://vibefycode.com:8443/x', null)).toBe('https://vibefycode.com:8443');
  });

  it('drops a query and a fragment somebody pasted from a browser bar', () => {
    expect(originFrom('https://vibefycode.com/?utm=x#top', null)).toBe('https://vibefycode.com');
  });
});

describe('a configured value that cannot be read as an origin at all', () => {
  it('falls through to the request rather than being used', () => {
    // The request is the one thing that is true by construction. Preferring an
    // unparseable variable over it would be preferring a typo to a fact.
    expect(originFrom('http://', 'vibefycode.vercel.app')).toBe('https://vibefycode.vercel.app');
  });

  it('and to the obvious placeholder when there is no request either', () => {
    expect(isPlaceholderOrigin(originFrom('http://', null))).toBe(true);
  });

  it('treats whitespace as nothing configured', () => {
    expect(originFrom('   ', 'vibefycode.vercel.app')).toBe('https://vibefycode.vercel.app');
  });
});

describe('what is documented', () => {
  it('does not ship an example value that makes every badge a 404', () => {
    const example = readFileSync(join(process.cwd(), '.env.example'), 'utf8');
    const verify = /^NEXT_PUBLIC_VERIFY_URL=(.*)$/m.exec(example)?.[1]?.trim() ?? '';
    // Either unset — the console reads the request, which is right for one
    // hostname — or an origin. Never a path.
    if (verify.length > 0) {
      expect(new URL(verify).pathname).toBe('/');
    }
  });

  it('names the variable that exists, in the words a deployment needs', () => {
    const runbook = readFileSync(join(process.cwd(), 'docs/RUNBOOK.md'), 'utf8');
    expect(runbook).toContain('NEXT_PUBLIC_SITE_URL');
    // The shape, not only the name. A bare host is what a person writes, and
    // until 2026-09-24 it produced relative URLs without complaint.
    expect(runbook).toMatch(/full URL/);
    expect(runbook).toContain('no trailing slash and no path');
    // And the name, because the way this was found was a variable that does not
    // exist being set on the deployment that needed the one that does.
    expect(runbook).toContain('NEXT_PUBLIC_SITE_HOST');
  });
});
