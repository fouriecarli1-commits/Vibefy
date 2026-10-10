/**
 * The rubric, loaded as versioned data.
 *
 * Rubric definitions are JSON, not code, and a published version is frozen:
 * a rubric change never retroactively alters an issued score. Every report and
 * badge records the exact version it was scored against.
 */
import { createHash } from 'node:crypto';
import rubricV1 from '../versions/1.0.0.json' with { type: 'json' };
import rubricV11 from '../versions/1.1.0.json' with { type: 'json' };
import type { FindingSeverity, ConfidenceLevel, RubricDimensionId } from './types.ts';

export interface RubricBand {
  readonly min: number;
  readonly max: number;
  readonly label: string;
  readonly meaning: string;
}

export interface RubricGate {
  readonly id: string;
  readonly label: string;
  readonly appliesToDimensions?: readonly string[];
  readonly appliesToRules?: readonly string[];
  readonly triggerSeverity?: string;
  readonly capOverallAt?: number;
  readonly blocksCertification: boolean;
  readonly rationale: string;
}

export interface RubricDimension {
  readonly id: string;
  readonly label: string;
  readonly weight: number;
  readonly question: string;
  readonly note?: string;
  readonly criteria: readonly {
    readonly id: string;
    readonly label: string;
    readonly requiredEvidence: readonly string[];
  }[];
}

export interface RubricDefinition {
  readonly version: string;
  readonly name: string;
  readonly status: string;
  readonly changelog: string;
  readonly certification: {
    readonly overallThreshold: number;
    readonly dimensionFloors: Readonly<Record<string, number>>;
    readonly maximumBadgeValidityMonths: number;
  };
  readonly scoring: {
    readonly method: string;
    readonly severityPenalties: Readonly<Record<FindingSeverity, number>>;
    readonly confidenceMultipliers: Readonly<Record<ConfidenceLevel, number>>;
    readonly roundingDecimals: number;
  };
  readonly bands: readonly RubricBand[];
  readonly gates: readonly RubricGate[];
  readonly dimensions: readonly RubricDimension[];
}

const REGISTRY: Readonly<Record<string, RubricDefinition>> = {
  '1.0.0': rubricV1 as unknown as RubricDefinition,
  '1.1.0': rubricV11 as unknown as RubricDefinition,
};

/**
 * What a new assessment is scored against.
 *
 * Published versions stay in the registry for ever. A badge issued against
 * 1.0.0 is verified against 1.0.0 until it expires, and the page that displays
 * it says which version it was — a score recomputed against a rubric that did
 * not exist when it was earned is not the score anybody agreed to.
 */
export const CURRENT_RUBRIC_VERSION = '1.1.0';

export function listRubricVersions(): readonly string[] {
  return Object.keys(REGISTRY);
}

/**
 * A published rubric this code cannot score against.
 *
 * Its own class, so a caller can tell a malformed rubric from a missing one:
 * the first is our data being wrong and the second is a version nobody has.
 */
export class MalformedRubricError extends Error {
  constructor(version: string, what: string) {
    super(
      `Rubric ${version} is published with ${what}, so nothing may be scored against it. ` +
        'A gate that cannot say whether it blocks certification is a gate that does not block it.',
    );
    this.name = 'MalformedRubricError';
  }
}

/**
 * The gates, checked once per version.
 *
 * `scoring.ts` guards two lookups into published rubric data and says why: "one
 * typographical error in a future rubric away from a finding that is free —
 * silently, and on everybody's score at once." The gate fields are the same
 * kind of data and were not guarded, and they are worse. The JSON reaches this
 * module through `as unknown as RubricDefinition`, so the `blocksCertification:
 * boolean` in the interface is a promise about data nobody checks: a future
 * gate published without it reads as `undefined`, `certificationBlockers`
 * treats that as falsy, and the gate is applied while blocking nothing. That is
 * a badge issued to an application with a critical security finding, from a
 * missing line in a JSON file.
 *
 * Memoised because `getRubric` is called from `isRubricDimensionId` and from
 * every score, and this is a loop over three gates that cannot change at
 * runtime.
 */
const validated = new Set<string>();

/**
 * Exported so a test can hand it a malformed definition.
 *
 * The registry holds module constants, and the defect this guards against is a
 * future edit to one of them rather than a value anybody can inject today — so
 * without a seam the only way to test the guard is to make the registry
 * writable, which is a worse thing to do to this package.
 */
export function assertRubricIsScorable(definition: RubricDefinition): void {
  if (validated.has(definition.version)) return;

  /*
   * The weights are the arithmetic.
   *
   * `scoreAssessment` computes `dimensions.reduce((total, d) => total + d.score
   * * d.weight, 0)` and takes that as the overall score out of 100, which is
   * only true if the weights sum to one. Weights summing to 0.9 depress every
   * score in the product by a tenth; 1.1 inflates every one. Neither shows up
   * as an error anywhere — the number is simply wrong, on every badge, and
   * reads exactly like a number that is right.
   *
   * It was asserted in `packages/rubric/src/scoring.test.ts`, for the current
   * version only, because that test calls `getRubric()` with no argument. A
   * score recomputed against an older version — which the file's own comment
   * says never happens, but the registry still holds them — went unchecked.
   * Here it is checked for whichever version is about to score something.
   *
   * No dimensions at all is the same defect with a cleaner edge: the reduce
   * returns 0 and every application scores zero.
   */
  if (definition.dimensions.length === 0) {
    throw new MalformedRubricError(definition.version, 'no dimensions, so nothing to score');
  }
  for (const dimension of definition.dimensions) {
    if (!Number.isFinite(dimension.weight) || dimension.weight <= 0) {
      throw new MalformedRubricError(
        definition.version,
        `a dimension (${dimension.id}) whose weight is ${JSON.stringify(dimension.weight)}`,
      );
    }
  }
  const weightTotal = definition.dimensions.reduce((total, d) => total + d.weight, 0);
  if (Number(weightTotal.toFixed(10)) !== 1) {
    throw new MalformedRubricError(
      definition.version,
      `dimension weights summing to ${weightTotal} rather than 1, which makes every score it ` +
        'produces wrong by that factor',
    );
  }

  for (const gate of definition.gates) {
    const named = gate.id || '(a gate with no id)';
    if (typeof gate.id !== 'string' || gate.id.length === 0) {
      throw new MalformedRubricError(definition.version, 'a gate that has no id');
    }
    if (typeof gate.blocksCertification !== 'boolean') {
      throw new MalformedRubricError(
        definition.version,
        `a gate (${named}) whose blocksCertification is not true or false`,
      );
    }
    // The label is printed in `certificationBlockers`, which is what a customer
    // reads when their badge is withheld, and the rationale is what the
    // published rubric owes them as the reason.
    if (typeof gate.label !== 'string' || gate.label.trim().length === 0) {
      throw new MalformedRubricError(definition.version, `a gate (${named}) with no label`);
    }
    if (typeof gate.rationale !== 'string' || gate.rationale.trim().length === 0) {
      throw new MalformedRubricError(definition.version, `a gate (${named}) with no rationale`);
    }
    if (gate.capOverallAt !== undefined && !Number.isFinite(gate.capOverallAt)) {
      throw new MalformedRubricError(
        definition.version,
        `a gate (${named}) whose capOverallAt is not a number`,
      );
    }
  }
  validated.add(definition.version);
}

export function getRubric(version: string = CURRENT_RUBRIC_VERSION): RubricDefinition {
  const definition = REGISTRY[version];
  if (!definition) {
    throw new Error(
      `Unknown rubric version "${version}". Known versions: ${listRubricVersions().join(', ')}. ` +
        'Scores are never recomputed against a different version than the one recorded.',
    );
  }
  assertRubricIsScorable(definition);
  return definition;
}

/** For a test that needs the check to run again on the same version. */
export function forgetRubricValidation(): void {
  validated.clear();
}

/**
 * Which versions have been through the check.
 *
 * Exported so a test can see that `getRubric` runs it, rather than only that
 * the check works when called directly. Removing the call from `getRubric`
 * left a first version of that test green, which is the same gap as a guard
 * nobody wired in: the rule held and nothing used it.
 */
export function rubricVersionsValidated(): readonly string[] {
  return [...validated];
}

/**
 * Canonical checksum of a rubric version, stored alongside every score. If this
 * ever changes for a published version, a published rubric has been edited —
 * which the database also refuses.
 */
export function rubricChecksum(version: string = CURRENT_RUBRIC_VERSION): string {
  return createHash('sha256')
    .update(canonicalise(getRubric(version)))
    .digest('hex');
}

/** Stable stringification: key order must not change a checksum. */
function canonicalise(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !key.startsWith('$'))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, inner]) => `${JSON.stringify(key)}:${canonicalise(inner)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function isRubricDimensionId(value: string): value is RubricDimensionId {
  return getRubric().dimensions.some((dimension) => dimension.id === value);
}
