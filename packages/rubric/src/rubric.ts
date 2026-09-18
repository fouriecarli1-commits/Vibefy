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

export function getRubric(version: string = CURRENT_RUBRIC_VERSION): RubricDefinition {
  const definition = REGISTRY[version];
  if (!definition) {
    throw new Error(
      `Unknown rubric version "${version}". Known versions: ${listRubricVersions().join(', ')}. ` +
        'Scores are never recomputed against a different version than the one recorded.',
    );
  }
  return definition;
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
