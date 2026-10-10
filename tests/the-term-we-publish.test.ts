/**
 * The rubric publishes how long a badge may last, and nothing read it.
 *
 * `certification.maximumBadgeValidityMonths` is `12` in both published
 * versions. `VALIDITY_MONTHS` in the worker gives a one-off badge twelve
 * months, and the comment above it says "twelve months is the outside limit" —
 * which restates the published number by hand. Two copies of one term, and the
 * day they disagree the badge in a customer's hands is the copy nobody checked.
 *
 * It refuses rather than clamping, for the same reason the plan lookup beside
 * it refuses an unknown plan: a clamp issues a badge on terms nobody chose,
 * quietly, and changes what we sold. A refusal stops one issuance and is read
 * by a person.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  VALIDITY_MONTHS,
  termWithinPublished,
  validityMonthsFor,
} from '../apps/worker/src/badge.ts';
import { getRubric, listRubricVersions } from '../packages/rubric/src/index.ts';
import { withoutComments } from './setup/source.ts';

describe('the term a plan gets', () => {
  it('is never longer than the term the rubric publishes, for any plan or version', () => {
    // The sweep that makes the rule true today rather than only enforceable.
    // It reads both lists rather than naming either, so a plan added to one or
    // a shorter maximum published in the other fails here.
    const plans = Object.entries(VALIDITY_MONTHS).filter(([, months]) => months > 0);
    expect(plans.length, 'no plan issues a badge at all').toBeGreaterThan(0);
    for (const version of listRubricVersions()) {
      const published = getRubric(version).certification.maximumBadgeValidityMonths;
      expect(Number.isFinite(published), `${version} publishes no maximum`).toBe(true);
      for (const [plan, months] of plans) {
        expect(validityMonthsFor(plan, version), `${plan} on ${version}`).toBe(months);
        expect(months, `${plan} on ${version}`).toBeLessThanOrEqual(published);
      }
    }
  });

  it('refuses a plan whose term is longer than the published maximum', () => {
    /*
     * The case that cannot be built from the published data, because the
     * published data agrees today — and there is deliberately no way to
     * register a rubric at run time, so the comparison is exercised on its
     * own. The refusal names both numbers, so whoever reads the log knows
     * which of the two to change.
     */
    expect(() => termWithinPublished('one_off', 12, 6, '1.1.0')).toThrow(
      /would issue a badge for 12 months.*publishes 6 months as the maximum/s,
    );
    expect(termWithinPublished('certified', 3, 3, '1.1.0')).toBe(3);
  });

  it('is what the lookup returns, so the comparison is actually wired in', () => {
    /*
     * The gap in the first version of this file, found by mutation: with the
     * check written as an assertion beside `return months`, deleting the call
     * left every test green. The sweep proved the published data agrees; the
     * hand-built case proved the comparison works; nothing proved the lookup
     * used it. Exactly the shape being swept for, written into the fix for it.
     *
     * Returning the approved number makes the checked path the shorter one,
     * and `return months` still compiles — nothing objects to an unused local
     * — so the wiring is read here. The same job `rubricVersionsValidated`
     * does for the rubric validator, done by reading the source because this
     * function keeps no state to inspect.
     */
    expect(validityMonthsFor('one_off', '1.1.0')).toBe(VALIDITY_MONTHS.one_off);
    const source = withoutComments(readFileSync('apps/worker/src/badge.ts', 'utf8'));
    const body = source.slice(
      source.indexOf('export function validityMonthsFor'),
      source.indexOf('export function termWithinPublished'),
    );
    expect(body, 'validityMonthsFor no longer calls the check').toMatch(
      /return termWithinPublished\(/,
    );
  });

  it('refuses a published maximum that is not a usable number', () => {
    // A rubric published without the field reads as `undefined`, and
    // `months > undefined` is false — so the check would have passed every
    // term ever, which is the shape this whole sweep keeps finding.
    expect(() =>
      termWithinPublished('one_off', 12, undefined as unknown as number, '1.1.0'),
    ).toThrow(/publishes no usable maximum/);
    expect(() => termWithinPublished('one_off', 12, 0, '1.1.0')).toThrow(
      /publishes no usable maximum/,
    );
  });

  it('still refuses a plan it has never heard of', () => {
    // The rule that was already here, kept: a plan whose terms nobody has
    // decided must not be decided by a default.
    expect(() => validityMonthsFor('enterprise_unlimited', '1.1.0')).toThrow(
      /No badge validity is defined/,
    );
  });

  it('refuses the free tier, which gets no badge', () => {
    expect(() => validityMonthsFor('free', '1.1.0')).toThrow(/No badge validity is defined/);
  });
});
