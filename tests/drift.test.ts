/**
 * Drift and material regression.
 *
 * A drift report is the document that takes someone's badge away. These tests
 * are the specification for when that is allowed to happen, and every one of
 * them is a sentence a customer could reasonably argue with in an appeal.
 */
import { describe, expect, it } from 'vitest';
import {
  applyProbe,
  assessMateriality,
  badgeExpiringAlert,
  cadenceFor,
  classifyProbe,
  computeDrift,
  driftAlert,
  isReassessmentDue,
  nextReassessmentDue,
  regressionAlert,
  type AssessmentSnapshot,
  type ComparableFinding,
} from '../packages/monitoring/src/index.ts';

function snapshot(
  id: string,
  overrides: Partial<AssessmentSnapshot> = {},
): AssessmentSnapshot {
  return {
    assessmentId: id,
    assessedAt: new Date('2026-08-01T00:00:00Z'),
    rubricVersion: '1.0.0',
    overallScore: 82,
    certificationEligible: true,
    dimensions: [
      { dimension: 'security_posture', score: 80 },
      { dimension: 'data_privacy_practice', score: 78 },
      { dimension: 'functional_integrity', score: 88 },
    ],
    findings: [],
    ...overrides,
  };
}

function finding(overrides: Partial<ComparableFinding> = {}): ComparableFinding {
  return {
    ruleId: 'SEC-02',
    dimension: 'security_posture',
    severity: 'medium',
    title: 'Missing Content-Security-Policy header',
    isPublished: true,
    ...overrides,
  };
}

describe('what changed', () => {
  it('classifies findings as new, resolved, persisting or escalated', () => {
    const before = snapshot('a', {
      findings: [
        finding({ ruleId: 'SEC-02' }),
        finding({ ruleId: 'SEC-09', severity: 'low', title: 'Verbose error page' }),
      ],
    });
    const after = snapshot('b', {
      findings: [
        finding({ ruleId: 'SEC-02', severity: 'critical' }),
        finding({ ruleId: 'UX-03', dimension: 'practicality_ux', title: 'No visible error state' }),
      ],
    });

    const drift = computeDrift(before, after);
    expect(drift.newFindings.map((f) => f.ruleId)).toEqual(['UX-03']);
    expect(drift.resolvedFindings.map((f) => f.ruleId)).toEqual(['SEC-09']);
    expect(drift.persistingFindings.map((f) => f.ruleId)).toEqual(['SEC-02']);
    expect(drift.escalatedFindings).toEqual([
      expect.objectContaining({ ruleId: 'SEC-02', wasSeverity: 'medium', severity: 'critical' }),
    ]);
  });

  it('treats the same rule on a different dimension as a different finding', () => {
    const before = snapshot('a', { findings: [finding({ ruleId: 'GEN-01' })] });
    const after = snapshot('b', {
      findings: [finding({ ruleId: 'GEN-01', dimension: 'practicality_ux' })],
    });
    const drift = computeDrift(before, after);
    expect(drift.newFindings).toHaveLength(1);
    expect(drift.resolvedFindings).toHaveLength(1);
    expect(drift.persistingFindings).toHaveLength(0);
  });

  it('ignores withheld findings entirely, in both directions', () => {
    // A withheld finding was never shown to the customer and never moved the
    // score. Counting one as resolved would credit a fix that never happened;
    // counting one as new would suspend a badge over an accusation we refused
    // to publish ourselves.
    const before = snapshot('a', {
      findings: [finding({ ruleId: 'SEC-07', isPublished: false })],
    });
    const after = snapshot('b', {
      findings: [finding({ ruleId: 'SEC-08', isPublished: false })],
    });
    const drift = computeDrift(before, after);
    expect(drift.newFindings).toHaveLength(0);
    expect(drift.resolvedFindings).toHaveLength(0);
  });

  it('keeps the worst instance when one rule fires more than once', () => {
    const after = snapshot('b', {
      findings: [
        finding({ ruleId: 'SEC-02', severity: 'low' }),
        finding({ ruleId: 'SEC-02', severity: 'critical' }),
      ],
    });
    const drift = computeDrift(snapshot('a'), after);
    expect(drift.newFindings).toHaveLength(1);
    expect(drift.newFindings[0]!.severity).toBe('critical');
  });

  it('reports dimension movement including dimensions that appeared or vanished', () => {
    const after = snapshot('b', {
      dimensions: [
        { dimension: 'security_posture', score: 60 },
        { dimension: 'data_privacy_practice', score: 78 },
        { dimension: 'functional_integrity', score: 88 },
        { dimension: 'production_readiness', score: 70 },
      ],
    });
    const drift = computeDrift(snapshot('a'), after);
    const security = drift.dimensionDeltas.find((d) => d.dimension === 'security_posture');
    expect(security).toEqual({
      dimension: 'security_posture',
      before: 80,
      after: 60,
      delta: -20,
    });
  });

  it('refuses to compare an assessment with itself', () => {
    expect(() => computeDrift(snapshot('a'), snapshot('a'))).toThrow(/two different assessments/);
  });
});

describe('when a change costs a badge', () => {
  it('suspends when certification is lost', () => {
    const verdict = assessMateriality(
      computeDrift(snapshot('a'), snapshot('b', { certificationEligible: false })),
    );
    expect(verdict.material).toBe(true);
    expect(verdict.suspendBadge).toBe(true);
    expect(verdict.reasons.map((r) => r.rule)).toContain('certification_lost');
  });

  it('suspends on a new serious security finding even when the score barely moves', () => {
    const after = snapshot('b', {
      overallScore: 81,
      findings: [finding({ ruleId: 'SEC-04', severity: 'critical', title: 'API key in client bundle' })],
    });
    const verdict = assessMateriality(computeDrift(snapshot('a'), after));
    expect(verdict.reasons.map((r) => r.rule)).toContain('serious_new_security_finding');
    expect(verdict.reasons[0]!.explanation.length).toBeGreaterThan(20);
  });

  it('does not suspend on a new serious finding outside the sensitive dimensions', () => {
    const after = snapshot('b', {
      overallScore: 80,
      findings: [
        finding({
          ruleId: 'UX-03',
          dimension: 'practicality_ux',
          severity: 'high',
          title: 'Checkout button unreachable on mobile',
        }),
      ],
    });
    expect(assessMateriality(computeDrift(snapshot('a'), after)).material).toBe(false);
  });

  it('suspends when the overall score falls by the threshold', () => {
    const verdict = assessMateriality(
      computeDrift(snapshot('a'), snapshot('b', { overallScore: 74 })),
    );
    expect(verdict.reasons.map((r) => r.rule)).toContain('score_drop');
  });

  it('does not suspend on a drop smaller than the threshold', () => {
    const verdict = assessMateriality(
      computeDrift(snapshot('a'), snapshot('b', { overallScore: 78 })),
    );
    expect(verdict.material).toBe(false);
    expect(verdict.suspendBadge).toBe(false);
  });

  it('never suspends on an improvement', () => {
    const after = snapshot('b', {
      overallScore: 95,
      findings: [],
    });
    const verdict = assessMateriality(computeDrift(snapshot('a'), after));
    expect(verdict.material).toBe(false);
  });

  it('suspends when a dimension crosses below its floor', () => {
    const after = snapshot('b', {
      overallScore: 79,
      dimensions: [
        { dimension: 'security_posture', score: 60 },
        { dimension: 'data_privacy_practice', score: 78 },
        { dimension: 'functional_integrity', score: 88 },
      ],
    });
    const verdict = assessMateriality(computeDrift(snapshot('a'), after));
    expect(verdict.reasons.map((r) => r.rule)).toContain('dimension_below_floor');
  });

  it('reports every reason, not the first one it found', () => {
    const after = snapshot('b', {
      overallScore: 40,
      certificationEligible: false,
      dimensions: [
        { dimension: 'security_posture', score: 20 },
        { dimension: 'data_privacy_practice', score: 30 },
        { dimension: 'functional_integrity', score: 40 },
      ],
      findings: [finding({ ruleId: 'SEC-04', severity: 'critical', title: 'Live key exposed' })],
    });
    const verdict = assessMateriality(computeDrift(snapshot('a'), after));
    expect(verdict.reasons.length).toBeGreaterThanOrEqual(4);
  });

  it('never suspends a badge because we changed the rubric', () => {
    // The customer did not do anything. Charging them a badge for our own
    // standard moving would make every rubric release a trust event.
    const after = snapshot('b', {
      rubricVersion: '1.1.0',
      overallScore: 51,
      certificationEligible: false,
    });
    const drift = computeDrift(snapshot('a'), after);
    expect(drift.comparable).toBe(false);
    const verdict = assessMateriality(drift);
    expect(verdict.suspendBadge).toBe(false);
    expect(verdict.material).toBe(false);
    expect(verdict.withheldBecause).toMatch(/different rubric versions/);
    // The reasons are still computed, because the customer is entitled to see
    // what moved even when it costs them nothing.
    expect(verdict.reasons.length).toBeGreaterThan(0);
  });

  it('cannot produce a material verdict without a stated reason', () => {
    // The database enforces this too, with a check constraint. Both, because a
    // suspension with no reason is unanswerable.
    const after = snapshot('b', { overallScore: 50, certificationEligible: false });
    const verdict = assessMateriality(computeDrift(snapshot('a'), after));
    expect(verdict.material).toBe(verdict.reasons.length > 0);
    expect(verdict.reasons.every((reason) => reason.explanation.trim().length > 20)).toBe(true);
  });
});

describe('liveness', () => {
  it('treats a 404 as up — the origin answered', () => {
    expect(classifyProbe({ status: 404 })).toBe('up');
    expect(classifyProbe({ status: 200 })).toBe('up');
    expect(classifyProbe({ status: 503 })).toBe('down');
    expect(classifyProbe({ status: null, error: 'timeout' })).toBe('down');
  });

  it('does not suspend on a single failure', () => {
    const decision = applyProbe(
      { consecutiveFailures: 0, badgeStatus: 'active' },
      { status: null, error: 'timeout' },
      6,
    );
    expect(decision.consecutiveFailures).toBe(1);
    expect(decision.suspendBadge).toBe(false);
    expect(decision.reason).toBeNull();
  });

  it('suspends once the run of failures crosses the threshold', () => {
    const decision = applyProbe(
      { consecutiveFailures: 5, badgeStatus: 'active' },
      { status: 503 },
      6,
    );
    expect(decision.suspendBadge).toBe(true);
    expect(decision.reason).toMatch(/6 consecutive checks/);
  });

  it('resets the count and restores the badge when the application answers again', () => {
    const decision = applyProbe(
      { consecutiveFailures: 8, badgeStatus: 'suspended' },
      { status: 200 },
      6,
    );
    expect(decision.consecutiveFailures).toBe(0);
    expect(decision.restoreBadge).toBe(true);
  });

  it('does not restore a badge that was suspended for something else', () => {
    const decision = applyProbe(
      { consecutiveFailures: 0, badgeStatus: 'suspended' },
      { status: 200 },
      6,
    );
    expect(decision.restoreBadge).toBe(false);
  });
});

describe('cadence', () => {
  it('does not monitor free or one-off applications', () => {
    expect(cadenceFor('free').reassessEveryDays).toBeNull();
    expect(cadenceFor('one_off').reassessEveryDays).toBeNull();
    expect(nextReassessmentDue('one_off', new Date('2026-01-01'))).toBeNull();
  });

  it('schedules the next run a plan-defined number of days after the last one', () => {
    const due = nextReassessmentDue('certified', new Date('2026-08-01T00:00:00Z'));
    expect(due?.toISOString()).toBe('2026-08-31T00:00:00.000Z');
    expect(isReassessmentDue('certified', new Date('2026-08-01T00:00:00Z'), new Date('2026-08-30T00:00:00Z'))).toBe(false);
    expect(isReassessmentDue('certified', new Date('2026-08-01T00:00:00Z'), new Date('2026-09-01T00:00:00Z'))).toBe(true);
  });

  it('never calls a never-assessed application overdue', () => {
    expect(isReassessmentDue('organisation', null, new Date('2030-01-01'))).toBe(false);
  });
});

describe('alert wording', () => {
  const drift = computeDrift(snapshot('a'), snapshot('b', { overallScore: 70 }));

  it('gives every alert a dedupe key tied to what it is about', () => {
    expect(driftAlert('Kettle', 'app-1', drift).dedupeKey).toBe('drift:b');
    expect(regressionAlert('Kettle', 'app-1', drift, assessMateriality(drift)).dedupeKey).toBe(
      'regression:b',
    );
  });

  it('uses only the exact wordmark and no absolute claims', () => {
    const drafts = [
      driftAlert('Kettle', 'app-1', drift),
      regressionAlert('Kettle', 'app-1', drift, assessMateriality(drift)),
      badgeExpiringAlert('Kettle', 'app-1', 'badge-1', new Date('2026-09-01'), 10),
    ];
    for (const draft of drafts) {
      const text = `${draft.title} ${draft.body}`.toLowerCase();
      for (const banned of ['guaranteed', 'hack-proof', 'certified secure', 'approved by']) {
        expect(text, `"${banned}" must not appear in an alert`).not.toContain(banned);
      }
      expect(draft.title.trim().length).toBeGreaterThanOrEqual(5);
      expect(draft.body.trim().length).toBeGreaterThanOrEqual(20);
    }
  });
});
