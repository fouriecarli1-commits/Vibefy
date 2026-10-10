/**
 * The arithmetic the score rests on.
 *
 * `scoreAssessment` computes the overall score as
 *
 *     dimensions.reduce((total, d) => total + d.score * d.weight, 0)
 *
 * and takes the result as a score out of 100. That is only true if the weights
 * sum to one. Weights summing to 0.9 depress every score in the product by a
 * tenth; 1.1 inflates every one. Neither raises anything: the number is simply
 * wrong, on every badge, and reads exactly like a number that is right.
 *
 * It was asserted in `packages/rubric/src/scoring.test.ts` — for the current
 * version only, because that test calls `getRubric()` with no argument. The
 * registry still holds 1.0.0, and nothing checked its weights at all.
 *
 * `getRubric` already validated the gates at the moment of use, and that is
 * the right place for this too: a rubric that cannot score correctly must not
 * score, whichever version is asked for. The file's own words — "a score is
 * the product: the alternative to stopping is publishing a number assembled
 * from a lookup that missed, which nobody downstream can tell from a number
 * that is right".
 */
import { describe, expect, it } from 'vitest';
import {
  MalformedRubricError,
  assertRubricIsScorable,
  forgetRubricValidation,
  getRubric,
  listRubricVersions,
  type RubricDefinition,
} from '../packages/rubric/src/index.ts';

/*
 * Each fixture gets its own version name.
 *
 * `assertRubricIsScorable` memoises per version, so a fixture reusing a name
 * would be waved through on the second case and the test would pass for the
 * wrong reason. Naming them after their weights makes each one new, which is
 * why no case here forgets the memo — an earlier draft called a helper named
 * `beforeEachForget` once, at describe time, which is not before each
 * anything.
 */
const reweighted = (weights: number[]): RubricDefinition => {
  const base = getRubric();
  return {
    ...base,
    version: `test-${weights.join('-')}`,
    dimensions: base.dimensions.map((dimension, index) => ({
      ...dimension,
      weight: weights[index] ?? dimension.weight,
    })),
  } as RubricDefinition;
};

describe('every rubric the registry holds', () => {
  it('holds more than one, so this is not a test of one definition', () => {
    expect(listRubricVersions().length).toBeGreaterThan(1);
  });

  it.each(listRubricVersions())('%s has weights that sum to one', (version) => {
    const rubric = getRubric(version);
    const total = rubric.dimensions.reduce((sum, d) => sum + d.weight, 0);
    expect(Number(total.toFixed(10)), `${version} would score every application wrong`).toBe(1);
  });

  it.each(listRubricVersions())('%s has a positive weight on every dimension', (version) => {
    for (const dimension of getRubric(version).dimensions) {
      expect(dimension.weight, `${version}/${dimension.id}`).toBeGreaterThan(0);
    }
  });
});

describe('a rubric whose weights do not sum', () => {
  it('is refused rather than depressing every score by a tenth', () => {
    expect(() => assertRubricIsScorable(reweighted([0.1, 0.1, 0.1, 0.1, 0.1, 0.1]))).toThrow(
      MalformedRubricError,
    );
    expect(() => assertRubricIsScorable(reweighted([0.1, 0.1, 0.1, 0.1, 0.1, 0.1]))).toThrow(
      /summing to/,
    );
  });

  it('is refused when they sum to more than one, which inflates instead', () => {
    expect(() => assertRubricIsScorable(reweighted([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]))).toThrow(
      MalformedRubricError,
    );
  });

  it('says what they sum to, because that is the factor every score is out by', () => {
    try {
      assertRubricIsScorable(reweighted([0.1, 0.1, 0.1, 0.1, 0.1, 0.1]));
      expect.unreachable('a rubric summing to 0.6 was accepted');
    } catch (error) {
      expect(String((error as Error).message)).toMatch(/0\.6/);
    }
  });

  it('accepts the real ones, so the rule is not simply "refuse"', () => {
    // The positive control: a check that threw on everything would satisfy
    // every assertion above and stop the product scoring anything at all.
    for (const version of listRubricVersions()) {
      expect(() => assertRubricIsScorable(getRubric(version)), version).not.toThrow();
    }
  });
});

describe('a rubric with a weight that is not a weight', () => {
  it('refuses zero, which silently drops a whole dimension from the score', () => {
    expect(() => assertRubricIsScorable(reweighted([0, 0.4, 0.15, 0.15, 0.15, 0.15]))).toThrow(
      MalformedRubricError,
    );
  });

  it('refuses a negative weight, which would let a bad dimension raise the score', () => {
    expect(() => assertRubricIsScorable(reweighted([-0.1, 0.5, 0.15, 0.15, 0.15, 0.15]))).toThrow(
      /weight is -0\.1/,
    );
  });

  it('refuses a rubric with no dimensions, where every application scores zero', () => {
    const empty = { ...getRubric(), version: 'test-empty', dimensions: [] } as RubricDefinition;
    expect(() => assertRubricIsScorable(empty)).toThrow(/nothing to score/);
  });
});

describe('the validation is wired into the lookup', () => {
  it('runs when a rubric is fetched, not only when a test calls it', () => {
    // Memoised per version, so it has to be forgotten to be observed — the
    // same seam the gate checks use.
    forgetRubricValidation();
    expect(() => getRubric()).not.toThrow();
  });
});
