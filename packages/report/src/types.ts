/**
 * What a report is made of.
 *
 * Assembled from the persisted assessment rather than from the engine's
 * in-memory outcome, so a report can be regenerated years later from the
 * database alone — which is what "reproducible and defensible" has to mean when
 * a customer disputes a finding.
 */
import type { RubricDimensionId, FindingSeverity, ConfidenceLevel } from '@vibefycode/rubric';

/** What the customer is entitled to see. Never what they were scored. */
import type { Comparison } from './comparison.ts';

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
  /**
   * Criteria this run did not answer, recorded by the engine as it ran.
   *
   * Not the same thing as `narrative.notAssessed`, and it is here because the
   * two were being confused. That one is a model's account of what it thinks it
   * did not do. This is the engine's own record: the stage that could not load
   * the page in a browser, the checkout that was never found, the four criteria
   * behind a sign-in nobody was given an account for. It is written to
   * `assessments.not_tested` as the run finishes and is what the public
   * verification page prints.
   *
   * Until this field existed the report did not read that column at all, so a
   * run whose model narrative happened to be quiet printed "Everything within
   * the authorised scope was assessed" — the strongest sentence in the
   * document, in the paying customer's copy, while the free page a stranger
   * could open listed four things nobody had looked at.
   */
  readonly notTested: readonly { readonly criterion: string; readonly because: string }[];
  readonly stages: readonly ReportStage[];
  readonly scopeStatement: string;
  readonly promptBundleSha256: string;
  readonly intendedForAppStore: boolean;
  /**
   * The agency handing this report to a client, if there is one.
   *
   * White-label means *their* cover block, not their assessment. The document
   * still says who performed the work, against which rubric, and every VibefyCode
   * mark in it is the supplied mark, unaltered.
   */
  readonly branding?: ReportBranding | null;
  /** The organisation's own bar, and whether this assessment cleared it. */
  readonly policy?: ReportPolicy | null;
  /**
   * Where this score stands among other assessed applications of the same kind.
   *
   * Optional because a report can be produced before there is anything to
   * compare against, and because the answer is sometimes "not enough of them
   * yet" — which is printed rather than left out, so that nobody wonders
   * whether the comparison was omitted because it was unflattering.
   */
  readonly comparison?: Comparison | null;
}

export interface ReportBranding {
  readonly displayName: string;
  readonly logoDataUri: string | null;
  readonly accentColour: string | null;
  readonly contactLine: string | null;
  readonly footerNote: string | null;
}

export interface ReportPolicy {
  readonly profileName: string;
  readonly meetsPolicy: boolean;
  readonly failures: readonly string[];
  readonly note: string;
}

export interface RenderedReport {
  readonly tier: ReportTier;
  readonly html: string;
  readonly title: string;
  /** What the customer would get by paying, stated plainly on a free report. */
  readonly withheld: readonly string[];
}
