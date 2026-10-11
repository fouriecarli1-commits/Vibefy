/**
 * A cookie notice describing cookies nobody sets.
 *
 * `legal/cookie-notice.md` published a table of three: the Supabase auth
 * cookie, a `vibefycode-consent` cookie with a twelve-month lifetime, and
 * analytics cookies with fourteen. Under it, a section called "The consent
 * mechanism" described a banner offering Accept and Reject as equally prominent
 * choices, changeable from the footer.
 *
 * Two of the three cookies do not exist, and neither does the banner. Nothing
 * in `apps/web` writes a cookie except the Supabase client, which writes the
 * auth cookie; no analytics package is installed and no analytics script is
 * loaded. The privacy policy carried the same claim in its retention table:
 * "Session cookie; analytics only where you consent … analytics 14 months".
 *
 * It is the mildest possible kind of false statement — we claimed to collect
 * less-than-nothing — and it is still the one thing a trust product cannot
 * publish. A sceptical reader checks the cookie notice against their own
 * browser in ten seconds, and our own rubric marks an application down for a
 * privacy notice that does not match what it does. The scope qualifier rule in
 * the brief is the same instinct: say what was actually done, not what sounds
 * right.
 *
 * So the notice now lists one cookie and says that is the whole list, and the
 * consent-mechanism paragraph is kept as what it is — a commitment about what
 * would happen if an optional cookie were ever set, which is a promise worth
 * keeping and was never a description.
 *
 * This holds both directions. If an analytics package appears, the notice has
 * to say so, and this test fails until it does.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withoutComments } from './setup/source.ts';

const NOTICE = readFileSync('legal/cookie-notice.md', 'utf8');
const POLICY = readFileSync('legal/privacy-policy.md', 'utf8');

function sourcesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.next', 'dist', 'ios', 'android'].includes(entry.name)) continue;
      found.push(...sourcesUnder(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

const WEB = sourcesUnder('apps/web').map((path) => ({
  path,
  code: withoutComments(readFileSync(path, 'utf8')),
}));

/** Every name that would put a tracking cookie on a visitor's browser. */
const ANALYTICS = [
  '@vercel/analytics',
  'speed-insights',
  'posthog',
  'plausible',
  'mixpanel',
  'segment',
  'gtag',
  'google-analytics',
  'googletagmanager',
  'hotjar',
  'fullstory',
  'amplitude',
  'matomo',
];

const MANIFESTS = ['package.json', 'apps/web/package.json', 'apps/mobile/package.json'].map(
  (path) => readFileSync(path, 'utf8'),
);

describe('what the codebase actually sets', () => {
  it('found the app to search', () => {
    expect(WEB.length).toBeGreaterThan(100);
    expect(WEB.map((file) => file.path)).toContain('apps/web/lib/supabase/server.ts');
  });

  it('writes a cookie in one place, and it is the sign-in client', () => {
    const writers = WEB.filter((file) =>
      /cookieStore\.set\(|cookies\(\)\.set\(|document\.cookie|['"]Set-Cookie['"]/i.test(file.code),
    ).map((file) => file.path);
    // `proxy.ts` forwards what it is given and sets nothing of its own; the two
    // Supabase modules are the client and the server halves of the same cookie.
    expect(writers.sort()).toEqual(['apps/web/lib/supabase/server.ts']);
  });

  it('loads no analytics, by package or by script', () => {
    const inCode = WEB.filter((file) =>
      ANALYTICS.some((name) => file.code.toLowerCase().includes(name)),
    ).map((file) => file.path);
    expect(inCode).toEqual([]);
    for (const manifest of MANIFESTS) {
      for (const name of ANALYTICS) {
        expect(manifest.toLowerCase(), name).not.toContain(name);
      }
    }
  });

  it('sets nothing that remembers a cookie choice', () => {
    const consent = WEB.filter((file) => file.code.includes('vibefycode-consent')).map(
      (file) => file.path,
    );
    expect(consent).toEqual([]);
  });
});

describe('what the notice says', () => {
  /** The rows of the "What we set" table, without its header and rule. */
  const rows = (() => {
    const start = NOTICE.indexOf('## What we set');
    const end = NOTICE.indexOf('##', start + 3);
    return NOTICE.slice(start, end)
      .split('\n')
      .filter((line) => line.startsWith('|') && !/^\|\s*-+/.test(line))
      .slice(1);
  })();

  it('found the table', () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it('lists exactly the cookies something sets', () => {
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('sb-*-auth-token');
  });

  it('says the list is the whole list, so silence is not ambiguous', () => {
    expect(NOTICE).toMatch(/That is the whole list/);
    expect(NOTICE).toMatch(/no analytics cookie/i);
  });

  it('keeps the consent commitment as a commitment rather than a description', () => {
    // The paragraph is worth keeping — it is a promise about how consent would
    // work. What it must not do is describe a banner a visitor cannot find.
    expect(NOTICE).toMatch(/If we ever set an optional cookie/);
    expect(NOTICE).toMatch(/would say so here before setting it/);
    expect(NOTICE).not.toMatch(/The banner offers/);
  });

  it('agrees with the privacy policy, which carried the same claim', () => {
    expect(POLICY).not.toMatch(/analytics 14 months/);
    expect(POLICY).not.toMatch(/analytics only where you consent/);
    expect(POLICY).toMatch(/Session cookie \(keeps you signed in\)/);
  });
});

describe('the day analytics arrives', () => {
  it('is the day both documents have to change, and this is what fails first', () => {
    /*
     * The forcing direction, and the reason this file is not merely a snapshot.
     *
     * Adding a tracking package without touching the notice leaves us claiming
     * we set no analytics cookie while setting one, which is the same defect
     * pointed the other way and a materially worse version of it.
     */
    const analyticsPresent =
      WEB.some((file) => ANALYTICS.some((name) => file.code.toLowerCase().includes(name))) ||
      MANIFESTS.some((manifest) => ANALYTICS.some((name) => manifest.toLowerCase().includes(name)));
    if (analyticsPresent) {
      expect(NOTICE).toMatch(/Analytics cookies/);
      expect(NOTICE).toMatch(/Optional — only with consent/);
      expect(NOTICE).not.toMatch(/no analytics cookie/i);
    } else {
      expect(NOTICE).not.toMatch(/\| Analytics cookies/);
    }
  });
});
