/**
 * The remediation service, and the wall around it.
 *
 * VibefyCode rates applications. This package is about also being paid to help
 * fix them, which the founder asked for and which carries the objection every
 * sceptic will raise, correctly: **a rating service that sells repairs has a
 * financial interest in finding faults.**
 *
 * That objection cannot be answered by promising restraint, because the
 * incentive is real whether or not anybody acts on it. It is answered by making
 * the influence impossible rather than merely forbidden:
 *
 *   1. **The score cannot see this package.** `packages/rubric` may not import
 *      it, the assessment pipeline may not import it, and
 *      `tests/remediation-wall.test.ts` fails the build if either ever does.
 *      Nothing here can reach a finding, because there is no path.
 *   2. **Whoever did the work may not review the result.** Enforced in the
 *      database by a trigger, not by a checkbox on a form — a reviewer who is
 *      recorded against an engagement cannot approve that application's
 *      assessment, however they arrive at the button.
 *   3. **The price never depends on what was found.** Fixed fee or hourly, and
 *      `PRICING_BASIS` is a closed union with no per-finding member, so a
 *      future rate card cannot quietly become one.
 *   4. **It is disclosed on the face of the result.** Every public surface
 *      showing a score for an application we were paid to work on says so.
 *
 * None of that makes the conflict disappear. It makes the conflict *visible and
 * inert*, which is the most any rater who also sells services can honestly
 * claim — and stating that plainly is worth more than a promise nobody can check.
 */
export { REMEDIATION_CLIENT_DISCLOSURE } from '@vibefycode/shared';

/**
 * How an engagement may be priced.
 *
 * A closed union with no per-finding member, on purpose. "Per finding resolved"
 * is the obvious way to price this and the one that must never exist: it pays
 * VibefyCode for every fault VibefyCode reports, which is the conflict in its
 * purest form. A rate card cannot drift into it, because the type has nowhere
 * to put it.
 */
export type PricingBasis = 'fixed_fee' | 'hourly';

export const PRICING_BASIS: readonly PricingBasis[] = ['fixed_fee', 'hourly'];

export type EngagementStatus = 'proposed' | 'accepted' | 'in_progress' | 'delivered' | 'declined';

export interface Engagement {
  readonly id: string;
  readonly appId: string;
  readonly organisationId: string;
  readonly status: EngagementStatus;
  readonly pricingBasis: PricingBasis;
  /**
   * Everyone who worked on it. This is the recusal list, so it is the record
   * that matters most: a name missing here is a reviewer who may approve an
   * assessment of an application they were paid to change.
   */
  readonly workedOnBy: readonly string[];
  readonly openedAt: string;
  readonly deliveredAt?: string | undefined;
}

/**
 * What a customer is offered, in the words the offer must use.
 *
 * The findings say what is wrong; this says we can help with it. What it may
 * never say is that fixing it will raise the score — because whether it does
 * is decided by the next assessment, and promising an outcome is selling one.
 */
export const REMEDIATION_OFFER = {
  headline: 'Help fixing what the report found',
  plainly:
    'A report tells you what a first real user, an app store reviewer or somebody poking at your API would find. Some of it is a five-minute change and some of it is a week. This is us doing the work with you, if you would rather not do it alone.',
  included: [
    'A written plan: what to change, in what order, and why that order',
    'The work itself, on a branch you review and merge — we never push to your main branch',
    'A walkthrough of what changed, so the next one you can do yourself',
  ],
  notIncluded: [
    'Any influence over your score. The people who do this work cannot review your assessment, and the scoring code cannot see that this engagement exists',
    'A guarantee that your score will rise. What the next assessment finds is what it finds — anyone promising you a number is selling you one',
    'A faster or softer review. The queue and the threshold are the same ones everybody else gets',
  ],
  howToStop:
    'Say so. An engagement is fixed-fee or hourly and stops when you stop it; nothing recurs, and declining it changes nothing about your assessment, your badge or your place in the queue.',
} as const;

/**
 * Whether a given reviewer is barred from reviewing a given application.
 *
 * The database enforces this with a trigger — this is the same rule stated in
 * TypeScript so the console can grey the button out and say why, rather than
 * letting somebody press it and meet a constraint violation.
 */
export function mayReview(
  reviewerId: string,
  engagements: readonly Pick<Engagement, 'appId' | 'workedOnBy'>[],
  appId: string,
): boolean {
  return !engagements.some(
    (engagement) => engagement.appId === appId && engagement.workedOnBy.includes(reviewerId),
  );
}
