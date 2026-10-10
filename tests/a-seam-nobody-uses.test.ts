/**
 * A test seam with no caller.
 *
 * Several modules here hold state that outlives a function call — a
 * once-a-day suppression cache, a failure counter, a flag saying a run was
 * orphaned, a memo of which rubric versions have been validated. Each exports
 * a `reset`, `clear` or `forget` for the same reason: a test that sets that
 * state and leaves it set makes the next test's result depend on the order the
 * cases happen to run in.
 *
 * `clearOrphanedRun` was one of those, with no caller anywhere. It was not
 * dead code in the ordinary sense — its comment says plainly what it is for.
 * It was a seam nobody had needed, which is a different and more interesting
 * fact: nothing had ever set the orphan flag, so the branch that stops the
 * worker when a run outlasts its timeout had never been exercised. The seam
 * with no caller was the visible end of an untested path whose consequence is
 * a duplicate assessment and a double charge.
 *
 * Found by script, listing every exported function that no shipped file
 * outside its own module mentions, then narrowing to those no test mentions
 * either. This is that screen as a standing assertion, so the next one is
 * noticed when it is written rather than on whatever night somebody runs the
 * script again.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Where state that outlives a call tends to live. */
const ROOTS = ['apps/worker/src', 'apps/web/lib', 'packages'];

function sourcesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      found.push(...sourcesUnder(full));
    } else if (entry.name.endsWith('.ts') && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

function testsUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      found.push(...testsUnder(full));
    } else if (/\.test\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

const seams = ROOTS.flatMap((root) =>
  sourcesUnder(root).flatMap((path) =>
    [
      ...readFileSync(path, 'utf8').matchAll(
        /^export function ((?:reset|clear|forget)[A-Za-z]*)/gm,
      ),
    ].map((match) => ({ path, name: match[1]! })),
  ),
);

/** Every test but this one. */
const SELF = 'a-seam-nobody-uses.test.ts';

const testText = (() => {
  /*
   * This file is left out, and that is not tidiness.
   *
   * The excuse list below holds a seam's name, so searching every test for
   * that name finds it here and reports the seam as called — by the note
   * saying nothing calls it. Fifth time tonight that a checker read the file
   * written to do the checking: copy lint on the word in the comment
   * explaining the word, the audit's word check on its own explanation, a
   * leftover marker spelled in a fixture, and stub-check on the name of its
   * own directory list.
   */
  /*
   * Co-located tests count too. The first draft read only `tests/`, and
   * reported `forgetRubricValidation` as uncalled when
   * `packages/rubric/src/gates.test.ts` is the whole reason it exists — a
   * false positive from a search narrower than the thing it was searching for.
   */
  const files = ['tests', ...ROOTS].flatMap(testsUnder).filter((path) => !path.endsWith(SELF));
  return files.map((path) => readFileSync(path, 'utf8')).join('\n');
})();

/**
 * Seams with no caller, and why each is allowed to have none.
 *
 * A bare name here would defeat the point, the same way it would in the
 * accessibility scan's list of unscanned pages.
 */
const EXCUSED: Readonly<Record<string, string>> = {
  resetMonitoringNotices:
    'The cache it clears rations two operator log lines in the monitoring sweep — a rubric version disagreement and a per-application cadence disagreement. saidOnceADay itself is tested directly, and both call sites are asserted, but the integration is not: exercising it needs a sweep over a row with a cadence disagreement, run twice. The two equivalent seams in governance.ts are exercised, so the rule is covered; this one instance of it is not. Recorded rather than deleted, because deleting it would make the gap harder to see, not smaller.',
};

describe('every seam that exists because state outlives a call', () => {
  it('found the seams it is talking about', () => {
    // The anchor. A regex that stopped matching would make every claim below
    // true of nothing.
    expect(seams.length).toBeGreaterThan(5);
    expect(seams.map((seam) => seam.name)).toContain('clearOrphanedRun');
    expect(seams.map((seam) => seam.name)).toContain('forgetRubricValidation');
  });

  it('read the tests it is searching, rather than an empty string', () => {
    expect(testText.length).toBeGreaterThan(100_000);
    expect(testText).toContain('clearOrphanedRun');
  });

  it('is called by at least one test, or excused in writing', () => {
    const orphaned = seams
      .filter((seam) => !new RegExp(`\\b${seam.name}\\b`).test(testText))
      .filter((seam) => !(seam.name in EXCUSED))
      .map((seam) => `${seam.path}: ${seam.name}`);
    expect(
      orphaned,
      `Seams no test calls:\n  ${orphaned.join('\n  ')}\n` +
        'Either a test needs it and should use it, or nothing sets the state it clears — ' +
        'which means the path that sets it is untested. Use it, or excuse it here with which.',
    ).toEqual([]);
  });

  it('does not excuse a seam without a reason', () => {
    for (const [name, reason] of Object.entries(EXCUSED)) {
      expect(reason.length, name).toBeGreaterThan(60);
    }
  });

  it('does not excuse a seam that is used after all', () => {
    // An excuse left behind after somebody wired the seam up is a note nobody
    // is holding anybody to.
    const stale = Object.keys(EXCUSED).filter((name) => new RegExp(`\\b${name}\\b`).test(testText));
    expect(stale, `Excused seams that are in fact called: ${stale.join(', ')}`).toEqual([]);
  });

  it('does not excuse a seam that no longer exists', () => {
    const gone = Object.keys(EXCUSED).filter((name) => !seams.some((seam) => seam.name === name));
    expect(gone, `Excused seams that are not there: ${gone.join(', ')}`).toEqual([]);
  });
});
