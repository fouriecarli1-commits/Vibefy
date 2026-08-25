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
    unreachable =
      'The site could not be reached. It may be offline, blocking automated visitors, or slow to answer.';
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
