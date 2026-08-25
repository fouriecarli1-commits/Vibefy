/**
 * The consumer trust check.
 *
 * A person is about to pay for somebody else's application and wants to know
 * the thing that actually costs people money: not whether the code is sound,
 * but whether they will be able to get out again. Can this be cancelled? Is
 * there a human to contact? Who is the company?
 *
 * Those answers are on the public page, or they are conspicuously not.
 *
 * Three rules shape every type in this file.
 *
 *   1. **It is not an assessment.** There is no score, no dimension, no badge
 *      and no rubric version, and the types make it impossible to add one. A
 *      consumer who confuses the two believes an application was examined when
 *      it was glanced at from outside, and that misunderstanding is precisely
 *      the one that costs somebody money.
 *
 *   2. **Observations, never verdicts.** "No cancellation link, support address
 *      or telephone number was found on this page" is a fact, and defensible.
 *      "This app is a scam" is a defamation claim about a named third party.
 *      An `Outcome` therefore says what we saw, and never what it means.
 *
 *   3. **Absence is absence of a finding.** We report that we could not find a
 *      contact address, never that there is none. The same sentence the reports
 *      have carried since M2, for the same reason.
 */

export type SignalId =
  | 'reachable'
  | 'encrypted'
  | 'cancellation'
  | 'contact_email'
  | 'telephone'
  | 'company_identity'
  | 'privacy_policy'
  | 'terms'
  | 'refund_policy'
  | 'recurring_payment'
  | 'pricing_visible';

/**
 * What we saw. Deliberately three states rather than pass and fail.
 *
 * `unclear` is the honest answer far more often than either of the others, and
 * a check that cannot say so will round it to whichever it prefers.
 */
export type Outcome = 'found' | 'not_found' | 'unclear';

/** How much a missing answer matters to somebody about to hand over a card. */
export type Weight = 'high' | 'medium' | 'low';

export interface Observation {
  readonly id: SignalId;
  /** The question in the consumer's words, not ours. */
  readonly question: string;
  readonly outcome: Outcome;
  /** One sentence, written to be read aloud to the person deciding. */
  readonly detail: string;
  /**
   * What we actually saw — a matched link, a heading, a header value. Quoted so
   * a reader can check us, and so a company we describe can too.
   */
  readonly evidence: readonly string[];
  readonly weight: Weight;
}

export interface TrustCheckResult {
  /** The address as the person typed it. */
  readonly requestedUrl: string;
  /** Where it actually ended up, which is not always the same place. */
  readonly finalUrl: string | null;
  readonly checkedAt: string;
  readonly observations: readonly Observation[];
  /**
   * Counts, not a score.
   *
   * Deliberately not a number out of a hundred: the moment this becomes one
   * figure it reads as a rating, gets screenshotted without its context, and
   * becomes the thing we spent the rest of the product refusing to be.
   */
  readonly summary: {
    readonly found: number;
    readonly notFound: number;
    readonly unclear: number;
    readonly highWeightMissing: number;
  };
  /** Set when the page could not be read at all, and why. */
  readonly unreachable: string | null;
}

export class TrustCheckInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrustCheckInputError';
  }
}
