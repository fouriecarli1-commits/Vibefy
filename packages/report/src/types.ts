/**
 * What a report is made of.
 *
 * Assembled from the persisted assessment rather than from the engine's
 * in-memory outcome, so a report can be regenerated years later from the
 * database alone — which is what "reproducible and defensible" has to mean when
 * a customer disputes a finding.
 */
import type { RubricDimensionId, FindingSeverity, ConfidenceLevel } from '@vibefy/rubric';

/** What the customer is entitled to see. Never what they were scored. */
export type ReportTier = 'free' | 'paid';

export interface ReportFinding {
  readonly id: string;
  readonly ruleId: string;
  readonly dimension: RubricDimensionId;
  readonly severity: FindingSeverity;
  readonly confidence: ConfidenceLevel;
  readonly title: string;
  readonly description: string;
  readonly remediation: string;
  readonly evidence: readonly {
    readonly id: string;
    readonly kind: string;
    readonly summary: string;
    readonly sha256: string;
    readonly capturedAt: string;
  }[];
}

export interface ReportDimensionScore {
  readonly dimension: RubricDimensionId;
  readonly label: string;
  readonly score: number;
  readonly weight: number;
  readonly band: string;
}

export interface ReportNarrative {
  readonly headline: string;
  readonly summary: string;
  readonly strengths: readonly string[];
  readonly prioritisedRemediation: readonly {
    readonly order: number;
    readonly title: string;
    readonly why: string;
    readonly step: string;
  }[];
  readonly notAssessed: readonly string[];
}

export interface ReportStage {
  readonly stage: string;
  readonly status: string;
  readonly notes: readonly string[];
}

export interface ReportSource {
  readonly assessmentId: string;
  readonly appName: string;
  readonly appUrl: string | null;
  readonly organisationName: string;
  readonly rubricVersion: string;
  readonly assessedOn: string;
  readonly reviewedOn: string | null;
  readonly overallScore: number;
  readonly band: string;
  readonly certificationEligible: boolean;
  readonly certificationBlockers: readonly string[];
  readonly dimensions: readonly ReportDimensionScore[];
  readonly findings: readonly ReportFinding[];
  readonly narrative: ReportNarrative | null;
  readonly stages: readonly ReportStage[];
  readonly scopeStatement: string;
  readonly promptBundleSha256: string;
  readonly intendedForAppStore: boolean;
}

export interface RenderedReport {
  readonly tier: ReportTier;
  readonly html: string;
  readonly title: string;
  /** What the customer would get by paying, stated plainly on a free report. */
  readonly withheld: readonly string[];
}
