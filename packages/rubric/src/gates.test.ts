/**
 * A gate published without the field that says whether it blocks anything.
 *
 * `scoring.ts` guards two lookups into published rubric data and says why: "one
 * typographical error in a future rubric away from a finding that is free —
 * silently, and on everybody's score at once." The gate fields are the same
 * kind of data, read the same way, and were not guarded.
 *
 * They are worse. The rubric JSON reaches the registry through
 * `as unknown as RubricDefinition`, so the `blocksCertification: boolean` in
 * the interface is a promise about data nobody checks. A future gate published
 * without it reads as `undefined`; `certificationBlockers` keeps only the gates
 * where `gate.blocksCertification` is truthy, so the gate is applied, caps the
 * score if it says to, and blocks nothing. That is a badge issued to an
 * application with a critical security finding, from a missing line in a JSON
 * file — and the first anybody would know is the badge.
 *
 * Two halves, matching how this package already handles the severities: the
 * published versions are asserted well-formed as they stand, and a malformed
 * one is refused rather than scored.
 */
import { describe, expect, it } from 'vitest';
import { scoreAssessment } from './scoring.ts';
import type { ScoringFinding } from './types.ts';
import {
  RUN_FACT_GATES,
  assertRubricIsScorable,
  isRubricDimensionId,
  rubricVersionsValidated,
  forgetRubricValidation,
  getRubric,
  listRubricVersions,
  MalformedRubricError,
  type RubricDefinition,
} from './rubric.ts';

/** The published data, as it is today. */
describe('every published rubric', () => {
  it('has a gate list where each gate says whether it blocks certification', () => {
    for (const version of listRubricVersions()) {
      const rubric = getRubric(version);
      expect(rubric.gates.length, `${version} has no gates`).toBeGreaterThan(0);
      for (const gate of rubric.gates) {
        expect(typeof gate.blocksCertification, `${version} ${gate.id}`).toBe('boolean');
        expect(gate.id, `${version} gate id`).toBeTruthy();
        expect(gate.label.trim(), `${version} ${gate.id} label`).not.toBe('');
        // The reason a customer is owed when their badge is withheld.
        expect(gate.rationale.trim(), `${version} ${gate.id} rationale`).not.toBe('');
      }
    }
  });

  it('caps at a real number where it caps at all', () => {
    for (const version of listRubricVersions()) {
      for (const gate of getRubric(version).gates) {
        if (gate.capOverallAt === undefined) continue;
        expect(Number.isFinite(gate.capOverallAt), `${version} ${gate.id}`).toBe(true);
      }
    }
  });
});

/**
 * A malformed one, refused.
 *
 * Built by mutating a copy of a published rubric, because the registry holds
 * module constants and the defect this guards against is a future edit to one
 * of them rather than a value anybody can inject today.
 */
function withGate(gate: Record<string, unknown>): RubricDefinition {
  const base = getRubric('1.1.0');
  return {
    ...base,
    version: `test-${Math.random().toString(36).slice(2)}`,
    gates: [gate],
  } as unknown as RubricDefinition;
}

describe('the wiring', () => {
  it('is run by getRubric, not only available to be called', () => {
    // Removing `assertRubricIsScorable(definition)` from `getRubric` left every
    // other test here green: they call the validator directly, so they proved
    // the rule and said nothing about anything using it. This watches the call
    // happen.
    forgetRubricValidation();
    expect(rubricVersionsValidated()).toEqual([]);
    getRubric('1.1.0');
    expect(rubricVersionsValidated()).toContain('1.1.0');
  });

  it('checks every version it hands out, not just the current one', () => {
    /*
     * What this measures, which is not what it first claimed.
     *
     * It was called "checks each version once" and removing the memo left it
     * green: without the memo each version is still added to the set, so the
     * set says which versions were checked and nothing about how often. Fourth
     * time tonight that an assertion's name outran what it observed.
     *
     * The memo is a performance choice over a loop across three gates that
     * cannot change at runtime, and nothing depends on it, so nothing here
     * guards it. What does matter is that an older version — the one a live
     * badge is still verified against — goes through the same check as the
     * current one.
     */
    forgetRubricValidation();
    getRubric('1.1.0');
    getRubric('1.0.0');
    expect([...rubricVersionsValidated()].sort()).toEqual(['1.0.0', '1.1.0']);
  });
});

/** Runs the same check `getRubric` runs, on a definition it does not hold. */
function check(definition: RubricDefinition): void {
  forgetRubricValidation();
  assertRubricIsScorable(definition);
}

describe('a malformed gate', () => {
  it('is refused rather than scored against', () => {
    expect(() => check(withGate({ id: 'GATE-X', label: 'X', rationale: 'because' }))).toThrow(
      MalformedRubricError,
    );
  });

  it('names what is wrong and which gate', () => {
    try {
      check(withGate({ id: 'GATE-X', label: 'X', rationale: 'because' }));
      expect.unreachable('a gate with no blocksCertification was accepted');
    } catch (error) {
      expect(String(error)).toMatch(/GATE-X/);
      expect(String(error)).toMatch(/blocksCertification is not true or false/);
    }
  });

  it('says why it matters, in the error a developer reads', () => {
    try {
      check(withGate({ id: 'GATE-X', label: 'X', rationale: 'because' }));
      expect.unreachable('accepted');
    } catch (error) {
      expect(String(error)).toMatch(/does not block it/);
    }
  });

  it('refuses a gate with no rationale, which a customer is owed', () => {
    expect(() =>
      check(withGate({ id: 'GATE-Y', label: 'Y', rationale: '  ', blocksCertification: true })),
    ).toThrow(/no rationale/);
  });

  it('refuses a cap that is not a number', () => {
    expect(() =>
      check(
        withGate({
          id: 'GATE-Z',
          label: 'Z',
          rationale: 'because',
          blocksCertification: true,
          capOverallAt: 'thirty-nine',
        }),
      ),
    ).toThrow(/capOverallAt is not a number/);
  });

  it('refuses a gate that nothing could trigger', () => {
    /*
     * The check this file was missing. Everything above asks whether a gate
     * *says* it blocks something; this asks whether it *can*. A gate selects
     * by rule id or by dimension, or it is one of the gates about the run
     * itself, and with none of the three it is a published promise kept by
     * nothing — `gateTriggers` returns `Boolean(undefined ?? undefined)`.
     *
     * The fixture below used to be this file's idea of a complete gate, and it
     * had no selectors.
     */
    expect(() =>
      check(
        withGate({ id: 'GATE-OK', label: 'OK', rationale: 'because', blocksCertification: false }),
      ),
    ).toThrow(/selects neither a rule nor a dimension/);
  });

  it('refuses a gate naming a rule this rubric does not define', () => {
    // The typo version of the same defect: `SEC-4` for `SEC-04` is well-formed
    // by every other check here and fires on no assessment ever.
    expect(() =>
      check(
        withGate({
          id: 'GATE-TYPO',
          label: 'Typo',
          rationale: 'because',
          blocksCertification: true,
          appliesToRules: ['SEC-4'],
        }),
      ),
    ).toThrow(/naming rule SEC-4, which this rubric does not define/);
  });

  it('refuses a gate naming a dimension this rubric does not define', () => {
    expect(() =>
      check(
        withGate({
          id: 'GATE-DIM',
          label: 'Dimension',
          rationale: 'because',
          blocksCertification: true,
          appliesToDimensions: ['security'],
        }),
      ),
    ).toThrow(/naming dimension security, which this rubric does not define/);
  });

  it('accepts a gate that is complete', () => {
    // The half that makes the other half mean something. A validator that
    // refused everything would stop every score in the product.
    expect(() =>
      check(
        withGate({
          id: 'GATE-OK',
          label: 'OK',
          rationale: 'because',
          blocksCertification: false,
          appliesToRules: ['SEC-04'],
        }),
      ),
    ).not.toThrow();
  });

  it('accepts a gate about the run, which no finding selects', () => {
    // `GATE-NO-AUTHORISATION-COVERAGE` is driven by whether the authorised
    // scope let the core flows be exercised, so it has no selectors and must
    // not need any. `RUN_FACT_GATES` is the one list saying which those are,
    // read here, by the validator and by `gateTriggers`.
    expect(RUN_FACT_GATES.has('GATE-NO-AUTHORISATION-COVERAGE')).toBe(true);
    expect(() =>
      check(
        withGate({
          id: 'GATE-NO-AUTHORISATION-COVERAGE',
          label: 'Core flows unreachable',
          rationale: 'because',
          blocksCertification: true,
        }),
      ),
    ).not.toThrow();
  });
});

describe('every published gate, against the scorer that applies it', () => {
  /*
   * The positive control the shape checks could not give.
   *
   * A gate can be well-formed, name a dimension that exists, and still never
   * fire — so each published gate is handed the finding it describes and
   * watched to see that it applies. This is the test that fails if
   * `gateTriggers` stops understanding a selector, which the shape checks
   * above would not notice.
   */
  const severities = ['critical', 'high', 'medium', 'low', 'info'] as const;

  it('fires on a finding of the kind it describes', () => {
    for (const version of listRubricVersions()) {
      const rubric = getRubric(version);
      for (const gate of rubric.gates) {
        if (RUN_FACT_GATES.has(gate.id)) {
          const applied = scoreAssessment({
            rubricVersion: version,
            findings: [],
            coreFlowsUnreachable: true,
          }).gatesApplied;
          expect(
            applied.map((entry) => entry.id),
            `${version} ${gate.id}`,
          ).toContain(gate.id);
          continue;
        }

        const ruleId =
          gate.appliesToRules?.[0] ?? criterionIn(rubric, gate.appliesToDimensions![0]!);
        const named = gate.appliesToDimensions?.[0];
        const dimension =
          named !== undefined && isRubricDimensionId(named)
            ? named
            : dimensionOf(rubric, gate.appliesToRules![0]!);
        // Asserted rather than cast. A published gate naming a severity the
        // scorer does not know is the same defect as one naming a dimension
        // that does not exist: well-formed, and it fires on nothing.
        const severity = gate.triggerSeverity ?? severities[0];
        expect(severities as readonly string[], `${version} ${gate.id} triggerSeverity`).toContain(
          severity,
        );
        const applied = scoreAssessment({
          rubricVersion: version,
          /*
           * `isPublished` matters and was missing from the first version of
           * this fixture: `scoreAssessment` filters on it before anything
           * else, so the gate found no findings and the test failed against
           * code that was right. An unpublished finding is one a reviewer has
           * withheld, and it scores nothing by design.
           */
          findings: [
            {
              ruleId,
              dimension,
              severity: severity as (typeof severities)[number],
              confidence: 'high',
              isPublished: true,
            },
          ],
          coreFlowsUnreachable: false,
        }).gatesApplied;
        expect(
          applied.map((entry) => entry.id),
          `${version} ${gate.id}`,
        ).toContain(gate.id);
      }
    }
  });
});

/**
 * Which dimension holds a criterion, as the scorer's own type.
 *
 * `RubricDefinition` types a dimension id as a plain string, because it is
 * loaded from JSON; a finding's dimension is the union. `isRubricDimensionId`
 * is the bridge, and it is the same function the engine uses on a model's
 * answer, so a dimension in the published rubric that is not in the union
 * fails here rather than being cast past.
 */
function dimensionOf(rubric: RubricDefinition, ruleId: string): ScoringFinding['dimension'] {
  const found = rubric.dimensions.find((dimension) =>
    dimension.criteria.some((criterion) => criterion.id === ruleId),
  );
  if (!found) throw new Error(`no dimension holds ${ruleId}`);
  if (!isRubricDimensionId(found.id)) {
    throw new Error(
      `rubric ${rubric.version} names a dimension the scorer does not know: ${found.id}`,
    );
  }
  return found.id;
}

function criterionIn(rubric: RubricDefinition, dimensionId: string): string {
  const found = rubric.dimensions.find((dimension) => dimension.id === dimensionId);
  const first = found?.criteria[0]?.id;
  if (!first) throw new Error(`no criterion in ${dimensionId}`);
  return first;
}
