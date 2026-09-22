import { describe, expect, it } from 'vitest';
import { getRubric, listRubricVersions, rubricChecksum, CURRENT_RUBRIC_VERSION } from './rubric.ts';
import { scoreAssessment, UnscorableFindingError } from './scoring.ts';
import type { ScoringFinding, ScoringInput } from './types.ts';

const clean: ScoringInput = { rubricVersion: '1.0.0', findings: [], coreFlowsUnreachable: false };

const withFindings = (...findings: ScoringFinding[]): ScoringInput => ({
  ...clean,
  findings,
});

const finding = (over: Partial<ScoringFinding> = {}): ScoringFinding => ({
  ruleId: 'SEC-02',
  dimension: 'security_posture',
  severity: 'medium',
  confidence: 'high',
  isPublished: true,
  ...over,
});

describe('the rubric itself', () => {
  it('has six dimensions whose weights sum to exactly one', () => {
    const rubric = getRubric();
    expect(rubric.dimensions).toHaveLength(6);
    const total = rubric.dimensions.reduce((sum, d) => sum + d.weight, 0);
    expect(Number(total.toFixed(10))).toBe(1);
  });

  it('requires evidence for every criterion', () => {
    for (const dimension of getRubric().dimensions) {
      for (const criterion of dimension.criteria) {
        expect(
          criterion.requiredEvidence.length,
          `${criterion.id} has no evidence requirement`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('produces a stable checksum that key order cannot change', () => {
    expect(rubricChecksum()).toMatch(/^[0-9a-f]{64}$/);
    expect(rubricChecksum()).toBe(rubricChecksum(CURRENT_RUBRIC_VERSION));
  });

  it('refuses to score against a version it does not have', () => {
    expect(() => scoreAssessment({ ...clean, rubricVersion: '9.9.9' })).toThrow(
      /unknown rubric version/i,
    );
  });
});

describe('arithmetic', () => {
  it('scores a clean assessment at 100', () => {
    const result = scoreAssessment(clean);
    expect(result.overallScore).toBe(100);
    expect(result.band).toBe('Exemplary');
    expect(result.certificationEligible).toBe(true);
  });

  it('subtracts the severity penalty, scaled by confidence', () => {
    const high = scoreAssessment(withFindings(finding({ severity: 'high', confidence: 'high' })));
    const low = scoreAssessment(withFindings(finding({ severity: 'high', confidence: 'low' })));
    const security = (r: typeof high) =>
      r.dimensions.find((d) => d.dimension === 'security_posture')!;
    expect(security(high).score).toBe(78); // 100 − 22 × 1.0
    expect(security(low).score).toBe(91.2); // 100 − 22 × 0.4
  });

  it('ignores findings that were withheld for lack of evidence', () => {
    const withheld = scoreAssessment(
      withFindings(finding({ severity: 'critical', isPublished: false })),
    );
    expect(withheld.overallScore).toBe(100);
  });

  it('clamps a dimension at zero rather than going negative', () => {
    const battered = scoreAssessment(
      withFindings(
        ...Array.from({ length: 8 }, (_, index) =>
          finding({
            severity: 'critical',
            ruleId: `SEC-0${index % 9}`,
            dimension: 'practicality_ux',
          }),
        ),
      ),
    );
    expect(battered.dimensions.find((d) => d.dimension === 'practicality_ux')!.score).toBe(0);
  });
});

describe('gates', () => {
  it('caps the overall score when a critical security finding stands, whatever the rest scores', () => {
    const result = scoreAssessment(
      withFindings(finding({ severity: 'critical', ruleId: 'SEC-05' })),
    );
    expect(result.overallScore).toBeLessThanOrEqual(49);
    expect(result.certificationEligible).toBe(false);
    expect(result.gatesApplied.map((g) => g.id)).toContain('GATE-CRITICAL-SECURITY');
  });

  it('applies the same cap to a critical privacy finding', () => {
    const result = scoreAssessment(
      withFindings(
        finding({ severity: 'critical', dimension: 'data_privacy_practice', ruleId: 'PRI-02' }),
      ),
    );
    expect(result.certificationEligible).toBe(false);
    expect(result.gatesApplied.map((g) => g.id)).toContain('GATE-CRITICAL-SECURITY');
  });

  it('caps harder still on an exposed live credential', () => {
    const result = scoreAssessment(
      withFindings(finding({ severity: 'critical', ruleId: 'SEC-04' })),
    );
    expect(result.overallScore).toBeLessThanOrEqual(39);
    expect(result.gatesApplied.map((g) => g.id)).toContain('GATE-EXPOSED-SECRET');
  });

  it('refuses certification when the authorised scope did not reach the core flows', () => {
    const result = scoreAssessment({ ...clean, coreFlowsUnreachable: true });
    expect(result.overallScore).toBe(100);
    expect(result.certificationEligible).toBe(false);
    expect(result.certificationBlockers.join(' ')).toMatch(/GATE-NO-AUTHORISATION-COVERAGE/);
  });

  it('refuses certification below a dimension floor even when the total looks healthy', () => {
    // Enough security findings to sink that dimension under its floor of 65,
    // while the weighted total stays above the overall threshold of 70.
    const result = scoreAssessment(
      withFindings(
        finding({ severity: 'high', ruleId: 'SEC-01' }),
        finding({ severity: 'high', ruleId: 'SEC-02' }),
      ),
    );
    expect(result.overallScore).toBeGreaterThanOrEqual(70);
    expect(result.dimensions.find((d) => d.dimension === 'security_posture')!.score).toBeLessThan(
      65,
    );
    expect(result.certificationEligible).toBe(false);
    expect(result.certificationBlockers.join(' ')).toMatch(/security_posture/);
  });

  it('never lets a gate raise a score', () => {
    const gated = scoreAssessment(
      withFindings(finding({ severity: 'critical', ruleId: 'SEC-05' })),
    );
    const ungated = scoreAssessment(
      withFindings(finding({ severity: 'critical', ruleId: 'SEC-05', isPublished: false })),
    );
    expect(gated.overallScore).toBeLessThan(ungated.overallScore);
  });
});

describe('determinism', () => {
  it('returns the same result for the same input, every time', () => {
    const input = withFindings(
      finding({ severity: 'high' }),
      finding({ dimension: 'practicality_ux', severity: 'low', ruleId: 'UX-02' }),
    );
    const first = scoreAssessment(input);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(scoreAssessment(input)).toEqual(first);
    }
  });

  it('does not depend on the order findings arrive in', () => {
    const a = finding({ severity: 'high', ruleId: 'SEC-01' });
    const b = finding({ dimension: 'production_readiness', severity: 'medium', ruleId: 'PRD-02' });
    expect(scoreAssessment(withFindings(a, b))).toEqual(scoreAssessment(withFindings(b, a)));
  });
});

describe('a rubric that cannot score what it is given', () => {
  it('covers every attainable score with a band, at its own rounding', () => {
    // 1.1.0 rounds to two decimals and its bands run 0–39.99, 40–59.99,
    // 60–74.99, 75–89.99, 90–100 — which happens to leave no gap. Change the
    // rounding to three decimals and 39.995 belongs to nothing, and the first
    // anybody would know is a customer asking what "Unbanded" means.
    for (const version of listRubricVersions()) {
      const rubric = getRubric(version);
      const step = 10 ** -rubric.scoring.roundingDecimals;
      for (let score = 0; score <= 100 + 1e-9; score = Number((score + step).toFixed(6))) {
        const rounded = Number(score.toFixed(rubric.scoring.roundingDecimals));
        const band = rubric.bands.find(
          (candidate) => rounded >= candidate.min && rounded <= candidate.max,
        );
        expect(band, `${version} has no band for ${rounded}`).toBeDefined();
      }
    }
  });

  it('has a penalty for every severity and a multiplier for every confidence', () => {
    // Both are lookups into data published in a migration, and both used to
    // fall back to something harmless — nothing, and in full — so one
    // typographical error in a future rubric made a whole severity free on
    // everybody's score at once.
    for (const version of listRubricVersions()) {
      const rubric = getRubric(version);
      for (const severity of ['critical', 'high', 'medium', 'low', 'info'] as const) {
        expect(rubric.scoring.severityPenalties[severity], `${version} ${severity}`).toBeDefined();
      }
      for (const confidence of ['high', 'medium', 'low'] as const) {
        expect(
          rubric.scoring.confidenceMultipliers[confidence],
          `${version} ${confidence}`,
        ).toBeDefined();
      }
    }
  });

  it('stops rather than scoring a finding it has no penalty for', () => {
    // The alternative is a number assembled from a lookup that missed, which
    // nobody downstream can tell from a number that is right.
    expect(() =>
      scoreAssessment(withFindings(finding({ severity: 'catastrophic' as unknown as 'critical' }))),
    ).toThrow(UnscorableFindingError);
  });
});
