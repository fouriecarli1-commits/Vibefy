/**
 * The copy gate, at run time, for words we did not write.
 *
 * Everything else that gate guards is written by us and checked when the
 * repository is built. A trust page is the first surface where a customer types
 * something that appears beside our mark, and the build knows nothing about
 * what they will type.
 *
 * The risk is specific rather than general. Somebody who has just earned a
 * badge, writing about their own application on a page carrying our seal, will
 * reach for exactly the words the mark does not support. Most of them mean no
 * harm. All of them produce a page that says we made a claim we did not make.
 *
 * The test that matters most here is the last one: the run-time list and the
 * build-time list have to be the same list. Two would disagree within a
 * release, and the one facing the public would be the one nobody maintained.
 */
import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN_CLAIMS,
  MARK_EXTENSION,
  checkClaim,
} from '../packages/shared/src/claim-check.ts';
import { FORBIDDEN_PHRASES, MARK_EXTENSION_PATTERN } from '../tools/copy-lint.mjs';

describe('what a customer may not write beside our mark', () => {
  it.each([...FORBIDDEN_CLAIMS])('refuses “%s”', (phrase) => {
    const verdict = checkClaim(`Our app is ${phrase} and very fast.`);
    expect(verdict.ok).toBe(false);
    expect(verdict.matched).toBe(phrase);
  });

  it('refuses anything of the shape “VibefyCode <strong word>”', () => {
    for (const claim of [
      'VibefyCode verified',
      'VibefyCode-certified',
      'certified by VibefyCode',
      'approved by VibefyCode',
    ]) {
      const verdict = checkClaim(`We are ${claim}.`);
      expect(verdict.ok, claim).toBe(false);
    }
  });

  it('refuses the old brand name', () => {
    // A half-renamed sentence reads fine to whoever wrote it, which is how the
    // wrong name reaches a customer.
    expect(checkClaim('Assessed by Vibefy in March.').ok).toBe(false);
  });

  it('says why, in words the person who typed it can act on', () => {
    // A refusal with no reason is a form that people work around rather than
    // a rule they understand.
    const verdict = checkClaim('We are VibefyCode approved.');
    expect(verdict.reason).toBeTruthy();
    expect(verdict.reason!.length).toBeGreaterThan(40);
    expect(verdict.reason).toMatch(/Verified by VibefyCode|one assessment/i);
  });
});

describe('what it lets through', () => {
  it.each([
    'We sell kettles and ship them the same day.',
    'Assessed by VibefyCode against rubric v1.1.0 in September 2026.',
    'Our support address is hello@kettle.example and we answer within a day.',
    'We are not certified by anybody, and we do not claim to be.',
    'Security questions go to security@kettle.example.',
  ])('allows “%s”', (text) => {
    expect(checkClaim(text).ok).toBe(true);
  });

  it('does not object to the word secure in the customer’s own sentence', () => {
    // This gate is about extending *our* mark, not about policing how somebody
    // describes their own product. Over-reaching here would make the control
    // feel arbitrary, and an arbitrary control is one people route around.
    expect(checkClaim('We use a secure payment provider.').ok).toBe(true);
  });

  it('allows an empty string, because an empty field is not a claim', () => {
    expect(checkClaim('').ok).toBe(true);
  });
});

describe('one list, not two', () => {
  /*
   * The build-time linter and this run-time check must refuse exactly the same
   * things. If they drift, the one facing the public is the one nobody is
   * maintaining — and the linter's own file is skipped by the linter, so
   * nothing else would notice.
   */
  it('has the same forbidden phrases as the linter', () => {
    expect([...FORBIDDEN_CLAIMS].sort()).toEqual([...FORBIDDEN_PHRASES].sort());
  });

  it('has the same idea of what extends the mark', () => {
    expect(String(MARK_EXTENSION)).toBe(String(MARK_EXTENSION_PATTERN));
  });
});
