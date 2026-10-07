/**
 * Two lists of the permitted forms of the certification mark, in two files,
 * with nothing joining them.
 *
 * `PERMITTED_MARK_PHRASES` in `packages/shared/src/legal.ts` carries a comment
 * that is a claim about another file:
 *
 *     Permitted ways to describe the mark. Anything outside this list is an
 *     extension of the certification mark and is rejected by
 *     tools/copy-lint.mjs.
 *
 * Measured on 2026-10-07: the constant occurs **once** in the repository — its
 * own declaration. `copy-lint.mjs` runs under plain `node` and cannot import a
 * TypeScript module, so it carries its own copy of the three forms, as prose,
 * inside the violation message it prints.
 *
 * The rule itself is enforced, by `MARK_EXTENSION_PATTERN` and a list of phrases
 * that are never permitted. What is not enforced is that the two statements of
 * what *is* permitted agree — and the constant had already drifted: it says
 * "VibefyCode Rubric v1.0.0 — score X/100" while the rubric in force is 1.1.0,
 * so the one place a reader would go to find the permitted forms names a version
 * that is no longer published.
 *
 * This is the brief's least negotiable rule — "the badge wordmark is exactly
 * 'Verified by Vibefy' and may never be extended" — so the two copies are
 * joined here rather than deduplicated into a module `copy-lint` cannot read.
 * Keeping the linter dependency-free is the right trade; a test is the seam.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERMITTED_MARK_PHRASES } from '../packages/shared/src/legal.ts';

const linter = readFileSync(join(import.meta.dirname, '..', 'tools/copy-lint.mjs'), 'utf8');

describe('the permitted forms of the mark', () => {
  it('are three, and the wordmark itself is the first', () => {
    expect(PERMITTED_MARK_PHRASES).toHaveLength(3);
    expect(PERMITTED_MARK_PHRASES[0]).toBe('Verified by VibefyCode');
  });

  it('name no rubric version, because a version goes stale and a form does not', () => {
    // The drift this test was written for: the list said "Rubric v1.0.0" while
    // 1.1.0 was in force. A permitted *form* is a shape, so it carries the
    // placeholder the linter's own message carries.
    for (const phrase of PERMITTED_MARK_PHRASES) {
      expect(phrase).not.toMatch(/v\d+\.\d+\.\d+/);
    }
  });

  it('are the same forms the linter tells somebody about', () => {
    // copy-lint runs under plain node and cannot import this constant, so the
    // two copies are joined here instead. Dependency-free is the right trade
    // for a gate that must work when an install does not.
    for (const phrase of PERMITTED_MARK_PHRASES) {
      expect(linter).toContain(phrase);
    }
  });

  it('are all the forms the linter names, not just some of them', () => {
    const quoted = /Permitted forms: ([^`]+?)\.`/.exec(linter)?.[1];
    expect(quoted, 'the linter no longer prints a "Permitted forms:" list').toBeDefined();
    const named = [...quoted!.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect(named).toEqual([...PERMITTED_MARK_PHRASES]);
  });
});

describe('what the linter actually refuses', () => {
  it('still refuses an extension of the mark', async () => {
    const { MARK_EXTENSION_PATTERN } = await import('../tools/copy-lint.mjs');
    for (const extended of [
      'VibefyCode certified',
      'VibefyCode-secure',
      'approved by VibefyCode',
      'guaranteed by VibefyCode',
    ]) {
      expect(MARK_EXTENSION_PATTERN.test(extended)).toBe(true);
    }
  });

  it('still allows the wordmark itself', async () => {
    // The direction this gate fails in: refusing the only phrase we are
    // allowed to use.
    const { MARK_EXTENSION_PATTERN } = await import('../tools/copy-lint.mjs');
    for (const permitted of PERMITTED_MARK_PHRASES) {
      expect(MARK_EXTENSION_PATTERN.test(permitted)).toBe(false);
    }
  });
});
