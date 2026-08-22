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

export function sortFindings(findings: readonly ReportFinding[]): ReportFinding[] {
  return [...findings].sort((a, b) => {
    const bySeverity = severityRank(a.severity) - severityRank(b.severity);
    if (bySeverity !== 0) return bySeverity;
    return a.ruleId.localeCompare(b.ruleId);
  });
}

export interface RedactedReport {
  readonly source: ReportSource;
  readonly findings: readonly ReportFinding[];
  readonly showEvidence: boolean;
  readonly showRemediation: boolean;
  readonly showPrioritisedPlan: boolean;
  readonly hiddenFindingCount: number;
  readonly withheld: readonly string[];
}

export function redactForTier(source: ReportSource, tier: ReportTier): RedactedReport {
  const sorted = sortFindings(source.findings);

  if (tier === 'paid') {
    return {
      source,
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
    source,
    // Evidence is stripped from the objects themselves, not merely hidden by the
    // template — a renderer that forgets a conditional must not be able to leak it.
    findings: shown.map((finding) => ({ ...finding, evidence: [], remediation: '' })),
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
