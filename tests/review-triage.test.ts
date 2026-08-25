/**
 * Preparing an assessment for the person who approves it.
 *
 * The human gate is what makes the badge mean anything, and it is the one step
 * that cannot be swept. Triage exists so that gate costs minutes rather than an
 * afternoon — but a summariser sitting in front of a reviewer is one small step
 * from being the reviewer, so most of these tests are about what it cannot do.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  triageAssessment,
  type TriageFinding,
  type TriageInput,
} from '../packages/governance/src/index.ts';
import { lintText } from '../tools/copy-lint.mjs';

const finding = (overrides: Partial<TriageFinding> = {}): TriageFinding => ({
  title: 'Missing Content-Security-Policy header',
  severity: 'medium',
  dimension: 'security_posture',
  confidence: 'high',
  isPublished: true,
  evidenceCount: 2,
  ...overrides,
});

const input = (overrides: Partial<TriageInput> = {}): TriageInput => ({
  overallScore: 84,
  certificationEligible: true,
  gateFailures: [],
  findings: Array.from({ length: 8 }, () => finding()),
  ...overrides,
});

describe('what it raises for a person', () => {
  it('flags a critical finding, and names it', () => {
    const triage = triageAssessment(
      input({
        findings: [finding({ severity: 'critical', title: 'Environment file is readable' })],
      }),
    );
    const critical = triage.attention.find((entry) => entry.id === 'critical_finding');
    expect(critical).toBeDefined();
    expect(critical!.detail).toContain('Environment file is readable');
  });

  it('flags a score sitting on the certification line', () => {
    // Where one adjusted finding decides whether a badge exists at all.
    expect(
      triageAssessment(input({ overallScore: 70.2 })).attention.map((entry) => entry.id),
    ).toContain('near_threshold');
    expect(
      triageAssessment(input({ overallScore: 88 })).attention.map((entry) => entry.id),
    ).not.toContain('near_threshold');
  });

  it('flags a run that did not finish', () => {
    const triage = triageAssessment(input({ failedStages: ['functional_exploration'] }));
    const entry = triage.attention.find((item) => item.id === 'incomplete_run');
    expect(entry).toBeDefined();
    // What was not looked at cannot be reported as clean.
    expect(entry!.detail).toContain('cannot be reported as clean');
  });

  it('treats very few findings as a warning rather than as good news', () => {
    // Two findings usually means the run could not reach the application, not
    // that the application was nearly perfect.
    const triage = triageAssessment(input({ findings: [finding(), finding()] }));
    expect(triage.attention.map((entry) => entry.id)).toContain('suspiciously_few_findings');
  });

  it('flags a finding the engine was unsure about', () => {
    const triage = triageAssessment(
      input({
        findings: [...Array.from({ length: 5 }, () => finding()), finding({ confidence: 'low' })],
      }),
    );
    expect(triage.attention.map((entry) => entry.id)).toContain('low_confidence');
  });

  it('flags certifying an application that carries serious security findings', () => {
    const triage = triageAssessment(
      input({
        certificationEligible: true,
        findings: [
          ...Array.from({ length: 5 }, () => finding()),
          finding({ severity: 'high', dimension: 'security_posture' }),
        ],
      }),
    );
    expect(triage.attention.map((entry) => entry.id)).toContain('certifying_with_high_severity');
  });

  it('flags a published finding with no evidence as our defect, not theirs', () => {
    // The pipeline withholds these. One arriving means the withholding broke.
    const triage = triageAssessment(input({ findings: [finding({ evidenceCount: 0 })] }));
    const entry = triage.attention.find((item) => item.id === 'published_without_evidence');
    expect(entry).toBeDefined();
    expect(entry!.detail).toContain('defect in us');
  });

  it('flags a large move against the previous score', () => {
    const triage = triageAssessment(input({ overallScore: 84, previousScore: 61 }));
    const entry = triage.attention.find((item) => item.id === 'large_move');
    expect(entry).toBeDefined();
    expect(entry!.label).toContain('rose');
  });

  it('ignores a withheld finding entirely', () => {
    // A reviewer already decided that one does not stand. It should not go on
    // shaping the summary afterwards.
    const triage = triageAssessment(
      input({
        findings: [
          ...Array.from({ length: 5 }, () => finding()),
          finding({ severity: 'critical', isPublished: false }),
        ],
      }),
    );
    expect(triage.attention.map((entry) => entry.id)).not.toContain('critical_finding');
  });
});

describe('what it cannot do', () => {
  it('never approves, rejects or changes a status', () => {
    const source = readFileSync(join(process.cwd(), 'packages/governance/src/triage.ts'), 'utf8');
    for (const forbidden of [
      'approve',
      'reject',
      'status',
      'update',
      'insert',
      'supabase',
      'sql',
    ]) {
      expect(source.toLowerCase(), `triage mentions "${forbidden}"`).not.toMatch(
        new RegExp(`\\b${forbidden}\\(`),
      );
    }
    // It takes a plain object and returns a plain object. There is nowhere for
    // a decision to go.
    expect(source).not.toContain('async ');
  });

  it('offers no verdict a caller could act on', () => {
    const clean = triageAssessment(input({ findings: Array.from({ length: 8 }, () => finding()) }));
    // Two values, both descriptions of how much reading there is — neither of
    // them an instruction.
    expect(['read_closely', 'straightforward']).toContain(clean.suggestion);
    expect(JSON.stringify(clean)).not.toMatch(/"(approve|reject|certify|pass|fail)"/i);
  });

  it('is not read by anything that decides', () => {
    // The moment something branches on `suggestion`, the reviewer is advisory
    // and the summariser is the reviewer.
    for (const file of [
      'apps/web/app/review/actions.ts',
      'apps/web/app/review/page.tsx',
      'apps/web/app/review/[id]/page.tsx',
    ]) {
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      expect(source, `${file} branches on the triage suggestion`).not.toMatch(
        /suggestion\s*===|suggestion\s*!==|if\s*\(\s*[\w.]*suggestion/,
      );
    }
  });

  it('says plainly that a quiet summary is not an approval', () => {
    const page = readFileSync(join(process.cwd(), 'apps/web/app/review/[id]/page.tsx'), 'utf8');
    expect(page).toContain('That is not an approval');
  });

  it('cannot be approved from the list', () => {
    // A one-tap approve on a summary is a rubber stamp with good typography.
    const queue = readFileSync(join(process.cwd(), 'apps/web/app/review/page.tsx'), 'utf8');
    expect(queue).not.toContain('approveAssessment');
    expect(queue).not.toContain('ActionForm');
  });
});

describe('what it tells the reviewer up front', () => {
  it('states what was checked and found ordinary, so silence is not ambiguous', () => {
    const triage = triageAssessment(input());
    expect(triage.routine.length).toBeGreaterThan(2);
    expect(triage.routine.join(' ')).toContain('carry evidence');
  });

  it('says when the gate already blocks a badge', () => {
    const triage = triageAssessment(
      input({ gateFailures: ['A critical security finding stands'], certificationEligible: false }),
    );
    expect(triage.routine.join(' ')).toContain('without a badge');
  });

  it('estimates a time a person can plan around', () => {
    const quick = triageAssessment(input({ findings: Array.from({ length: 6 }, () => finding()) }));
    const slow = triageAssessment(
      input({
        overallScore: 70.5,
        findings: [
          ...Array.from({ length: 30 }, () => finding()),
          finding({ severity: 'critical' }),
          finding({ confidence: 'low' }),
        ],
      }),
    );
    expect(quick.estimatedMinutes).toBeLessThan(slow.estimatedMinutes);
    expect(quick.estimatedMinutes).toBeGreaterThanOrEqual(1);
  });

  it('passes the copy gate', () => {
    const triage = triageAssessment(
      input({
        overallScore: 70.1,
        failedStages: ['store_readiness'],
        findings: [finding({ severity: 'critical' }), finding({ confidence: 'low' })],
      }),
    );
    const copy = [
      triage.headline,
      ...triage.attention.map((entry) => `${entry.label} ${entry.detail}`),
      ...triage.routine,
    ].join('\n');
    expect(lintText(copy, 'triage')).toEqual([]);
  });
});
