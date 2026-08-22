/**
 * Policy profiles.
 *
 * The claim this file defends: an organisation's own bar is applied *over* a
 * score, never *to* it. A profile can fail an application the rubric passed —
 * that is what it is for — and there is no path by which it can do the reverse.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluatePolicy, POLICY_NOTE, type PolicyProfile, type PolicySubject } from '../packages/policy/src/index.ts';

const STRICT: PolicyProfile = {
  id: 'p1',
  name: 'Internal release bar',
  description: null,
  minOverallScore: 80,
  dimensionFloors: { security_posture: 75, data_privacy_practice: 70 },
  maxOpenSeverity: 'medium',
  requireCertification: true,
  requireStoreReadiness: false,
};

const OPEN: PolicyProfile = {
  id: 'p2',
  name: 'Anything goes',
  description: null,
  minOverallScore: null,
  dimensionFloors: {},
  maxOpenSeverity: null,
  requireCertification: false,
  requireStoreReadiness: false,
};

function subject(overrides: Partial<PolicySubject> = {}): PolicySubject {
  return {
    assessmentId: 'a1',
    overallScore: 88,
    certificationEligible: true,
    dimensions: [
      { dimension: 'security_posture', score: 84 },
      { dimension: 'data_privacy_practice', score: 79 },
    ],
    openFindings: [],
    intendedForAppStore: false,
    ...overrides,
  };
}

describe('a profile measures, it does not score', () => {
  it('passes an assessment that clears every floor', () => {
    const evaluation = evaluatePolicy(STRICT, subject());
    expect(evaluation.meetsPolicy).toBe(true);
    expect(evaluation.failures).toEqual([]);
    expect(evaluation.note).toBe(POLICY_NOTE);
  });

  it('fails an application the rubric certified, when the organisation asks for more', () => {
    // 74 is above the rubric's certification threshold of 70 and below this
    // organisation's 80. Both statements are true at once, which is the point.
    const evaluation = evaluatePolicy(STRICT, subject({ overallScore: 74 }));
    expect(evaluation.meetsPolicy).toBe(false);
    expect(evaluation.failures.map((failure) => failure.rule)).toContain('min_overall_score');
    expect(evaluation.failures[0]!.explanation).toMatch(/74\.0.*80\.0/);
  });

  it('never passes an application the rubric failed on certification when the profile requires it', () => {
    const evaluation = evaluatePolicy(STRICT, subject({ certificationEligible: false }));
    expect(evaluation.failures.map((failure) => failure.rule)).toContain('require_certification');
  });

  it('treats an unscored dimension as a failure, not a pass', () => {
    const evaluation = evaluatePolicy(STRICT, subject({ dimensions: [] }));
    const explanations = evaluation.failures.map((failure) => failure.explanation).join(' ');
    expect(explanations).toMatch(/security posture was not scored/);
    expect(explanations).toMatch(/data privacy practice was not scored/);
  });

  it('counts open findings above the permitted ceiling', () => {
    const evaluation = evaluatePolicy(
      STRICT,
      subject({
        openFindings: [
          {
            ruleId: 'SEC-02',
            dimension: 'security_posture',
            severity: 'high',
            title: 'Session cookie readable by script',
          },
          { ruleId: 'UX-01', dimension: 'practicality_ux', severity: 'low', title: 'Small tap target' },
        ],
      }),
    );
    const failure = evaluation.failures.find((entry) => entry.rule === 'max_open_severity');
    expect(failure?.explanation).toMatch(/1 open finding above the permitted medium ceiling/);
    expect(failure?.explanation).toMatch(/Session cookie readable by script/);
  });

  it('reports every failure, so nobody fixes one and wonders why it is still red', () => {
    const evaluation = evaluatePolicy(
      STRICT,
      subject({
        overallScore: 40,
        certificationEligible: false,
        dimensions: [
          { dimension: 'security_posture', score: 30 },
          { dimension: 'data_privacy_practice', score: 20 },
        ],
      }),
    );
    expect(evaluation.failures.length).toBe(4);
  });

  it('is a no-op when the profile asks for nothing', () => {
    expect(evaluatePolicy(OPEN, subject({ overallScore: 1 })).meetsPolicy).toBe(true);
  });

  it('does not depend on the order of the dimensions it is given', () => {
    const forwards = evaluatePolicy(STRICT, subject());
    const backwards = evaluatePolicy(
      STRICT,
      subject({
        dimensions: [
          { dimension: 'data_privacy_practice', score: 79 },
          { dimension: 'security_posture', score: 84 },
        ],
      }),
    );
    expect(backwards).toEqual(forwards);
  });
});

describe('the evaluation cannot carry a score back', () => {
  it('returns no field through which a score could be changed', () => {
    const evaluation = evaluatePolicy(STRICT, subject({ overallScore: 40 }));
    const keys = new Set(Object.keys(evaluation));
    for (const forbidden of [
      'overallScore',
      'score',
      'adjustedScore',
      'scoreAdjustment',
      'band',
      'certificationEligible',
    ]) {
      expect(keys.has(forbidden), `an evaluation must not carry "${forbidden}"`).toBe(false);
    }
  });

  it('is not reachable from the scoring package', () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), 'packages/rubric/package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })).not.toContain(
      '@vibefy/policy',
    );
  });

  it('never appears in the score fingerprint of a report', async () => {
    // Two identical assessments, one with a policy attached and one without,
    // must fingerprint identically — otherwise the profile has touched the score.
    const { renderReport } = await import('../packages/report/src/index.ts');
    const base = {
      assessmentId: 'a',
      appName: 'Kettle',
      appUrl: 'https://kettle.example',
      organisationName: 'Kettle Ltd',
      rubricVersion: '1.0.0',
      assessedOn: '2026-08-22',
      reviewedOn: null,
      overallScore: 63.5,
      band: 'Adequate',
      certificationEligible: false,
      certificationBlockers: [],
      dimensions: [],
      findings: [],
      narrative: null,
      stages: [],
      scopeStatement: 'x'.repeat(120),
      promptBundleSha256: 'c'.repeat(64),
      intendedForAppStore: false,
    } as const;

    const fingerprint = (html: string) =>
      /vibefy-score-fingerprint" content="([^"]+)"/.exec(html)?.[1];

    const plain = renderReport(base, 'paid');
    const withPolicy = renderReport(
      {
        ...base,
        policy: {
          profileName: 'Internal release bar',
          meetsPolicy: false,
          failures: ['Scored 63.5 against a required minimum of 80.0.'],
          note: POLICY_NOTE,
        },
      },
      'paid',
    );

    expect(fingerprint(withPolicy.html)).toBe(fingerprint(plain.html));
    expect(withPolicy.html).toContain('Internal release bar');
    expect(withPolicy.html).toContain('Does not meet your policy.');
  });
});
