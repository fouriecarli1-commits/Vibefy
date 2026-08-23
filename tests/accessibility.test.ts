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
import { afterAll, describe, expect, it } from 'vitest';
import { renderReport, type ReportSource } from '../packages/report/src/index.ts';
import { renderBadgeSvg, type BadgeStatus } from '../packages/badge/src/index.ts';
import { renderAlertEmail } from '../packages/notify/src/index.ts';
import { auditHtml, closeAxeBrowser, describe as explain } from './setup/axe.ts';

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
  stages: [{ stage: 'deterministic', status: 'completed', notes: ['12 checks run'] }],
  scopeStatement:
    'This assessment covered the web application at kettle.example on 2026-08-22, within the scope its owner authorised. It is point-in-time and scope-limited.',
  promptBundleSha256: 'c'.repeat(64),
  intendedForAppStore: false,
};

describe('the report a customer hands to someone else', () => {
  it.each(['free', 'paid'] as const)('has no WCAG 2.2 AA violations at the %s tier', async (tier) => {
    const { violations, passes } = await auditHtml(renderReport(source, tier).html);
    expect(violations, `\n${explain(violations)}\n`).toEqual([]);
    // "Zero violations" and "the scan never ran" look identical otherwise.
    expect(passes).toBeGreaterThan(10);
  });
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
