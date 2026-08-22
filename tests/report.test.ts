/**
 * Reports.
 *
 * The property that matters most here is what the tier does *not* change. A free
 * report is thinner than a paid one; it is not a different assessment, and it
 * must not read as one.
 */
import { describe, expect, it } from 'vitest';
import {
  redactForTier,
  renderReport,
  scoreFingerprint,
  sortFindings,
  type ReportFinding,
  type ReportSource,
} from '../packages/report/src/index.ts';

const finding = (over: Partial<ReportFinding> = {}): ReportFinding => ({
  id: `f-${over.ruleId ?? 'SEC-02'}`,
  ruleId: 'SEC-02',
  dimension: 'security_posture',
  severity: 'medium',
  confidence: 'high',
  title: 'Missing Content-Security-Policy header',
  description:
    'The application responds without a Content-Security-Policy header on any assessed route.',
  remediation:
    'Add a Content-Security-Policy header, starting in report-only mode, then tighten it.',
  evidence: [
    {
      id: 'e-1',
      kind: 'header_scan',
      summary: 'GET / → 200, response headers',
      sha256: 'a'.repeat(64),
      capturedAt: '2026-08-22T10:00:00.000Z',
    },
  ],
  ...over,
});

const source: ReportSource = {
  assessmentId: '11111111-2222-3333-4444-555555555555',
  appName: 'Kettle',
  appUrl: 'https://kettle.example',
  organisationName: 'Kettle Ltd',
  rubricVersion: '1.0.0',
  assessedOn: '2026-08-22',
  reviewedOn: '2026-08-22',
  overallScore: 46.25,
  band: 'Weak',
  certificationEligible: false,
  certificationBlockers: ['GATE-CRITICAL-SECURITY: Critical security or privacy finding'],
  dimensions: [
    {
      dimension: 'functional_integrity',
      label: 'Functional integrity',
      score: 92,
      weight: 0.25,
      band: 'Exemplary',
    },
    {
      dimension: 'security_posture',
      label: 'Security posture',
      score: 11,
      weight: 0.25,
      band: 'Not ready',
    },
    {
      dimension: 'data_privacy_practice',
      label: 'Data & privacy practice',
      score: 70,
      weight: 0.15,
      band: 'Adequate',
    },
    {
      dimension: 'practicality_ux',
      label: 'Practicality & UX',
      score: 78,
      weight: 0.15,
      band: 'Strong',
    },
    {
      dimension: 'production_readiness',
      label: 'Production readiness',
      score: 88,
      weight: 0.1,
      band: 'Strong',
    },
    {
      dimension: 'store_distribution_readiness',
      label: 'Store & distribution readiness',
      score: 65,
      weight: 0.1,
      band: 'Adequate',
    },
  ],
  findings: [
    finding({
      ruleId: 'SEC-04',
      severity: 'critical',
      title: 'A Stripe live key is served to the browser',
    }),
    finding({
      ruleId: 'SEC-05',
      severity: 'high',
      title: 'The admin dashboard renders for anyone who visits it',
    }),
    finding({ ruleId: 'SEC-02', severity: 'medium' }),
    finding({
      ruleId: 'UX-02',
      severity: 'medium',
      dimension: 'practicality_ux',
      title: 'The page scrolls horizontally at 390px',
    }),
    finding({
      ruleId: 'FI-05',
      severity: 'low',
      dimension: 'functional_integrity',
      title: 'The orders page has no empty state',
    }),
  ],
  narrative: {
    headline:
      'Kettle works as a shop, but it is serving an admin page and a live payment key to anyone who asks.',
    summary:
      'The core purchase flow completes and the interface is clear. Underneath it, authorisation is enforced in the browser rather than on the server.',
    strengths: ['The sign-up flow completes without friction and returns a clear confirmation.'],
    prioritisedRemediation: [
      {
        order: 1,
        title: 'Rotate the exposed Stripe key',
        why: 'Anyone who has loaded the page can charge cards as you.',
        step: 'Roll the key in the Stripe dashboard, then move the call that needs it to a server route.',
      },
    ],
    notAssessed: ['The payment flow was not exercised, because that would require a real card.'],
  },
  stages: [
    { stage: 'deterministic_checks', status: 'succeeded', notes: [] },
    { stage: 'store_readiness', status: 'skipped', notes: ['Not intended for an app store.'] },
  ],
  scopeStatement:
    'This assessment is a point-in-time, scope-limited, AI-assisted and human-reviewed evaluation of Kettle, conducted by Vibefy against published Vibefy Rubric version 1.0.0 on 2026-08-22. It is not a penetration test, a security audit, a code audit, a legal or regulatory compliance certification, or a guarantee of any kind. Absence of a finding is not evidence of absence of a defect.',
  promptBundleSha256: 'b'.repeat(64),
  intendedForAppStore: true,
};

describe('what payment does not buy', () => {
  it('renders the identical score at both tiers', () => {
    const free = renderReport(source, 'free');
    const paid = renderReport(source, 'paid');
    const fingerprint = (html: string) =>
      /vibefy-score-fingerprint" content="([^"]+)"/.exec(html)?.[1];

    expect(fingerprint(free.html)).toBe(fingerprint(paid.html));
    expect(free.html).toContain('46.3');
    expect(paid.html).toContain('46.3');
  });

  it('shows the full dimension breakdown on a free report, because hiding the rubric would look like hiding the rubric', () => {
    const free = renderReport(source, 'free');
    for (const dimension of source.dimensions) {
      // Labels are escaped on the way out — "Data & privacy practice" appears as
      // "Data &amp; privacy practice", which is the renderer behaving correctly.
      expect(free.html, dimension.label).toContain(dimension.label.replace(/&/g, '&amp;'));
      expect(free.html).toContain(dimension.score.toFixed(1));
    }
  });

  it('says on the free report that the score is the same either way', () => {
    expect(renderReport(source, 'free').html).toMatch(
      /score is not affected by which report you buy/i,
    );
  });
});

describe('what payment does buy', () => {
  it('limits a free report to the three most serious findings', () => {
    const view = redactForTier(source, 'free');
    expect(view.findings).toHaveLength(3);
    expect(view.findings.map((f) => f.severity)).toEqual(['critical', 'high', 'medium']);
    expect(view.hiddenFindingCount).toBe(2);
  });

  it('strips evidence and remediation from the objects, not just from the template', () => {
    const view = redactForTier(source, 'free');
    for (const item of view.findings) {
      expect(item.evidence).toHaveLength(0);
      expect(item.remediation).toBe('');
    }
  });

  it('never leaks an evidence hash or a remediation step into free HTML', () => {
    const free = renderReport(source, 'free').html;
    expect(free).not.toContain('a'.repeat(12));
    expect(free).not.toMatch(/report-only mode/);
    expect(free).not.toMatch(/Roll the key in the Stripe dashboard/);
  });

  it('includes all of it on a paid report', () => {
    const paid = renderReport(source, 'paid').html;
    expect(paid).toContain('report-only mode');
    expect(paid).toContain('Roll the key in the Stripe dashboard');
    expect(paid).toContain('header scan');
    expect(paid).toContain('The orders page has no empty state');
  });

  it('tells a free customer exactly what is withheld', () => {
    const free = renderReport(source, 'free');
    expect(free.withheld.join(' ')).toMatch(/evidence/i);
    expect(free.withheld.join(' ')).toMatch(/remediation/i);
    expect(free.withheld.join(' ')).toMatch(/PDF/);
  });
});

describe('what no tier may withhold', () => {
  it.each(['free', 'paid'] as const)('carries the scope statement on a %s report', (tier) => {
    const html = renderReport(source, tier).html;
    expect(html).toContain('point-in-time, scope-limited');
    expect(html).toContain('not a penetration test');
    expect(html).toContain('Absence of a finding is not evidence of absence of a defect');
  });

  it.each(['free', 'paid'] as const)('says what was not assessed on a %s report', (tier) => {
    const html = renderReport(source, tier).html;
    expect(html).toContain('What was not assessed');
    expect(html).toContain('would require a real card');
    expect(html).toMatch(/store readiness stage did not complete/i);
  });

  it.each(['free', 'paid'] as const)(
    'carries the non-reliance legend and the AI disclosure on a %s report',
    (tier) => {
      const html = renderReport(source, tier).html;
      expect(html).toMatch(/No third party/);
      expect(html).toMatch(/AI output may contain errors/);
    },
  );

  it.each(['free', 'paid'] as const)(
    'names why certification was not reached on a %s report',
    (tier) => {
      expect(renderReport(source, tier).html).toContain('GATE-CRITICAL-SECURITY');
    },
  );
});

describe('the document itself', () => {
  it('is self-contained, so a PDF renders the same without a network', () => {
    const html = renderReport(source, 'paid').html;
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/src="https?:/i);
    expect(html).toContain('<style>');
  });

  it('escapes customer-supplied text rather than trusting it', () => {
    const hostile = renderReport(
      {
        ...source,
        appName: '<img src=x onerror=alert(1)>',
        findings: [finding({ title: '"><script>alert(1)</script>' })],
      },
      'paid',
    ).html;
    expect(hostile).not.toContain('<script>alert(1)</script>');
    expect(hostile).not.toContain('<img src=x');
    expect(hostile).toContain('&lt;img src=x');
  });

  it('orders findings by severity, then deterministically', () => {
    const sorted = sortFindings(source.findings);
    expect(sorted.map((f) => f.ruleId)).toEqual(['SEC-04', 'SEC-05', 'SEC-02', 'UX-02', 'FI-05']);
    expect(sortFindings([...source.findings].reverse()).map((f) => f.ruleId)).toEqual(
      sorted.map((f) => f.ruleId),
    );
  });

  it('fingerprints the score independently of the findings shown', () => {
    expect(scoreFingerprint(source)).toBe(scoreFingerprint({ ...source, findings: [] }));
  });
});
