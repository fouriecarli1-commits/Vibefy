/**
 * A snippet keeps the origin it was copied under, and nothing said so.
 *
 * The badge on futurebox was copied in August, under
 * `vibefy-web-lyart.vercel.app`, because that is the address the console was
 * being browsed at and the snippet is built from the resolved origin. When the
 * app moved to its own domain, the mark on their front page became alt text.
 * It was blamed on the content-security policy and then on the connection
 * string before anybody looked at the snippet, because all three failures look
 * identical from outside: no badge.
 *
 * `isPlaceholderOrigin` already warned about the case where nothing resolved —
 * the reserved-TLD fallback. It cannot warn about this one, because something
 * did resolve: the request host. One answer covering two situations, where the
 * second is the one that reaches a customer's website and waits.
 *
 * So the resolver now says where the origin came from, and the console warns
 * on `request`. Every other caller is unchanged and still gets a string: a
 * badge image or a verification page only needs the address it is served from.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { verifyOriginWithSource } from '../apps/web/lib/verify-origin.ts';
import { withoutComments } from './setup/source.ts';

const withEnvironment = (values: Record<string, string | undefined>, body: () => void): void => {
  const previous = { ...process.env };
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    body();
  } finally {
    process.env = previous;
  }
};

const unset = { NEXT_PUBLIC_VERIFY_URL: undefined, NEXT_PUBLIC_SITE_URL: undefined };

describe('where the origin came from', () => {
  it('is the configured one when a variable holds it', () => {
    withEnvironment({ ...unset, NEXT_PUBLIC_SITE_URL: 'https://vibefycode.com' }, () => {
      expect(verifyOriginWithSource('a-preview-url.vercel.app')).toEqual({
        origin: 'https://vibefycode.com',
        source: 'configured',
      });
    });
  });

  it('is the badge variable where both are set, because that is the preference', () => {
    withEnvironment(
      {
        NEXT_PUBLIC_VERIFY_URL: 'https://verify.vibefycode.com',
        NEXT_PUBLIC_SITE_URL: 'https://vibefycode.com',
      },
      () => {
        expect(verifyOriginWithSource('ignored.example').source).toBe('configured');
        expect(verifyOriginWithSource('ignored.example').origin).toBe(
          'https://verify.vibefycode.com',
        );
      },
    );
  });

  it('is the request when nothing is configured, which is what futurebox copied', () => {
    withEnvironment(unset, () => {
      expect(verifyOriginWithSource('vibefy-web-lyart.vercel.app')).toEqual({
        origin: 'https://vibefy-web-lyart.vercel.app',
        source: 'request',
      });
    });
  });

  it('is the request when a variable holds something unparseable', () => {
    /*
     * The case a check on "is the variable set?" would call configured.
     * `originFrom` falls through to the request host for a value it cannot
     * parse, so the source has to be read from the answer rather than from the
     * variable — which is what the comparison in that function does.
     */
    withEnvironment({ ...unset, NEXT_PUBLIC_SITE_URL: 'not a url at all' }, () => {
      const verdict = verifyOriginWithSource('a-preview-url.vercel.app');
      expect(verdict.source).toBe('request');
      expect(verdict.origin).toBe('https://a-preview-url.vercel.app');
    });
  });

  it('is the placeholder when there is neither a variable nor a host', () => {
    // The case the console already warned about, kept distinct from the two
    // above: nothing resolved at all.
    withEnvironment(unset, () => {
      expect(verifyOriginWithSource(null).source).toBe('placeholder');
    });
  });

  it('calls a configured value configured even when it matches the host', () => {
    // Somebody browsing the domain they configured. The answer is the same
    // string either way, and the source is still the variable — otherwise the
    // warning would fire on the one deployment that has nothing wrong with it.
    withEnvironment({ ...unset, NEXT_PUBLIC_SITE_URL: 'https://vibefycode.com' }, () => {
      expect(verifyOriginWithSource('vibefycode.com').source).toBe('configured');
    });
  });
});

describe('what the console does with it', () => {
  const page = withoutComments(readFileSync('apps/web/app/console/apps/[id]/page.tsx', 'utf8'));

  it('warns when the snippet would carry the address being browsed', () => {
    /*
     * The guard is matched whole. `toMatch(/originSource === 'request'/)` was
     * the first version, and `{false && originSource === 'request' && (`
     * satisfies it — a mutation that turned the warning off left the test
     * green, which is the fourth time this week an assertion has been
     * satisfied by the text of the thing rather than the thing.
     */
    expect(page).toContain("{originSource === 'request' && (");
    expect(page).toContain('This snippet will point at');
    expect(page).toContain('NEXT_PUBLIC_SITE_URL');
  });

  it('still warns separately about an origin that did not resolve at all', () => {
    // Two warnings for two situations. Collapsing them would be the defect
    // this file is about, in the fix for it.
    expect(page).toMatch(/isPlaceholderOrigin\(verifyOrigin\)/);
    expect(page).toContain('will not work yet');
  });

  it('reads the source from the resolver rather than from the variable', () => {
    expect(page).toMatch(/resolveVerifyOriginWithSource\(\)/);
    expect(page, 'the page should not read the variable itself').not.toMatch(
      /process\.env\.NEXT_PUBLIC_(SITE|VERIFY)_URL/,
    );
  });
});
