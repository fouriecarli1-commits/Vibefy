/**
 * The headers the badge is served with, against what the badge actually is.
 *
 * These two drifted apart the moment the seal stopped being drawn. The route
 * sends `default-src 'none'`, which was exactly right for a document made of
 * paths and forbids the one thing the new document is made of — the supplied
 * artwork, embedded as a data URI. Every browser loaded the SVG and then
 * refused the picture inside it: an empty frame on the customer's website, with
 * nothing in any log to say why.
 *
 * Nothing caught it because no test renders the badge in a browser, and no
 * assertion connected what the renderer emits to what the route permits. That
 * connection is what this file is.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderBadgeSvg } from '../packages/badge/src/index.ts';

const route = readFileSync(join(process.cwd(), 'apps/web/app/badge/[file]/route.ts'), 'utf8');

/** The policy the route sends, pulled out of the source it is written in. */
function contentSecurityPolicy(): string {
  const match = /'content-security-policy':\s*\n?\s*"([^"]+)"/.exec(route);
  if (!match) throw new Error('The badge route no longer sets a content security policy.');
  return match[1]!;
}

describe('the badge is allowed to contain what it contains', () => {
  it('permits the scheme the artwork is embedded with', () => {
    const svg = renderBadgeSvg({ status: 'active' });
    const scheme = /<image[^>]+href="([a-z]+):/.exec(svg)?.[1];
    expect(scheme, 'the renderer no longer embeds anything').toBe('data');

    const policy = contentSecurityPolicy();
    expect(policy, 'the badge would render as an empty frame').toMatch(
      new RegExp(`img-src[^;]*\\b${scheme}:`),
    );
  });

  it('does so for every state, not only the one somebody checked', () => {
    for (const status of ['active', 'suspended', 'expired', 'revoked'] as const) {
      expect(renderBadgeSvg({ status })).toContain('href="data:image/webp;base64,');
    }
  });
});

describe('and nothing else', () => {
  it('still forbids everything by default', () => {
    expect(contentSecurityPolicy()).toContain("default-src 'none'");
  });

  it('lets the badge reach no remote origin at all', () => {
    // The property that mattered, and the reason `img-src` names a scheme
    // rather than a host: a badge that could fetch from somewhere is a badge
    // that could report who is looking at it.
    const policy = contentSecurityPolicy();
    const imgSrc = /img-src ([^;]+)/.exec(policy)?.[1]?.trim();
    expect(imgSrc).toBe('data:');
    expect(policy).not.toMatch(/https?:/);
  });

  it('is still sandboxed and still refuses to be sniffed', () => {
    expect(contentSecurityPolicy()).toContain('sandbox');
    expect(route).toContain("'x-content-type-options': 'nosniff'");
  });
});

describe('the badge can be embedded from anywhere', () => {
  it('because refusing to render is not how a mismatch is handled', () => {
    // A mismatched origin is recorded and served. Refusing would punish a
    // customer who moved domains by making their site look broken, and would
    // tell whoever copied the badge exactly what tripped the check.
    expect(route).toContain("'access-control-allow-origin': '*'");
    expect(route).toContain('origin_mismatch');
  });
});
