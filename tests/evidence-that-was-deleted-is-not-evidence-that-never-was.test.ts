/**
 * A finding whose evidence the retention policy has deleted.
 *
 * `renderReport` printed the Evidence block when a finding had evidence and
 * nothing at all when it did not. After thirty days — the default in the
 * Privacy Policy — the retention sweep deletes the artefact, `finding_evidence`
 * cascades away, and that block simply stops appearing. The finding stays, and
 * a reader sees an assertion with nothing behind it and no way to tell "never
 * had evidence" from "we deleted it on the schedule we published".
 *
 * The product's position on that is written in two places. The migration that
 * created `finding_evidence` says "a finding that lost its evidence to a
 * data-modelling artefact is exactly the kind of finding we promise never to
 * publish", and the consumer check says "an observation without its evidence is
 * an assertion, and this product does not publish assertions about anybody".
 *
 * The sentence is possible because of a gate. `assert_findings_have_evidence`
 * refuses to move an assessment into `awaiting_review`, `approved` or
 * `published` while any published finding has none — so a published finding
 * with no evidence rows *had* evidence when the assessment was approved, and
 * the only thing that can have happened since is deletion. That is not an
 * inference about this report; it is a property of every report.
 *
 * `retention_deletions` keeps the hash for exactly this reason: "proof the
 * retention policy ran, with nothing left that the policy existed to remove."
 * Nothing read it.
 */
import { describe, expect, it } from 'vitest';
import { renderReport } from '../packages/report/src/render.ts';
import type { ReportSource } from '../packages/report/src/types.ts';

const BASE: ReportSource = {
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

const withFindings = (findings: ReportSource['findings']): ReportSource => ({
  ...BASE,
  findings,
});

const aFinding = (evidence: ReportSource['findings'][number]['evidence']) => ({
  ...BASE.findings[0]!,
  evidence,
});

describe('a paid report whose evidence is still held', () => {
  it('prints it', () => {
    const source = withFindings([
      aFinding([
        {
          id: 'ev-1',
          kind: 'http_exchange',
          sha256: 'a'.repeat(64),
          capturedAt: '2026-09-01T00:00:00Z',
          summary: 'The response to /',
        },
      ]),
    ]);
    const html = renderReport(source, 'paid').html;
    expect(html).toContain('Evidence.');
    expect(html).toContain('The response to /');
  });
});

describe('a paid report whose evidence the retention policy has deleted', () => {
  const html = () => renderReport(withFindings([aFinding([])]), 'paid').html;

  it('says so, rather than printing nothing', () => {
    expect(html()).toMatch(/no longer held/i);
  });

  it('says why, because the reader is owed the reason and not just the gap', () => {
    expect(html()).toMatch(/retention/i);
  });

  it('says the finding was evidenced, which is the distinction being drawn', () => {
    // Not "there is no evidence" but "there was, and it is gone". The first
    // reads as an assertion nobody stood behind; the second is what happened.
    expect(html()).toMatch(/every published finding is evidenced before/i);
    expect(html()).toMatch(/deleted/i);
  });
});

describe('a free report', () => {
  it('says nothing about evidence either way, because that is redaction and not absence', () => {
    // `showEvidence` is false for the free tier. A missing block there means
    // "not included in this tier", which the report says elsewhere in its own
    // words, and borrowing the retention sentence for it would be a lie.
    const html = renderReport(withFindings([aFinding([])]), 'free').html;
    expect(html).not.toMatch(/no longer held/i);
  });
});
