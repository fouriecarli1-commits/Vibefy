/**
 * A bug of ours, published as a warning about somebody else's business.
 *
 * `run.ts` already fought this battle once and wrote down what it was about:
 *
 *     Every failure used to produce one sentence: "The site could not be
 *     reached…" That asserts three things about somebody else's business, and a
 *     `TypeError` in this package would have asserted all three just as
 *     confidently. The result is shown to a stranger deciding whether to trust
 *     that business, so a bug of ours was being published as evidence against
 *     them.
 *
 * The **sentence** was fixed. The third branch now says plainly "That is a fault
 * of ours and is not a finding about this site." The **numbers beside it were
 * not**, and the numbers are what a reader takes at a glance:
 *
 *   · `reachable.outcome` stays `'not_found'` whatever the cause, so a
 *     `TypeError` in our own code counts as a failure by the business.
 *   · `summary.highWeightMissing` therefore reads 1, and `/trust-check` renders
 *     a warning bar on `highWeightMissing > 0` whose sentence names three
 *     specific things — **cancelling, contacting a person, and who the company
 *     is** — none of which were ever looked at, because nothing was.
 *
 * So the disclaimer and the warning bar sat on the same page saying opposite
 * things, and the bar is the one in a coloured box.
 *
 * ## The second defect, which is independent
 *
 * That bar's sentence names three questions and the count it renders is over
 * six: `encrypted`, `cancellation`, `contact_email`, `company_identity`,
 * `recurring_payment` and `reachable` are all high weight. A site that is simply
 * unencrypted produced a bar asserting that cancelling, contact and identity
 * were missing. The sentence has to be built from the questions actually
 * missing, or it is a sentence about a different page.
 *
 * `unclear` already exists in the outcome union and is exactly this: something
 * we could not establish, as opposed to something the site did not say.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { whyItCouldNotBeRead } from '../packages/trustcheck/src/run.ts';

const page = readFileSync(join(process.cwd(), 'apps/web/app/trust-check/page.tsx'), 'utf8');

describe('whose fault it was', () => {
  it('says a failure it cannot attribute is ours', () => {
    const failure = whyItCouldNotBeRead(
      new TypeError("Cannot read properties of null (reading 'x')"),
    );
    expect(failure.detail).toMatch(/fault of ours/i);
    expect(failure.ours).toBe(true);
  });

  it('does not claim a timeout as ours, because that is a fact about them', () => {
    const timeout = whyItCouldNotBeRead(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    );
    expect(timeout.ours).toBe(false);
    expect(timeout.detail).toMatch(/did not answer in time/i);
  });

  it('does not claim a refused connection as ours either', () => {
    const network = whyItCouldNotBeRead(
      Object.assign(new TypeError('fetch failed'), { cause: new Error('ECONNREFUSED') }),
    );
    expect(network.ours).toBe(false);
    expect(network.detail).toMatch(/could not be reached/i);
  });
});

describe('the result when the fault is ours', () => {
  it('records the reachability question as unclear rather than failed', async () => {
    // `unclear` is in the union for exactly this: something we could not
    // establish, as against something the site did not say.
    const { runTrustCheck } = await import('../packages/trustcheck/src/run.ts');
    const { fetchPublicPage } = await import('../packages/trustcheck/src/fetch.ts');
    void fetchPublicPage;

    // Driven through the real function with a host that cannot resolve would be
    // a network failure, which is *their* branch. Our branch needs our bug, so
    // the attribution is asserted directly above and the wiring below.
    const source = readFileSync(join(process.cwd(), 'packages/trustcheck/src/run.ts'), 'utf8');
    expect(source).toMatch(/ours \? 'unclear' : 'not_found'/);
    expect(typeof runTrustCheck).toBe('function');
  });

  it('does not count it against the business in the summary', () => {
    const source = readFileSync(join(process.cwd(), 'packages/trustcheck/src/run.ts'), 'utf8');
    // `highWeightMissing` counts `not_found` only, so an `unclear` reachability
    // keeps the warning bar off a page where nothing was checked.
    expect(source).toMatch(/weight === 'high' && entry\.outcome === 'not_found'/);
  });
});

describe('the warning bar', () => {
  it('names the questions actually missing, not three it was written against', () => {
    // Six signals are high weight; the sentence named three. A site that is
    // merely unencrypted was told it had not said how to cancel.
    expect(page).not.toMatch(/cancelling, contacting a person, and who the company is/);
  });

  it('builds that list from the observations', () => {
    expect(page).toMatch(/observations[\s\S]{0,200}weight === 'high'/);
  });
});
