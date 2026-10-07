/**
 * `scoreExit` cannot tell a site it could not read from a site with no exit.
 *
 * `ExitCrawl` carries `unreadable` for exactly one reason, written beside it:
 *
 *     Without this a walk that read nothing came back as `routeFound: false`,
 *     which is scored as "No route found" and published as a statement that a
 *     company gives its customers no way to cancel. It is the difference between
 *     looking and not finding, and not looking.
 *
 * `ExitSignals`, which is what `scoreExit` takes, has no such field. So the
 * scorer is structurally incapable of making that distinction, and its output
 * says "No route to cancelling was found on the pages we could reach" — a
 * sentence that is false when there were no pages we could reach.
 *
 * The one caller guards it: `deterministic.ts` checks `crawl.unreadable !== null`
 * and does not score at all, with the reasoning in a comment. Measured on
 * 2026-10-07, that is the only call site. (A first measurement said nothing read
 * `unreadable`; that was wrong, and it was wrong because `head -10` cut the
 * grep off after ten unrelated hits in `static-intake.ts`. A truncated sweep
 * reads exactly like a sweep that found nothing.)
 *
 * So the rule holds today and nothing holds the rule. A second caller — the
 * public trust-check tool is the obvious one — would publish "No route found"
 * about a site it never reached, and the sentence it published would be the
 * company's reputation. This is the seam: every call site is found from source,
 * and one that does not check first fails by name.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  'coverage',
  '.tmp',
  'public',
  'brand',
]);

/** Every TypeScript file in the workspace, tests included for the listing. */
function sources(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(ROOT, dir))) {
      if (SKIP.has(entry)) continue;
      const rel = `${dir}/${entry}`.replace(/^\.\//, '');
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(entry)) found.push(rel);
    }
  };
  walk('.');
  return found;
}

/** Comments quote the defect while explaining it. Fifth time tonight. */
const strip = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/^([ \t]*)\/\/.*$/gm, (line) => line.replace(/[^\n\t ]/g, ' '));

const callers = sources()
  .filter((f) => !f.startsWith('tests/') && !/\.test\.tsx?$/.test(f))
  .map((f) => ({ file: f, text: strip(readFileSync(join(ROOT, f), 'utf8')) }))
  // The file that declares it is not a caller, and the first version of this
  // filter counted it.
  .filter(({ text }) => /\bscoreExit\s*\(/.test(text) && !/function scoreExit\s*\(/.test(text));

describe('every place a way-out score is produced', () => {
  it('is found, so this file is testing something', () => {
    expect(callers.length).toBeGreaterThan(0);
    expect(callers.map((c) => c.file)).toContain('packages/engine/src/stages/deterministic.ts');
  });

  it('checks whether the site could be read before scoring it', () => {
    const unguarded = callers
      .filter(({ text }) => {
        // The check has to be in the same function, so: somewhere before the
        // call and after the crawl that produced it.
        const call = text.indexOf('scoreExit(');
        return !/unreadable/.test(text.slice(Math.max(0, call - 1200), call));
      })
      .map(({ file }) => file);
    // Anything here scores a crawl without asking whether a page was ever
    // read, and publishes "No route found" about a company on the strength of
    // a walk that never happened.
    expect(unguarded).toEqual([]);
  });

  it('does not score at all where it could not read, rather than scoring zero', () => {
    const stage = callers.find((c) => c.file.endsWith('deterministic.ts'))!;
    // A zero with a band beside it is a measurement. The absence of one is the
    // honest output, and the note carries the sentence.
    expect(stage.text).toMatch(/if \(crawl\.unreadable !== null\)/);
    const guarded = /if \(crawl\.unreadable !== null\)[\s\S]{0,600}?\} else \{/.exec(stage.text);
    expect(guarded, 'the guard no longer brackets the scoring').not.toBeNull();
    expect(guarded![0]).not.toContain('scoreExit(');
  });
});

describe('what the scorer would say if it were asked', () => {
  it('still says the sentence that makes the guard necessary', async () => {
    // Kept as a test rather than softened: the sentence is right for a site we
    // walked and found nothing on, and wrong for one we never reached. Which it
    // is, is not something the scorer can know.
    const { scoreExit } = await import('../packages/trustcheck/src/exit.ts');
    const score = scoreExit({
      routeFound: false,
      selfService: false,
      plainlyNamed: false,
      clicksToCancel: null,
      clicksToSubscribe: null,
    });
    expect(score.band).toBe('No route found');
    expect(score.components[0]!.detail).toMatch(/pages we could reach/);
  });

  it('still scores a site that genuinely has an easy way out', async () => {
    const { scoreExit } = await import('../packages/trustcheck/src/exit.ts');
    const score = scoreExit({
      routeFound: true,
      selfService: true,
      plainlyNamed: true,
      clicksToCancel: 2,
      clicksToSubscribe: 2,
    });
    expect(score.percentage).toBe(100);
    expect(score.band).toBe('Easy');
  });
});
