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
import {
  assertRubricIsScorable,
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

  it('accepts a gate that is complete', () => {
    // The half that makes the other half mean something. A validator that
    // refused everything would stop every score in the product.
    expect(() =>
      check(
        withGate({ id: 'GATE-OK', label: 'OK', rationale: 'because', blocksCertification: false }),
      ),
    ).not.toThrow();
  });
});
