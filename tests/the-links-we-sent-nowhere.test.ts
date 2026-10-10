/**
 * Every URL we hand somebody, built from a variable nobody checked.
 *
 * `apps/web/lib/verify-origin.ts` exists to repair two shapes a person writes
 * into `NEXT_PUBLIC_SITE_URL` or `NEXT_PUBLIC_VERIFY_URL` — a bare host, which
 * makes a relative path wherever the result is read, and a host with a path on
 * it, which makes a 404 — and its header says it does so "for every caller".
 * Six callers were not going through it. They read the two variables raw and
 * fell back to `''`, or to `http://localhost:3000`, and each one produced a
 * URL that somebody outside this company was expected to follow:
 *
 *   · `/api/badge/<id>` told a verifier our signing keys were at
 *     `/.well-known/vibefycode-badge-key` — and a verifier who cannot fetch
 *     the key set concludes the badge is not ours.
 *   · `/api/badge/<id>/status` and `/api/badges/live` gave a marketplace
 *     `verificationPage: "/a/<slug>"`, which resolves against the
 *     marketplace's own domain.
 *   · the badge image carried the same path as its accessible description.
 *   · a workspace invitation emailed `/invite/<token>`, and the token is
 *     stored only as a hash, so that invitation could never be re-sent.
 *   · a checkout returned the customer who had just paid to
 *     `http://localhost:3000`.
 *
 * Each of those was found by reading one file and then asking the same question
 * of the rest, which is the only reason there is a sweep here rather than six
 * more tests. The claim is structural: in the web app, one file reads these
 * variables. In the worker there is no request to resolve against, so the
 * readers there are named individually, with what checks each one.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderAlertEmail } from '../packages/notify/src/index.ts';
import { badgeStatus, liveBadgeList, type BadgeRow } from '../packages/badge/src/index.ts';
import { withoutComments } from './setup/source.ts';
import { hostOf, siteOriginFor, verifyOriginFor } from '../apps/web/lib/verify-origin.ts';

const ORIGIN_VARIABLE =
  /process\.env\.NEXT_PUBLIC_(?:SITE|VERIFY)_URL|env\.NEXT_PUBLIC_(?:SITE|VERIFY)_URL/;

function sourceFilesUnder(root: string): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue;
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx|mts)$/.test(entry)) found.push(path);
    }
  };
  walk(root);
  return found;
}

function filesReadingTheOriginVariables(root: string): string[] {
  const files = sourceFilesUnder(root);
  // A population of none would make every claim below pass by having nothing
  // to say. Four is well under the real count and will survive any tidy-up.
  expect(files.length, `nothing to read under ${root}`).toBeGreaterThan(4);
  return files
    .filter((path) => ORIGIN_VARIABLE.test(withoutComments(readFileSync(path, 'utf8'))))
    .map((path) => relative(root, path))
    .sort();
}

describe('who reads the origin variables', () => {
  it('matches a raw read when it sees one', () => {
    // The positive control. A sweep that found nothing because its pattern was
    // wrong would read exactly like a sweep that found nothing because the
    // code is clean, and this is the whole value of the test.
    expect(ORIGIN_VARIABLE.test("const o = process.env.NEXT_PUBLIC_SITE_URL ?? '';")).toBe(true);
    expect(ORIGIN_VARIABLE.test('const o = env.NEXT_PUBLIC_VERIFY_URL;')).toBe(true);
    expect(ORIGIN_VARIABLE.test('const o = await resolveSiteOrigin();')).toBe(false);
  });

  it('is one file in the web app, and that file is the resolver', () => {
    /*
     * Not an allowlist that happens to be complete: a request is available on
     * every path in this app, so there is no second legitimate reader to add.
     *
     * The first version of this fix left four routes reading the variables and
     * passing them to `originFrom`, which is correct behaviour and a claim
     * nobody can check by looking in one place. This test failed on it, which
     * is how `verifyOriginFor` came to take only the host.
     */
    expect(filesReadingTheOriginVariables('apps/web')).toEqual(['lib/verify-origin.ts']);
  });

  it('is three named files in the worker, because there is no request there', () => {
    /*
     * The worker cannot ask what host it was reached on; nothing reaches it.
     * So the rule it applies instead is `announcementOrigin`: https or null,
     * with the null said out loud. These three are the readers, and the reason
     * each one is allowed to read is in the message beside it — if a fourth
     * appears, this fails and somebody decides on purpose.
     */
    expect(
      filesReadingTheOriginVariables('apps/worker'),
      'badge.ts holds announcementOrigin (https or null); main.ts reports the raw value as a ' +
        'startup warning on purpose; email.ts passes it to a renderer that checks it is followable',
    ).toEqual(['src/badge.ts', 'src/email.ts', 'src/main.ts']);
  });

  it('is nothing at all in the packages', () => {
    // A package reading the deployment's environment would be a second rule in
    // a place neither app can see.
    expect(filesReadingTheOriginVariables('packages')).toEqual([]);
  });
});

describe('the badge surfaces a stranger reads', () => {
  const row: BadgeRow = {
    public_id: 'pub-1',
    slug: 'an-app',
    status: 'active',
    app_name: 'An App',
    certified_origin: 'https://customer.example',
    rubric_version: '1.0.0',
    assessed_at: '2026-10-01T00:00:00.000Z',
    expires_at: null,
  };

  it('builds an absolute verification page from a resolved origin', () => {
    expect(badgeStatus(row, 'https://vibefycode.com').verificationPage).toBe(
      'https://vibefycode.com/a/an-app',
    );
    expect(liveBadgeList([row], 'https://vibefycode.com').badges[0]?.verificationPage).toBe(
      'https://vibefycode.com/a/an-app',
    );
  });

  it('would have built a relative one from the empty string, which is what the routes were passing', () => {
    // Characterising it rather than fixing it here: these two take whatever the
    // route hands them, and a package cannot tell a bad origin from a deliberate
    // one. The fix is that no route hands them anything unresolved, which is
    // what the sweep above holds.
    expect(badgeStatus(row, '').verificationPage).toBe('/a/an-app');
  });
});

describe('an alert email with no origin to link to', () => {
  const alert = {
    alertId: 'alert-1',
    kind: 'critical_finding',
    severity: 'critical' as const,
    title: 'A critical finding in An App',
    body: 'One sentence about it.',
    appName: 'An App',
    recipientEmail: 'owner@customer.example',
  };

  it('says where to look instead of linking nowhere', () => {
    const message = renderAlertEmail({ ...alert, consoleUrl: '', deepLink: null });
    expect(message.html, 'a relative href is dead text in every mail client').not.toMatch(
      /href="\/[^/]/,
    );
    expect(message.text).not.toMatch(/Open it: \//);
    expect(message.text).toContain('waiting under Alerts in the VibefyCode console');
  });

  it('keeps the preference instruction true, which is the only control there is', () => {
    // The footer's own comment says there is no unsubscribe link because the
    // control is in the console and this sentence says where. Pointed at
    // `/console/privacy` with nothing in front of it, that sentence was false.
    const message = renderAlertEmail({ ...alert, consoleUrl: '', deepLink: null });
    expect(message.text).not.toContain('reach you at /console/privacy');
    expect(message.text).toContain('under Privacy in the VibefyCode console');
  });

  it('checks the deep link too, not just the fallback', () => {
    // The caller builds `${consoleUrl}/console/reports/<id>`, so an empty
    // origin makes the deep link relative before this function ever sees a
    // fallback. Defending only the fallback is the half-fix that reads as done.
    const message = renderAlertEmail({
      ...alert,
      consoleUrl: '',
      deepLink: '/console/reports/assessment-1',
    });
    expect(message.html).not.toMatch(/href="\/console/);
    expect(message.text).not.toContain('Open it: /console/reports');
  });

  it('links when it has somewhere to link', () => {
    const message = renderAlertEmail({
      ...alert,
      consoleUrl: 'https://vibefycode.com',
      deepLink: 'https://vibefycode.com/console/reports/assessment-1',
    });
    expect(message.html).toContain('href="https://vibefycode.com/console/reports/assessment-1"');
    expect(message.text).toContain('reach you at https://vibefycode.com/console/privacy');
  });
});

describe('the one reader, asked directly', () => {
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

  it('prefers the forwarded host, because that is the one a proxy sets', () => {
    // Written out at five call sites before this existed, which is five
    // chances to read only `host` — and behind Vercel `host` is the internal
    // name, so the badge would advertise a verification URL nobody can reach.
    expect(
      hostOf({
        headers: {
          get: (name) =>
            ({ 'x-forwarded-host': 'vibefycode.com', host: 'internal-1' })[name] ?? null,
        },
      }),
    ).toBe('vibefycode.com');
  });

  it('falls back to the host header when nothing is forwarded', () => {
    expect(
      hostOf({ headers: { get: (name) => (name === 'host' ? 'localhost:3000' : null) } }),
    ).toBe('localhost:3000');
  });

  it('reads the badge variable first for a verification origin', () => {
    withEnvironment(
      {
        NEXT_PUBLIC_VERIFY_URL: 'https://verify.vibefycode.com',
        NEXT_PUBLIC_SITE_URL: 'https://app.vibefycode.com',
      },
      () => {
        expect(verifyOriginFor('ignored.example')).toBe('https://verify.vibefycode.com');
      },
    );
  });

  it('never reads the badge variable for a console link', () => {
    /*
     * The two are separable on purpose: a deployment may serve badges from a
     * hostname of its own. If this consulted `NEXT_PUBLIC_VERIFY_URL` then a
     * workspace invitation and a checkout return would be sent to the badge
     * host, where there is no console to arrive in — and the invitation link
     * is the only copy of its token.
     */
    withEnvironment(
      {
        NEXT_PUBLIC_VERIFY_URL: 'https://verify.vibefycode.com',
        NEXT_PUBLIC_SITE_URL: 'https://app.vibefycode.com',
      },
      () => {
        expect(siteOriginFor('ignored.example')).toBe('https://app.vibefycode.com');
      },
    );
  });

  it('uses the request host for a console link when nothing is configured', () => {
    withEnvironment({ NEXT_PUBLIC_VERIFY_URL: undefined, NEXT_PUBLIC_SITE_URL: undefined }, () => {
      expect(siteOriginFor('app.vibefycode.com')).toBe('https://app.vibefycode.com');
    });
  });
});
