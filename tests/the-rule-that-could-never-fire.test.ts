/**
 * `large_move` is in the union, has a test, and could not fire in production.
 *
 * `triageAssessment` raises eight kinds of attention for the person whose
 * approval is the hard gate on a badge. One of them is a score that has moved:
 *
 *     A move this size is either a real change in the application or a
 *     difference in what the run reached. Which one it is decides whether a
 *     badge should move.
 *
 * It needs `previousScore`, which is optional on `TriageInput`. Measured across
 * the repository on 2026-10-07, the only thing that set it was
 * `tests/review-triage.test.ts`. Neither review page passed it, so a
 * re-assessment whose score jumped twenty points reached a reviewer with
 * nothing saying so — the exact case the rule was written for.
 *
 * It is the same defect the pipeline already documents about
 * `syntheticCredentials`: "the worker's job carries an optional field that no
 * caller sets and no queue row holds". An `AttentionId` in the union, a branch
 * in the function and a passing test make a rule look implemented from every
 * angle except the one where it runs.
 *
 * The previous score is the last one a reviewer approved or published for the
 * same application, which is the number a badge is standing on. A draft, a
 * failed run or an assessment still awaiting review is not something anybody
 * relied on, so comparing against one would raise attention over a move that
 * never happened in public.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { triageAssessment, type TriageInput } from '../packages/governance/src/index.ts';

const base: TriageInput = {
  overallScore: 84,
  certificationEligible: true,
  gateFailures: [],
  failedStages: [],
  findings: Array.from({ length: 6 }, (_, index) => ({
    title: `Finding ${index}`,
    severity: 'medium' as const,
    dimension: 'practicality_ux',
    confidence: 'high' as const,
    isPublished: true,
    evidenceCount: 1,
  })),
};

const ids = (input: TriageInput) => triageAssessment(input).attention.map((entry) => entry.id);

/** The code of a page, without comments — which quote the defect on purpose. */
const pageSource = (path: string) =>
  readFileSync(join(import.meta.dirname, '..', path), 'utf8')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');

describe('the rule itself, which always worked', () => {
  it('fires on a large move', () => {
    expect(ids({ ...base, previousScore: 61 })).toContain('large_move');
  });

  it('stays quiet on a small one', () => {
    expect(ids({ ...base, previousScore: 81 })).not.toContain('large_move');
  });

  it('stays quiet when there is no previous score', () => {
    // A first assessment has nothing to have moved from, and that is not a
    // reason to look closer.
    expect(ids({ ...base, previousScore: null })).not.toContain('large_move');
    expect(ids(base)).not.toContain('large_move');
  });
});

describe('the pages that decide whether it ever runs', () => {
  const queue = pageSource('apps/web/app/review/page.tsx');
  const detail = pageSource('apps/web/app/review/[id]/page.tsx');

  it('the queue passes a previous score', () => {
    expect(queue).toMatch(/previousScore:/);
  });

  it('the detail page passes a previous score', () => {
    expect(detail).toMatch(/previousScore:/);
  });

  it('both read it from an assessment somebody actually approved', () => {
    // A draft, a failed run or one still awaiting review is not a number
    // anybody relied on. Comparing against one raises attention over a move
    // that never happened in public, which is the direction this fix fails in.
    for (const source of [queue, detail]) {
      expect(source).toMatch(/'approved',\s*'published'|'approved', 'published'/);
    }
  });

  it('both still pass the failed stages, which is the field that did work', () => {
    for (const source of [queue, detail]) expect(source).toMatch(/failedStages:/);
  });
});

describe('every attention rule has something that can set its input', () => {
  /**
   * The guard, in the shape the defect had.
   *
   * Each id is listed with the `TriageInput` field it needs. A rule whose field
   * is optional and set by nothing in `apps/` is a rule that cannot fire, and
   * naming them here makes the next one fail this test rather than sit in the
   * union looking implemented.
   */
  const NEEDS: Readonly<Record<string, string | null>> = {
    published_without_evidence: null,
    critical_finding: null,
    low_confidence: null,
    near_threshold: null,
    certifying_with_high_severity: null,
    suspiciously_few_findings: null,
    incomplete_run: 'failedStages',
    large_move: 'previousScore',
  };

  const app = [
    pageSource('apps/web/app/review/page.tsx'),
    pageSource('apps/web/app/review/[id]/page.tsx'),
  ].join('\n');

  it('covers every id the function can raise', () => {
    const union = readFileSync(
      join(import.meta.dirname, '..', 'packages/governance/src/triage.ts'),
      'utf8',
    );
    // The last member carries the semicolon, which the first version of this
    // regex excluded — so it passed with seven of eight and the one it missed
    // was `certifying_with_high_severity`.
    const declared = [...union.matchAll(/^ {2}\| '([a-z_]+)';?$/gm)].map(
      (match) => match[1] as string,
    );
    expect(declared).toHaveLength(8);
    expect(new Set(declared)).toEqual(new Set(Object.keys(NEEDS)));
  });

  it('has a caller for every field a rule depends on', () => {
    const unfed = Object.entries(NEEDS)
      .filter(([, field]) => field !== null)
      .filter(([, field]) => !app.includes(`${field}:`))
      .map(([id]) => id);
    expect(unfed).toEqual([]);
  });
});
