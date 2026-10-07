/**
 * Two reads in `game-checks.ts` that turn a failure into a number.
 *
 * This file is the one that already knows better. Eighty lines above the first
 * of these sits the comment that names the rule:
 *
 *     Null, not an empty list. A read that failed used to arrive as "the page
 *     registered listeners for nothing", which is how a high-severity finding
 *     accusing a game of being unplayable by touch got raised from a
 *     measurement that never happened.
 *
 * And twenty lines above the second:
 *
 *     A transfer with no entry to match is left out rather than guessed onto
 *     one side, and said out loud. Leaving it out understates the weight, which
 *     is the direction to err in for a figure that appears in a finding against
 *     somebody — and a lower bound nobody is told about is just a wrong number.
 *
 * Both are right, and two reads were not held to them.
 *
 * `storageAfter` catches with `[] as string[]`. An empty list of keys says the
 * reload left nothing behind, and that goes into `persistedKeysAfterReload`,
 * which is in the measurements artefact a paying customer reads. No finding is
 * raised off it today — `wroteOnlyToSessionStorage` is computed from
 * `storageBefore` and guarded on it — so this is a false statement in evidence
 * rather than a false accusation. It is still a false statement in evidence.
 *
 * `request.sizes()` catches with `null`, and `settled` filters those out.
 * `unmatched` counts transfers with no *timing* entry and says so; a transfer
 * with no *size* was dropped from the total with nothing said. That is a lower
 * bound nobody is told about, in the figure PRD-06 quotes in kilobytes.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(import.meta.dirname, '..', 'packages/engine/src/stages/game-checks.ts'),
  'utf8',
)
  // The comments quote both defects verbatim while explaining them, as the ones
  // above show. Every source-text rule in this suite strips them first.
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ \t]*\/\/.*$/gm, ' ');

describe('a read that failed', () => {
  it('never catches into an empty list', () => {
    // An empty collection is an answer. `null` is the absence of one, and only
    // `null` can be told apart from "there was nothing there".
    const emptyCatches = [...source.matchAll(/\.catch\(\(\)\s*=>\s*\[[^\]]*\]/g)].map(
      (match) => match[0],
    );
    expect(emptyCatches).toEqual([]);
  });

  it('leaves the keys after a reload as null rather than none', () => {
    expect(source).toMatch(/persistedKeysAfterReload:\s*storageAfter/);
    expect(source).toMatch(/const storageAfter[\s\S]{0,400}?\.catch\(\(\) => null\)/);
  });

  it('says so, like every other read in this file that can fail', () => {
    expect(source).toMatch(/storageAfter === null/);
  });
});

describe('a transfer whose size could not be read', () => {
  it('is counted, not just filtered away', () => {
    expect(source).toMatch(/unsized/);
  });

  it('is said out loud, because the weight is then a lower bound', () => {
    const limitation = /unsized[\s\S]{0,900}?limitations\.push\(/.test(source);
    expect(limitation).toBe(true);
  });
});

describe('what has to keep holding', () => {
  it('the listener read is still null-on-failure, which this rule came from', () => {
    expect(source).toMatch(/listenerTypes === null/);
  });

  it('the unmatched-timing count is still reported', () => {
    expect(source).toMatch(/unmatched > 0/);
  });

  it('a limitation is still pushed when the connection could not be throttled', () => {
    expect(source).toMatch(/if \(!throttled\)/);
  });
});
