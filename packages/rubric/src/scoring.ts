/**
 * Scoring.
 *
 * The only argument is a ScoringInput, which structurally cannot carry a plan,
 * a price or a marketing relationship. There is no second argument, no options
 * object and no context parameter — adding one would be the obvious way to
 * reintroduce commercial influence, so the signature is kept closed on purpose.
 */
import { getRubric, type RubricDefinition, type RubricGate } from './rubric.ts';
import type {
  AppliedGate,
  DimensionScore,
  ScoringFinding,
  ScoringInput,
  ScoringResult,
} from './types.ts';

export function scoreAssessment(input: ScoringInput): ScoringResult {
  const rubric = getRubric(input.rubricVersion);
  const published = input.findings.filter((finding) => finding.isPublished);

  const dimensions = rubric.dimensions.map((dimension) =>
    scoreDimension(rubric, dimension.id, dimension.weight, published),
  );

  const weighted = dimensions.reduce((total, d) => total + d.score * d.weight, 0);
  let overall = round(weighted, rubric.scoring.roundingDecimals);

  const gatesApplied = applicableGates(rubric, published, input.coreFlowsUnreachable);
  for (const gate of gatesApplied) {
    if (gate.capOverallAt !== null) overall = Math.min(overall, gate.capOverallAt);
  }

  const blockers = certificationBlockers(rubric, dimensions, overall, gatesApplied);

  return {
    rubricVersion: rubric.version,
    overallScore: overall,
    band: bandFor(rubric, overall),
    dimensions,
    gatesApplied,
    certificationEligible: blockers.length === 0,
    certificationBlockers: blockers,
  };
}

function scoreDimension(
  rubric: RubricDefinition,
  dimensionId: string,
  weight: number,
  findings: readonly ScoringFinding[],
): DimensionScore {
  const penalty = findings
    .filter((finding) => finding.dimension === dimensionId)
    .reduce((total, finding) => {
      const severity = rubric.scoring.severityPenalties[finding.severity] ?? 0;
      const confidence = rubric.scoring.confidenceMultipliers[finding.confidence] ?? 1;
      return total + severity * confidence;
    }, 0);

  const score = round(clamp(100 - penalty, 0, 100), rubric.scoring.roundingDecimals);

  return {
    dimension: dimensionId as DimensionScore['dimension'],
    score,
    weight,
    penaltyApplied: round(penalty, rubric.scoring.roundingDecimals),
    band: bandFor(rubric, score),
  };
}

/**
 * Gates are applied after arithmetic and can only lower a result. A single
 * critical exposure makes the rest of the score irrelevant, and no combination
 * of strong dimensions may outvote that.
 */
function applicableGates(
  rubric: RubricDefinition,
  findings: readonly ScoringFinding[],
  coreFlowsUnreachable: boolean,
): AppliedGate[] {
  const applied: AppliedGate[] = [];

  for (const gate of rubric.gates) {
    if (gateTriggers(gate, findings, coreFlowsUnreachable)) {
      applied.push({
        id: gate.id,
        label: gate.label,
        capOverallAt: gate.capOverallAt ?? null,
        blocksCertification: gate.blocksCertification,
      });
    }
  }

  return applied;
}

function gateTriggers(
  gate: RubricGate,
  findings: readonly ScoringFinding[],
  coreFlowsUnreachable: boolean,
): boolean {
  if (gate.id === 'GATE-NO-AUTHORISATION-COVERAGE') return coreFlowsUnreachable;

  return findings.some((finding) => {
    if (gate.triggerSeverity && finding.severity !== gate.triggerSeverity) return false;
    if (gate.appliesToRules && !gate.appliesToRules.includes(finding.ruleId)) return false;
    if (gate.appliesToDimensions && !gate.appliesToDimensions.includes(finding.dimension))
      return false;
    return Boolean(gate.appliesToRules ?? gate.appliesToDimensions);
  });
}

function certificationBlockers(
  rubric: RubricDefinition,
  dimensions: readonly DimensionScore[],
  overall: number,
  gates: readonly AppliedGate[],
): string[] {
  const blockers: string[] = [];

  for (const gate of gates) {
    if (gate.blocksCertification) blockers.push(`${gate.id}: ${gate.label}`);
  }

  if (overall < rubric.certification.overallThreshold) {
    blockers.push(
      `Overall score ${overall} is below the published certification threshold of ${rubric.certification.overallThreshold}`,
    );
  }

  for (const [dimensionId, floor] of Object.entries(rubric.certification.dimensionFloors)) {
    const dimension = dimensions.find((d) => d.dimension === dimensionId);
    if (dimension && dimension.score < floor) {
      blockers.push(`${dimensionId} scored ${dimension.score}, below its floor of ${floor}`);
    }
  }

  return blockers;
}

function bandFor(rubric: RubricDefinition, score: number): string {
  const band = rubric.bands.find((candidate) => score >= candidate.min && score <= candidate.max);
  return band?.label ?? 'Unbanded';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
