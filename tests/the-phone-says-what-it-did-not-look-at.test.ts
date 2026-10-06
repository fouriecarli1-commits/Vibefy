/**
 * What the report on a phone does not say.
 *
 * `assessments.not_tested` is the engine's own record of criteria a run did not
 * answer — the stage that could not load the page in a browser, the checkout
 * that was never found, the criteria behind a sign-in nobody was given an
 * account for. The product's position on it is written down twice: the public
 * verification page shows it as prominently as a pass, and `packages/report`
 * had to be corrected once already for printing "Everything within the
 * authorised scope was assessed" while the free page a stranger could open
 * listed four things nobody had looked at.
 *
 * The phone's report screen does not select that column. Its own comment says
 * "The same rows the console renders, in the same order", and that is the part
 * that makes it worth a test rather than an edit: the claim and the code
 * disagreed, so the next reader had no reason to look.
 *
 * Held as source text because this suite has no React Native renderer. A weaker
 * test than rendering one, and the one that can be run.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The code, without the comments — which quote the defect on purpose. */
const source = readFileSync(
  join(process.cwd(), 'apps/mobile/app/report/[assessmentId].tsx'),
  'utf8',
)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ \t]*\/\/.*$/gm, ' ');

describe('the report on a phone', () => {
  it('reads what the run could not answer', () => {
    expect(source).toMatch(/not_tested/);
  });

  it('shows it, rather than only fetching it', () => {
    // A column selected and never rendered is the same silence with a longer
    // query.
    expect(source).toMatch(/notTested|not_tested/);
    expect(source).toMatch(/What this assessment did not/i);
  });

  it('says so explicitly when there was nothing, rather than hiding the section', () => {
    // An absent section reads as "there was nothing to say", which is the
    // sentence the whole field exists to stop being implied.
    expect(source).toMatch(/recorded no criterion|was assessed/i);
  });

  it('puts it before the findings, where the console puts it', () => {
    const notTestedAt = source.search(/What this assessment did not/i);
    const findingsAt = source.search(/Findings \(/);
    expect(notTestedAt).toBeGreaterThan(-1);
    expect(findingsAt).toBeGreaterThan(-1);
    expect(notTestedAt).toBeLessThan(findingsAt);
  });
});
