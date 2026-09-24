/**
 * Our own accessibility.
 *
 * PART 8.3, in the brief's own words: WCAG 2.2 AA both as a rubric dimension
 * *and* for our own product, because it is hard to sell an accessibility score
 * from an inaccessible dashboard. We score other people on this. Until this file
 * existed we had never run a scan against anything we ship.
 *
 * The same caveat we print in every report applies to us: an automated scan
 * finds a minority of real barriers. A clean run here is a floor, not a claim,
 * and it is written down as such rather than quietly treated as a pass.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderReport, type ReportSource } from '../packages/report/src/index.ts';
import { renderBadgeSvg, type BadgeStatus } from '../packages/badge/src/index.ts';
import { renderAlertEmail } from '../packages/notify/src/index.ts';
import { auditHtml, closeAxeBrowser, describe as explain } from './setup/axe.ts';
import {
  MUST_CONTAIN,
  SEEDED_ROUTES,
  matchesSeededRoute,
  scannedTheWrongPage,
  seedVerificationPage,
} from '../tools/a11y-contract.mts';
import { connect } from './setup/client.ts';

afterAll(async () => {
  await closeAxeBrowser();
});

const source: ReportSource = {
  assessmentId: 'a1',
  appName: 'Kettle',
  appUrl: 'https://kettle.example',
  organisationName: 'Kettle Ltd',
  rubricVersion: '1.0.0',
  assessedOn: '2026-08-22',
  reviewedOn: '2026-08-23',
  overallScore: 63.5,
  band: 'Adequate',
  certificationEligible: false,
  certificationBlockers: ['Security posture is below the floor for certification.'],
  dimensions: [
    {
      dimension: 'security_posture',
      label: 'Security posture',
      score: 58,
      weight: 0.25,
      band: 'Weak',
    },
    {
      dimension: 'practicality_ux',
      label: 'Practicality and UX',
      score: 71,
      weight: 0.15,
      band: 'Adequate',
    },
  ],
  findings: [
    {
      id: 'f1',
      ruleId: 'SEC-02',
      dimension: 'security_posture',
      severity: 'high',
      confidence: 'high',
      title: 'Session cookie is readable by script',
      description: 'The session cookie is set without the HttpOnly attribute on every route seen.',
      remediation: 'Set HttpOnly and SameSite on the session cookie, then re-test.',
      evidence: [
        {
          id: 'e1',
          kind: 'http_exchange',
          sha256: 'a'.repeat(64),
          capturedAt: '2026-08-22T10:00:00Z',
          summary: 'Set-Cookie observed on /login',
        },
      ],
    },
  ],
  narrative: {
    headline: 'Works, with a session-handling problem worth fixing first.',
    summary: 'The core flows complete. One finding concerns how the session cookie is set.',
    strengths: ['Core purchase flow completes without error.'],
    prioritisedRemediation: [
      {
        order: 1,
        title: 'Set HttpOnly on the session cookie',
        why: 'A cookie readable by script is a cookie an injected script can take.',
        step: 'Add HttpOnly and SameSite=Lax where the session cookie is set, then re-test.',
      },
    ],
    notAssessed: ['Anything behind the paywall, which the authorised scope did not cover.'],
  },
  notTested: [],
  stages: [{ stage: 'deterministic', status: 'completed', notes: ['12 checks run'] }],
  scopeStatement:
    'This assessment covered the web application at kettle.example on 2026-08-22, within the scope its owner authorised. It is point-in-time and scope-limited.',
  promptBundleSha256: 'c'.repeat(64),
  intendedForAppStore: false,
};

describe('the report a customer hands to someone else', () => {
  it.each(['free', 'paid'] as const)(
    'has no WCAG 2.2 AA violations at the %s tier',
    async (tier) => {
      const { violations, passes } = await auditHtml(renderReport(source, tier).html);
      expect(violations, `\n${explain(violations)}\n`).toEqual([]);
      // "Zero violations" and "the scan never ran" look identical otherwise.
      expect(passes).toBeGreaterThan(10);
    },
  );
});

describe('the badge, where it actually lives', () => {
  // An <img> on somebody else's page, so what matters is the accessible name
  // the surrounding markup gives it and that the SVG itself announces something.
  it.each(['active', 'suspended', 'expired', 'revoked'] as BadgeStatus[])(
    'the %s badge announces itself and violates nothing',
    async (status) => {
      const svg = renderBadgeSvg({ status });
      const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Badge</title></head>
        <body><main><h1>Verification</h1>${svg}</main></body></html>`;
      const { violations, passes } = await auditHtml(page);
      expect(violations, `\n${explain(violations)}\n`).toEqual([]);
      expect(passes).toBeGreaterThan(5);
      expect(svg).toMatch(/role="img"/);
      expect(svg).toMatch(/aria-label="[^"]{20,}"/);
    },
  );

  it('the compact badge announces the same thing as the full seal', async () => {
    const compact = renderBadgeSvg({ status: 'active', sizePx: 96 });
    const { violations } = await auditHtml(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Badge</title></head><body><main><h1>Verification</h1>${compact}</main></body></html>`,
    );
    expect(violations, `\n${explain(violations)}\n`).toEqual([]);
  });
});

describe('the alert email', () => {
  it('has no violations, in a client that renders it as a document', async () => {
    const message = renderAlertEmail({
      alertId: 'a1',
      kind: 'material_regression',
      severity: 'critical',
      title: 'Kettle: material change found at re-assessment',
      body: 'The latest assessment found changes that fall outside what its verification covered.',
      appName: 'Kettle',
      consoleUrl: 'https://vibefycode.example',
      recipientEmail: 'owner@example.test',
      deepLink: 'https://vibefycode.example/console/reports/a1',
    });
    const { violations } = await auditHtml(message.html);
    expect(violations, `\n${explain(violations)}\n`).toEqual([]);
  });
});

describe('the guard that says we scanned the right page', () => {
  /*
   * The scan visits addresses and trusts what comes back. That is fine until an
   * address stops being the page it was: a slug that no longer resolves renders
   * the not-found page, which is deliberately accessible and passes cleanly. The
   * run goes green, the count stays the same, and the page a stranger actually
   * lands on has not been looked at for weeks.
   *
   * So the guard is watched failing here rather than trusted. It has never once
   * fired in a real run, which is exactly the problem with it.
   */
  const stub = (status: number, body: string): typeof fetch =>
    (async () => new Response(body, { status })) as unknown as typeof fetch;

  it('is quiet when the page carries what it should', async () => {
    const complaint = await scannedTheWrongPage(
      'http://x',
      '/a/abc',
      'What was checked',
      stub(200, '<h2>What was checked</h2>'),
    );
    expect(complaint).toBeNull();
  });

  it('complains when the page is fine but is the wrong page', async () => {
    // The whole point: HTTP 200, valid HTML, accessible — and not our page.
    const complaint = await scannedTheWrongPage(
      'http://x',
      '/a/abc',
      'What was checked',
      stub(200, '<h1>We could not find that</h1>'),
    );
    expect(complaint).toContain('/a/abc');
    expect(complaint).toContain('wrong page');
  });

  it('complains when the page is missing, rather than scanning a 404 body', async () => {
    const complaint = await scannedTheWrongPage(
      'http://x',
      '/a/abc',
      'What was checked',
      stub(404, 'What was checked'),
    );
    expect(complaint).toContain('404');
  });

  it('complains when the page could not be reached at all', async () => {
    const refuse = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const complaint = await scannedTheWrongPage('http://x', '/a/abc', 'What was checked', refuse);
    expect(complaint).toContain('ECONNREFUSED');
  });

  it('stays out of the way of pages that declared nothing to look for', async () => {
    const never = (() => {
      throw new Error('should not have been fetched');
    }) as unknown as typeof fetch;
    expect(await scannedTheWrongPage('http://x', '/how-it-works', undefined, never)).toBeNull();
  });

  it('is asked for on the pages whose absence would be invisible', () => {
    // The directory renders its error page when the database is behind, and an
    // error page has no heading — two violations about a page that was never
    // the point. The guard turns that into the truth: we scanned the wrong thing.
    expect(Object.keys(MUST_CONTAIN)).toContain('/directory');
  });
});

describe('the verification page is really in the scan', () => {
  let db: Client;

  beforeAll(async () => {
    db = await connect();
  });

  afterAll(async () => {
    await db?.end();
  });

  it('seeds a badge whose page matches the route the coverage test counts', async () => {
    /*
     * `SEEDED_ROUTES` is how the coverage test above believes /a/[slug] is
     * scanned, and nothing else checks that belief. Change the slug column or
     * move the page, and the scan carries on seeding something while the
     * coverage test carries on excusing the route — both halves correct, the
     * page unscanned and nobody told.
     */
    const page = await seedVerificationPage(db);
    expect(
      matchesSeededRoute(page),
      `${page} is not an instance of ${SEEDED_ROUTES.join(', ')}`,
    ).toBe(true);
    // And it must arrive with something to check for, or the scan would accept
    // the not-found page as proof it had looked at the real one.
    expect(MUST_CONTAIN[page]).toBeTruthy();
  });
});

describe('the scan keeps up with the pages', () => {
  /*
   * Two public pages shipped unscanned this week, and neither was an oversight
   * anybody could have caught: the list of pages `check:a11y` visits is written
   * by hand, and nothing anywhere said it was supposed to match the routes that
   * exist. The person who adds the next page will forget too.
   *
   * So the routes are enumerated from the filesystem and every public one has
   * to be either scanned or excused in writing. A page cannot ship unscanned by
   * accident any more — only on purpose, with a reason somebody wrote down.
   */
  const appDir = join(process.cwd(), 'apps/web/app');

  /** Every route with a page, as a URL path. */
  const routes = (() => {
    const found: string[] = [];
    const walk = (dir: string, prefix: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          // Route groups and private folders contribute no path segment.
          const segment =
            entry.name.startsWith('(') || entry.name.startsWith('_')
              ? prefix
              : `${prefix}/${entry.name}`;
          walk(join(dir, entry.name), segment);
        } else if (entry.name === 'page.tsx') {
          found.push(prefix === '' ? '/' : prefix);
        }
      }
    };
    walk(appDir, '');
    return found.sort();
  })();

  /** Behind a sign-in, so the scanner cannot reach them without a session. */
  const AUTHENTICATED = /^\/(console|admin|review)(\/|$)/;

  /** `/legal/[slug]` as a pattern that `/legal/badge-licence` satisfies. */
  const asPattern = (route: string) => new RegExp(`^${route.replace(/\[[^\]]+\]/g, '[^/]+')}$`);

  /**
   * Public, reachable, and deliberately not scanned. Each one needs a reason,
   * because a bare exemption is how a list like this fills up.
   */
  const EXCUSED: Readonly<Record<string, string>> = {
    '/sign-up': 'Scanned as /sign-in, which is the same form component with a different heading.',
    '/invite/[token]':
      'Needs a live invitation token, which does not exist outside a seeded database.',
    '/auth/new-password':
      'Redirects to /forgot-password without a session, so a scan of it scans that page. Its form is the same component the sign-in page is scanned with.',
    '/auth/accept':
      'Redirects to /sign-in without a session, so a scan of it scans that page. It is reached only from the auth callback, by an account that has just been created and has no acceptance on record.',
  };

  const scanned = (() => {
    const source = readFileSync(join(process.cwd(), 'tools/a11y-scan.mts'), 'utf8');
    const block = /const PAGES = \[([\s\S]*?)\]/.exec(source);
    if (!block) throw new Error('a11y-scan no longer has a PAGES list');
    const literal = [...block[1]!.matchAll(/'([^']+)'/g)].map((match) => match[1]!);
    // The verification page has no literal URL — it exists only once a badge is
    // seeded — so the scan pushes it onto the list at run time. Counting it here
    // is the point of SEEDED_ROUTES: a route scanned by a mechanism this test
    // knows nothing about is a route that can stop being scanned in silence.
    return [...literal, ...SEEDED_ROUTES];
  })();

  it('found the routes it is talking about', () => {
    // If this ever returns nothing the rest of the block passes vacuously,
    // which is the worst outcome available.
    expect(routes.length).toBeGreaterThan(20);
    expect(routes).toContain('/advertise');
  });

  it('scans every public page, or says in writing why not', () => {
    // A dynamic route counts as scanned when a concrete instance of it is in
    // the list: /legal/[slug] is covered by /legal/badge-licence.
    const missed = routes.filter(
      (route) =>
        !AUTHENTICATED.test(route) &&
        !(route in EXCUSED) &&
        !scanned.some((page) => asPattern(route).test(page)),
    );
    expect(
      missed,
      `Public pages nobody scans: ${missed.join(', ')}. Add them to PAGES in tools/a11y-scan.mts, or excuse them in this test with a reason.`,
    ).toEqual([]);
  });

  it('does not excuse a page without a reason', () => {
    for (const [route, reason] of Object.entries(EXCUSED)) {
      expect(reason.length, route).toBeGreaterThan(20);
    }
  });

  it('does not scan a page that no longer exists', () => {
    // The other direction, which fails quietly: a route deleted in a refactor
    // leaves the scanner asking for a 404 and reporting it as clean.
    const gone = scanned.filter(
      (page) =>
        page !== '/not-a-page-that-exists' && !routes.some((route) => asPattern(route).test(page)),
    );
    expect(gone, `Scanned routes with no page: ${gone.join(', ')}`).toEqual([]);
  });
});
