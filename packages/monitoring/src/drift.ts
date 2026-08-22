/**
 * What changed between two assessments.
 *
 * Pure: two snapshots in, one comparison out. No database, no clock, no
 * network. Everything that decides whether a badge stays up is computed here,
 * so it can be tested exhaustively without a container running.
 */
import type {
  AssessmentSnapshot,
  ComparableFinding,
  DimensionDelta,
  Drift,
  FindingChange,
  MonitoredDimension,
} from './types.ts';

/** Two findings are the same finding when the same rule fires on the same dimension. */
export function findingKey(finding: Pick<ComparableFinding, 'ruleId' | 'dimension'>): string {
  return `${finding.dimension}:${finding.ruleId}`;
}

const SEVERITY_RANK: Readonly<Record<ComparableFinding['severity'], number>> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function severityRank(severity: ComparableFinding['severity']): number {
  return SEVERITY_RANK[severity];
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function toChange(finding: ComparableFinding): FindingChange {
  return {
    key: findingKey(finding),
    ruleId: finding.ruleId,
    dimension: finding.dimension,
    severity: finding.severity,
    title: finding.title,
  };
}

/**
 * Only published findings are compared.
 *
 * A withheld finding never reached the customer and never moved the score, so
 * treating one as "resolved" when it disappears would credit the customer for
 * fixing something they were never told about — and treating one as "new" would
 * suspend a badge over an accusation we ourselves refused to publish.
 */
function publishedByKey(snapshot: AssessmentSnapshot): Map<string, ComparableFinding> {
  const map = new Map<string, ComparableFinding>();
  for (const finding of snapshot.findings) {
    if (!finding.isPublished) continue;
    const key = findingKey(finding);
    const existing = map.get(key);
    // The same rule can fire more than once. Keep the worst instance: a
    // comparison that quietly dropped the critical one would be worse than useless.
    if (!existing || severityRank(finding.severity) > severityRank(existing.severity)) {
      map.set(key, finding);
    }
  }
  return map;
}

function dimensionDeltas(
  previous: AssessmentSnapshot,
  current: AssessmentSnapshot,
): DimensionDelta[] {
  const before = new Map<MonitoredDimension, number>(
    previous.dimensions.map((entry) => [entry.dimension, entry.score]),
  );
  const after = new Map<MonitoredDimension, number>(
    current.dimensions.map((entry) => [entry.dimension, entry.score]),
  );
  const dimensions = [...new Set([...before.keys(), ...after.keys()])].sort();
  return dimensions.map((dimension) => {
    const a = before.get(dimension) ?? 0;
    const b = after.get(dimension) ?? 0;
    return { dimension, before: round(a), after: round(b), delta: round(b - a) };
  });
}

/**
 * Compares the assessment that just finished against the one before it.
 *
 * `comparable` is false when the two runs used different rubric versions. The
 * comparison is still produced — a customer is entitled to see the numbers —
 * but nothing downstream may suspend a badge on it, because a score movement
 * caused by us changing the standard is our change, not theirs.
 */
export function computeDrift(previous: AssessmentSnapshot, current: AssessmentSnapshot): Drift {
  if (previous.assessmentId === current.assessmentId) {
    throw new Error('Drift compares two different assessments; the same id was given twice.');
  }

  const before = publishedByKey(previous);
  const after = publishedByKey(current);

  const newFindings: FindingChange[] = [];
  const persistingFindings: FindingChange[] = [];
  const escalatedFindings: (FindingChange & { wasSeverity: ComparableFinding['severity'] })[] = [];

  for (const [key, finding] of after) {
    const was = before.get(key);
    if (!was) {
      newFindings.push(toChange(finding));
      continue;
    }
    persistingFindings.push(toChange(finding));
    if (severityRank(finding.severity) > severityRank(was.severity)) {
      escalatedFindings.push({ ...toChange(finding), wasSeverity: was.severity });
    }
  }

  const resolvedFindings: FindingChange[] = [];
  for (const [key, finding] of before) {
    if (!after.has(key)) resolvedFindings.push(toChange(finding));
  }

  const byKey = (a: FindingChange, b: FindingChange) => a.key.localeCompare(b.key);
  newFindings.sort(byKey);
  resolvedFindings.sort(byKey);
  persistingFindings.sort(byKey);
  escalatedFindings.sort(byKey);

  const rubricVersionChanged = previous.rubricVersion !== current.rubricVersion;

  return {
    previousAssessmentId: previous.assessmentId,
    assessmentId: current.assessmentId,
    scoreBefore: round(previous.overallScore),
    scoreAfter: round(current.overallScore),
    scoreDelta: round(current.overallScore - previous.overallScore),
    dimensionDeltas: dimensionDeltas(previous, current),
    newFindings,
    resolvedFindings,
    persistingFindings,
    escalatedFindings,
    certificationBefore: previous.certificationEligible,
    certificationAfter: current.certificationEligible,
    certificationLost: previous.certificationEligible && !current.certificationEligible,
    rubricVersionChanged,
    comparable: !rubricVersionChanged,
  };
}
