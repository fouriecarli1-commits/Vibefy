/**
 * Running the check, and the sentences that must travel with its result.
 *
 * The legend is not a footer. It is the part that stops a list of observations
 * from being read as a verdict — so it lives here, beside the result, and every
 * surface that shows one shows it.
 */
import { fetchPublicPage, normaliseUrl } from './fetch.ts';
import { runChecks } from './checks.ts';
import { TrustCheckInputError, type Observation, type TrustCheckResult } from './types.ts';

/**
 * The words that qualify every result, stated once.
 *
 * Written to be quoted verbatim rather than paraphrased, because the paraphrase
 * is always shorter and always claims more.
 */
export const TRUST_CHECK_LEGEND =
  'This is a look at one public web page, from outside, at a single moment. It is not an assessment, not a security review, and not a recommendation. It reports what that page does and does not say — nothing more. Something not found here may still exist somewhere else on the site, behind a sign-in, or in a document this check did not open. Absence of a finding is not evidence of absence. VibefyCode accepts no liability for any decision made on the basis of it.';

/** The one thing this must never be mistaken for. */
export const TRUST_CHECK_NOT_A_BADGE =
  'A trust check is not a “Verified by VibefyCode” badge and does not lead to one. A badge is issued only to an owner who proved they control the application, after an assessment against the published rubric that a person reviewed.';

/**
 * Why there was no page to read, without blaming the site for our own faults.
 *
 * Every failure used to produce one sentence: "The site could not be reached.
 * It may be offline, blocking automated visitors, or slow to answer." That
 * asserts three things about somebody else's business, and a `TypeError` in
 * this package would have asserted all three just as confidently. The result
 * is shown to a stranger deciding whether to trust that business, so a bug of
 * ours was being published as evidence against them.
 *
 * The builder-facing preflight beside this one already said what went wrong.
 * This is the same courtesy pointed at the person being checked.
 *
 * Three outcomes, and the third is the one that matters: a failure we cannot
 * attribute is ours until proven otherwise, and it says so.
 */
export function whyItCouldNotBeRead(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'AbortError' || name === 'TimeoutError') {
    // A fact we observed, and the only one of the three the old sentence
    // offered that we can ever actually stand behind.
    return 'The site did not answer in time, so there was no page to read. It may be slow, or it may be declining automated visitors by leaving them waiting.';
  }
  // What `fetch` throws when it never got a response: DNS, TLS, a refused
  // connection. `cause` is where undici puts the underlying code.
  const networkFailure =
    error instanceof TypeError && (error.message === 'fetch failed' || 'cause' in error);
  if (networkFailure) {
    return 'The site could not be reached. It may be offline, blocking automated visitors, or misconfigured in a way that stops a connection being made.';
  }
  return `Nothing was checked, because something went wrong on our side while reading that page. That is a fault of ours and is not a finding about this site. (${error instanceof Error ? error.message : String(error)})`;
}

export async function runTrustCheck(
  rawUrl: string,
  now: Date = new Date(),
): Promise<TrustCheckResult> {
  const url = normaliseUrl(rawUrl);
  const checkedAt = now.toISOString();

  let observations: Observation[] = [];
  let finalUrl: string | null = null;
  let unreachable: string | null = null;

  try {
    const page = await fetchPublicPage(url);
    finalUrl = page.finalUrl;

    if (page.status >= 400) {
      // A page that will not open is a fact worth reporting, not an error to
      // swallow: a paid-for application whose site returns 404 is exactly what
      // somebody about to pay would want to know.
      unreachable = `The site answered with HTTP ${page.status}, so there was no page to read.`;
    } else {
      observations = runChecks(page);
    }
  } catch (error) {
    if (error instanceof TrustCheckInputError) throw error;
    unreachable = whyItCouldNotBeRead(error);
  }

  const reachable: Observation = {
    id: 'reachable',
    question: 'Does the site open at all?',
    outcome: unreachable ? 'not_found' : 'found',
    detail: unreachable ?? 'The page opened and could be read.',
    evidence: finalUrl ? [finalUrl] : [],
    weight: 'high',
  };

  const all = [reachable, ...observations];

  return {
    requestedUrl: url.toString(),
    finalUrl,
    checkedAt,
    observations: all,
    summary: {
      found: all.filter((entry) => entry.outcome === 'found').length,
      notFound: all.filter((entry) => entry.outcome === 'not_found').length,
      unclear: all.filter((entry) => entry.outcome === 'unclear').length,
      highWeightMissing: all.filter(
        (entry) => entry.weight === 'high' && entry.outcome === 'not_found',
      ).length,
    },
    unreachable,
  };
}
