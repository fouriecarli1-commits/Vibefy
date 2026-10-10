/**
 * What each tier sees.
 *
 * The line is drawn deliberately: **the score is never redacted**. A free report
 * carries the same overall score, the same dimension breakdown and the same
 * band as a paid one, because withholding the number would look — correctly —
 * like hiding how the rubric works. What payment buys is the detail: every
 * finding rather than the worst three, the evidence behind each one, and the
 * remediation guide.
 *
 * Two things are never withheld from anyone, at any tier, because withholding
 * them would make the report misleading rather than merely thinner:
 *
 *   · the scope-and-limitations statement, and
 *   · what was *not* assessed.
 *
 * Silence about coverage reads as a clean result, and it is not one.
 */
import type { ReportFinding, ReportSource, ReportTier } from './types.ts';

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const;
const FREE_TIER_FINDING_LIMIT = 3;

export function severityRank(severity: ReportFinding['severity']): number {
  return SEVERITY_ORDER.indexOf(severity);
}

/**
 * Most serious first, and the same order every time.
 *
 * The last clause is the one that matters. Severity and rule id leave two
 * findings of the same severity against the same criterion — which is the
 * ordinary case, since one rule covers several exposed paths — comparing equal,
 * and `sort` is stable, so their order was whatever order the database happened
 * to return. A free report shows the three most serious, so that decided which
 * three a customer saw, and two renders of one assessment produced two
 * different PDFs.
 */
export function sortFindings(findings: readonly ReportFinding[]): ReportFinding[] {
  return [...findings].sort((a, b) => {
    const bySeverity = severityRank(a.severity) - severityRank(b.severity);
    if (bySeverity !== 0) return bySeverity;
    const byRule = a.ruleId.localeCompare(b.ruleId);
    if (byRule !== 0) return byRule;
    return a.title.localeCompare(b.title);
  });
}

export interface RedactedReport {
  /**
   * Everything about the assessment except its findings.
   *
   * It used to be the whole `ReportSource`, which put the unredacted findings
   * on the redacted object — one dot away from every line of the renderer.
   * The comment beside the free-tier strip promises that "a renderer that
   * forgets a conditional must not be able to leak it", and `view.source
   * .findings` was how it could. Nothing reads it today; the type is what
   * keeps that true.
   */
  readonly source: Omit<ReportSource, 'findings'>;
  readonly findings: readonly ReportFinding[];
  readonly showEvidence: boolean;
  readonly showRemediation: boolean;
  readonly showPrioritisedPlan: boolean;
  readonly hiddenFindingCount: number;
  readonly withheld: readonly string[];
}

/**
 * What a free reader may see of a finding, named field by field.
 *
 * This was `{ ...finding, evidence: [], remediation: '' }` — a spread with two
 * fields blanked, which is a list of what to withhold. `ReportFinding` has
 * nine fields and the list covered the two that matter today, so it was
 * complete and complete by coincidence. Add a field — a reproduction, an
 * affected URL, a technical detail — and it ships to the free tier by default,
 * which is the paid report given away rather than withheld.
 *
 * Named the other way round, so a new field is withheld until somebody
 * classifies it, and `tests/the-field-nobody-classified.test.ts` refuses a
 * field that appears in neither list.
 */
export const FREE_TIER_FINDING_FIELDS = [
  'id',
  'ruleId',
  'dimension',
  'severity',
  'confidence',
  'title',
  'description',
] as const;

/** Withheld from a free report, and the reason each one is the paid product. */
export const PAID_ONLY_FINDING_FIELDS: Readonly<Record<string, string>> = {
  remediation: 'The step that fixes it, which is most of what a paid report is for.',
  evidence: 'The screenshots, traces and HTTP exchanges behind the finding.',
};

function freeTierFinding(finding: ReportFinding): ReportFinding {
  const picked: Record<string, unknown> = {};
  for (const field of FREE_TIER_FINDING_FIELDS) picked[field] = finding[field];
  // Present and empty rather than absent: the renderer and the type both
  // expect them, and an absent field reads as a finding with no remediation
  // written rather than one withheld.
  return { ...picked, remediation: '', evidence: [] } as unknown as ReportFinding;
}

export function redactForTier(source: ReportSource, tier: ReportTier): RedactedReport {
  const sorted = sortFindings(source.findings);

  const { findings: _withheld, ...metadata } = source;

  if (tier === 'paid') {
    return {
      source: metadata,
      findings: sorted,
      showEvidence: true,
      showRemediation: true,
      showPrioritisedPlan: true,
      hiddenFindingCount: 0,
      withheld: [],
    };
  }

  const shown = sorted.slice(0, FREE_TIER_FINDING_LIMIT);
  const hidden = sorted.length - shown.length;

  return {
    source: metadata,
    // Evidence is stripped from the objects themselves, not merely hidden by the
    // template — a renderer that forgets a conditional must not be able to leak it.
    findings: shown.map(freeTierFinding),
    showEvidence: false,
    showRemediation: false,
    showPrioritisedPlan: false,
    hiddenFindingCount: hidden,
    withheld: [
      hidden > 0
        ? `${hidden} further finding${hidden === 1 ? '' : 's'}, in full`
        : 'Every finding in full',
      'The evidence behind each finding — screenshots, browser traces and HTTP exchanges',
      'A remediation step for each finding, and a prioritised order to do them in',
      source.intendedForAppStore ? 'The store-readiness checklist' : 'Improvement suggestions',
      'A PDF export you can hand to someone else',
      'One free re-test within 30 days',
    ],
  };
}

/**
 * The score a report displays must not depend on the tier it was rendered at.
 * Used by the renderer as a belt-and-braces assertion and by the test suite as
 * the thing it actually checks.
 */
export function scoreFingerprint(source: ReportSource): string {
  return JSON.stringify({
    overall: source.overallScore,
    band: source.band,
    certificationEligible: source.certificationEligible,
    dimensions: source.dimensions.map((d) => [d.dimension, d.score]),
  });
}
