/**
 * What the verification page shows when the tick list cannot be read.
 *
 * `loadAssurance` ended in `.catch(() => null)`, and the page rendered the list
 * only when it had one. So a database blip removed it and left everything
 * below — and the comment directly above that render says what everything
 * below is:
 *
 *     Everything below this point is written for the owner of an application:
 *     dimensions, criteria, a number out of a hundred. The person who clicked a
 *     mark on a stranger's website is not that person. They have one question —
 *     is this all right? — and a score of 88.6 does not answer it.
 *
 * So the failure mode was: drop the part written for the visitor, keep the part
 * written for the owner, say nothing. The page degrades to exactly what its own
 * design rejects.
 *
 * `null` was carrying two meanings — "this badge has no assessment behind it"
 * and "the read failed" — which is why the page could not tell them apart.
 *
 * Held as source text because the page needs a database and Next's server
 * runtime. A weaker test than rendering it, and the one that can be run.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The code, without the comments — which quote the defect on purpose. */
const source = readFileSync(join(process.cwd(), 'apps/web/app/a/[slug]/page.tsx'), 'utf8')
  .replace(/^[ \t]*\/\/.*$/gm, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ');

describe('the assurance load', () => {
  it('tells a failed read apart from a badge with nothing behind it', () => {
    expect(source).toMatch(/'unavailable'/);
    expect(source).toMatch(/'none'/);
  });

  it('does not collapse both into null', () => {
    expect(source).not.toMatch(/catch\(\(\) => null\)[\s\S]{0,40}\n\}\n\ninterface TrustPage/);
  });
});

describe('every loader on this page', () => {
  /*
   * The rule, rather than one position in the file.
   *
   * The assertion above pins where the old `.catch(() => null)` stood, which
   * caught that one and said nothing about the next. There was a next: the
   * trust-page loader in the function immediately below had the same defect,
   * and so did `generateMetadata`, which answered "Badge not found" — a claim
   * about somebody's badge — on a read that failed on our side.
   *
   * Three occurrences of that text remain in the file and all three are inside
   * comments explaining the defect, which `source` strips. So the rule can be
   * stated for the whole page: no loader here may give a failed read the same
   * value as an empty one.
   */
  it('never gives a failed read the same value as an empty one', () => {
    const occurrences = [...source.matchAll(/catch\(\(\)\s*=>\s*null\)/g)];
    expect(
      occurrences.map(() => 'catch(() => null)'),
      'a loader on the verification page collapses "the read failed" into "there is nothing ' +
        'here". The page renders each section only when it has one, so the section disappears ' +
        'and the reader cannot tell which happened.',
    ).toEqual([]);
  });
});

describe('what the owner says', () => {
  it('is a section that can be absent, missing, or there', () => {
    expect(source).toMatch(/type TrustPageLoad/);
    expect(source).toMatch(/trustPage\.kind === 'ready'/);
    expect(source).toMatch(/trustPage\.kind === 'unavailable'/);
  });

  it('says so when it cannot be read, in the owner’s favour', () => {
    // Collapsed, for the reason the test above already gives: the renderer
    // wraps JSX text wherever it likes, so a phrase assertion against the raw
    // file is an assertion about Prettier.
    const prose = source.replace(/\s+/g, ' ');
    expect(prose).toMatch(/What the owner says is not loading/);
    // The reader must not read a failed read as an owner who published nothing.
    // That section is where the contact route and the security address live.
    expect(prose).toMatch(/not something the owner has or has not done/);
  });
});

describe('the title a shared link carries', () => {
  it('does not say a badge was not found when the read failed', () => {
    expect(source).toMatch(/'unreadable'/);
    // Neutral and unindexed: this function has no way to tell the reader
    // anything, so saying nothing is the only honest thing available.
    expect(source).toMatch(/robots: \{ index: false, follow: false \}/);
  });
});

describe('the page', () => {
  it('says the answers are missing rather than leaving them out', () => {
    expect(source).toMatch(/kind === 'unavailable'/);
    expect(source).toMatch(/not loading|could not be read/i);
  });

  it('says it is our fault and not a change to the application', () => {
    // The sentence a stranger needs. A list that vanishes from a page about
    // somebody's trustworthiness reads as something having gone wrong with
    // them.
    // Collapsed first: the renderer wraps JSX text wherever it likes, so a
    // phrase assertion against the raw file is an assertion about Prettier.
    expect(source.replace(/\s+/g, ' ')).toMatch(/fault on our side/i);
  });

  it('still renders the list when it has one', () => {
    expect(source).toMatch(/kind === 'ready'[\s\S]{0,60}AssuranceList/);
  });
});
