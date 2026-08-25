/**
 * Preparing an assessment for the person who has to approve it.
 *
 * The human review gate is what makes the badge mean anything, and it is the
 * one step in this product that cannot be swept. But "a person must look" and
 * "a person must spend twenty minutes" are different requirements, and only the
 * first one is real. What actually takes the twenty minutes is working out
 * *which* of forty findings deserve a second look.
 *
 * So this does that part: it reads the assessment and separates what needs
 * attention from what is routine, with a reason for each. A reviewer then
 * spends their attention on the two things that are unusual rather than on the
 * thirty-eight that are not.
 *
 * Three rules keep this from quietly becoming the reviewer.
 *
 *   1. **It never approves anything.** There is no code path from a triage to a
 *      status change. It produces sentences; a person produces decisions.
 *   2. **Its suggestion is advisory and labelled as such.** A field called
 *      `suggestion` that something acts on is an automatic approval with a
 *      polite name.
 *   3. **It only ever raises attention, never lowers it.** Every rule here can
 *      add a reason to look closer. None can remove one, and none can mark an
 *      assessment as fine — the absence of a reason is not a recommendation.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type Confidence = 'high' | 'medium' | 'low';

export interface TriageFinding {
  readonly title: string;
  readonly severity: Severity;
  readonly dimension: string;
  readonly confidence: Confidence;
  readonly isPublished: boolean;
  readonly evidenceCount: number;
}

export interface TriageInput {
  readonly overallScore: number | null;
  readonly certificationEligible: boolean;
  readonly gateFailures: readonly string[];
  readonly findings: readonly TriageFinding[];
  /** The stages that did not succeed, if any. A partial run is not a result. */
  readonly failedStages?: readonly string[];
  /** The last reviewed score for the same application, when there is one. */
  readonly previousScore?: number | null;
}

export type AttentionId =
  | 'published_without_evidence'
  | 'critical_finding'
  | 'low_confidence'
  | 'near_threshold'
  | 'large_move'
  | 'incomplete_run'
  | 'suspiciously_few_findings'
  | 'certifying_with_high_severity';

export interface Attention {
  readonly id: AttentionId;
  /** Short enough to read on a phone in a list. */
  readonly label: string;
  /** Why it is being raised, and what to look at. */
  readonly detail: string;
}

export interface Triage {
  /** One line describing what this assessment is, before any judgement. */
  readonly headline: string;
  readonly attention: readonly Attention[];
  /** What was checked and found ordinary. Stated so silence is not ambiguous. */
  readonly routine: readonly string[];
  /**
   * Advisory only. Nothing in this codebase reads it to decide anything, and
   * `tests/review-triage.test.ts` fails if anything starts to.
   */
  readonly suggestion: 'read_closely' | 'straightforward';
  /** A rough reading time, so a reviewer can tell a minute from a quarter hour. */
  readonly estimatedMinutes: number;
}

/** The rubric's certification line. Near it is where a decision matters most. */
const CERTIFICATION_THRESHOLD = 70;
const NEAR_THRESHOLD_POINTS = 4;
const LARGE_MOVE_POINTS = 8;

export function triageAssessment(input: TriageInput): Triage {
  const published = input.findings.filter((finding) => finding.isPublished);
  const attention: Attention[] = [];
  const routine: string[] = [];

  const bySeverity = (severity: Severity) =>
    published.filter((finding) => finding.severity === severity);

  // --- The ones that mean something is wrong with the run itself -------------

  const unevidenced = published.filter((finding) => finding.evidenceCount === 0);
  if (unevidenced.length > 0) {
    // This should be impossible: the pipeline withholds a finding with no
    // evidence. If one reaches here, the withholding is broken, and that is a
    // more serious thing than whatever the finding says.
    attention.push({
      id: 'published_without_evidence',
      label: `${unevidenced.length} published finding${unevidenced.length === 1 ? '' : 's'} with no evidence`,
      detail:
        'A published finding must carry evidence, and the pipeline withholds any that does not. One reaching review means that withholding did not work — check the finding, then say so, because this is a defect in us rather than in the application.',
    });
  }

  const failed = input.failedStages ?? [];
  if (failed.length > 0) {
    attention.push({
      id: 'incomplete_run',
      label: `${failed.length} stage${failed.length === 1 ? '' : 's'} did not complete`,
      detail: `A partial run is not a result: ${failed.join(', ')}. What was not looked at cannot be reported as clean, so consider rejecting and re-running rather than approving a report with a hole in it.`,
    });
  }

  if (published.length > 0 && published.length < 3) {
    attention.push({
      id: 'suspiciously_few_findings',
      label: `Only ${published.length} finding${published.length === 1 ? '' : 's'}`,
      detail:
        'Very few findings usually means the run did not reach much of the application — a sign-in it could not pass, a page it could not load — rather than that there was little to find. Check the scope statement and the stage notes before treating this as a clean result.',
    });
  }

  // --- The ones that need a person's judgement ------------------------------

  const criticals = bySeverity('critical');
  if (criticals.length > 0) {
    attention.push({
      id: 'critical_finding',
      label: `${criticals.length} critical finding${criticals.length === 1 ? '' : 's'}`,
      detail: `Read the evidence for each: ${criticals
        .slice(0, 3)
        .map((finding) => finding.title)
        .join('; ')}${criticals.length > 3 ? '; …' : ''}.`,
    });
  }

  const lowConfidence = published.filter((finding) => finding.confidence === 'low');
  if (lowConfidence.length > 0) {
    attention.push({
      id: 'low_confidence',
      label: `${lowConfidence.length} low-confidence finding${lowConfidence.length === 1 ? '' : 's'}`,
      detail:
        'The engine was unsure about these, which is exactly what a reviewer is for. Confirm from the evidence or withhold them with a written reason.',
    });
  }

  if (input.certificationEligible) {
    const serious = published.filter(
      (finding) =>
        (finding.severity === 'high' || finding.severity === 'critical') &&
        (finding.dimension === 'security_posture' || finding.dimension === 'data_privacy_practice'),
    );
    if (serious.length > 0) {
      attention.push({
        id: 'certifying_with_high_severity',
        label: 'Certifying an application with serious security or privacy findings',
        detail: `This assessment is marked certification-eligible and carries ${serious.length} high or critical finding${serious.length === 1 ? '' : 's'} against security or privacy. The database refuses a critical one outright; a high one is your call, and the badge says something about it.`,
      });
    }
  }

  if (
    input.overallScore !== null &&
    Math.abs(input.overallScore - CERTIFICATION_THRESHOLD) <= NEAR_THRESHOLD_POINTS
  ) {
    attention.push({
      id: 'near_threshold',
      label: `Score ${input.overallScore.toFixed(1)} is close to the certification line`,
      detail: `Within ${NEAR_THRESHOLD_POINTS} points of ${CERTIFICATION_THRESHOLD}, which is where a single adjusted finding changes whether a badge exists. This is the one to be slow about.`,
    });
  }

  if (
    input.overallScore !== null &&
    input.previousScore !== null &&
    input.previousScore !== undefined &&
    Math.abs(input.overallScore - input.previousScore) >= LARGE_MOVE_POINTS
  ) {
    const direction = input.overallScore > input.previousScore ? 'rose' : 'fell';
    attention.push({
      id: 'large_move',
      label: `Score ${direction} ${Math.abs(input.overallScore - input.previousScore).toFixed(1)} points`,
      detail: `From ${input.previousScore.toFixed(1)} to ${input.overallScore.toFixed(1)}. A move this size is either a real change in the application or a difference in what the run reached. Which one it is decides whether a badge should move.`,
    });
  }

  // --- What was checked and found ordinary ----------------------------------

  if (unevidenced.length === 0 && published.length > 0) {
    routine.push(`All ${published.length} published findings carry evidence.`);
  }
  if (criticals.length === 0) routine.push('No critical findings.');
  if (lowConfidence.length === 0 && published.length > 0) {
    routine.push('Every finding is medium or high confidence.');
  }
  if (failed.length === 0) routine.push('Every stage completed.');
  if (input.gateFailures.length > 0) {
    routine.push(
      `The rubric gate already blocks certification: ${input.gateFailures.join('; ')}. Approving publishes the report without a badge.`,
    );
  }

  const counts = (['critical', 'high', 'medium', 'low'] as const)
    .map((severity) => ({ severity, n: bySeverity(severity).length }))
    .filter((entry) => entry.n > 0)
    .map((entry) => `${entry.n} ${entry.severity}`)
    .join(', ');

  const headline =
    published.length === 0
      ? 'No published findings.'
      : `${published.length} finding${published.length === 1 ? '' : 's'}${counts ? ` — ${counts}` : ''}${
          input.overallScore === null ? '' : `, scoring ${input.overallScore.toFixed(1)}`
        }.`;

  return {
    headline,
    attention,
    routine,
    suggestion: attention.length > 0 ? 'read_closely' : 'straightforward',
    // A minute to orient, plus a minute per thing that needs a person, plus
    // reading time for the findings themselves at roughly six to a minute.
    estimatedMinutes: Math.max(1, Math.round(1 + attention.length + published.length / 6)),
  };
}
