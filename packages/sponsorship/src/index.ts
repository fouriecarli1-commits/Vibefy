/**
 * Advertising space on a site whose only asset is being believed.
 *
 * Anré's argument for selling it is the right one and it is worth writing down,
 * because it is also the constraint: the app is quiet, and quiet is what makes
 * a space on it worth paying for. One placement on a page nobody has to scroll
 * past nine others to reach is worth more than nine placements — and it is the
 * only kind this product can carry without becoming the thing it warns people
 * about.
 *
 * Everything in this file exists to keep one sentence the directory has been
 * making since M7 true now that there is something that could break it:
 *
 *     "Placement here is not for sale. Listings are ordered by the rubric
 *      alone, and if paid placement is ever introduced it will be labelled as
 *      advertising and kept out of this ordering."
 *
 * Labelled, and kept out of the ordering. Both halves, in code, with tests.
 */

export type SponsorshipPlacement = 'directory' | 'how_it_works' | 'methodology';

export type SponsorshipStatus =
  | 'draft'
  | 'pending_review'
  | 'approved'
  | 'live'
  | 'ended'
  | 'rejected';

export interface LiveSponsorship {
  readonly id: string;
  readonly placement: SponsorshipPlacement;
  readonly advertiserName: string;
  readonly advertiserUrl: string;
  readonly headline: string;
  readonly body: string;
  /** Whether this advertiser is also somebody we assess. */
  readonly isCustomer: boolean;
  readonly sponsorIsMarketingClient: boolean;
}

/**
 * The surfaces a paid placement may never appear on, and why.
 *
 * This list is the feature. Everything else is plumbing.
 *
 * The database enum already excludes them — they are not values it can hold —
 * so this is the second lock rather than the only one, and it exists in a form
 * a person can read and a test can assert. A surface is forbidden when it shows
 * the assessment of one named application: an advertisement standing beside the
 * evidence it paid to be near is not repaired by a label, and the label would
 * make it worse by proving we thought about it.
 */
export const FORBIDDEN_SURFACES: Readonly<Record<string, string>> = {
  '/a/[slug]':
    'The verification page. Somebody arrives here having clicked a trust mark to find out whether it means anything. An advertisement beside that answer is a stranger paying to stand next to our evidence.',
  '/console/reports/[assessmentId]':
    'The report. It is the thing the customer paid for and the record we would produce in a dispute; nothing in it is for sale.',
  '/verify': 'The signature check. Its entire value is that it is mechanical and disinterested.',
  '/review':
    'The reviewer queue. A reviewer deciding whether to certify an application must not be looking at anything anybody paid to put there.',
  '/console':
    'The customer’s own workspace. They are paying us; selling their attention on to somebody else is the arrangement this company exists to be the opposite of.',
};

/** The three surfaces that may carry one. */
export const PERMITTED_PLACEMENTS: readonly SponsorshipPlacement[] = [
  'directory',
  'how_it_works',
  'methodology',
];

/** Where each one appears, for the page that sells them. */
export const PLACEMENT_LABEL: Readonly<Record<SponsorshipPlacement, string>> = {
  directory: 'The directory, below the listing',
  how_it_works: 'What happens to your app, at the foot',
  methodology: 'The published rubric, at the foot',
};

/**
 * The label. Not "sponsored", not "partner", not "featured".
 *
 * Every softer word is one somebody chose because it reads less like an
 * advertisement, which is the reason not to use it.
 */
export const SPONSOR_LABEL = 'Paid placement';

export const SPONSOR_EXPLANATION =
  'This is an advertisement. It was paid for, it is not a VibefyCode assessment, and nothing about it affects any score, any listing order, or any badge on this site.';

/** Said where a sponsor is also somebody we rate. */
export const SPONSOR_IS_RATED_DISCLOSURE =
  'This advertiser is also assessed by VibefyCode. Their placement here bought them this space and nothing else: their score is produced by the published rubric from evidence and reviewed by a person, and there is no path by which a payment can change it.';

export class ForbiddenPlacementError extends Error {}

/**
 * Whether a paid placement may appear on a surface.
 *
 * Refuses anything not explicitly permitted, rather than permitting anything
 * not explicitly forbidden. A new page added next year is not advertising space
 * until somebody decides it is.
 */
export function mayPlaceOn(surface: string): boolean {
  return PERMITTED_PLACEMENTS.some((placement) => placement === surface);
}

export function assertPlaceable(surface: string): asserts surface is SponsorshipPlacement {
  if (!mayPlaceOn(surface)) {
    throw new ForbiddenPlacementError(
      `No paid placement may appear on "${surface}". ${FORBIDDEN_SURFACES[surface] ?? 'Only the three permitted surfaces carry advertising, and a new page is not one of them until somebody decides it is.'}`,
    );
  }
}

/**
 * Whether a sponsor is advertising beside their own rating.
 *
 * The one case a label genuinely cannot fix. A company listed in the directory
 * that has also bought the space beneath it has, to any reader, bought its way
 * up the page — and being able to say we did not mean it that way is not the
 * same as it not being that.
 *
 * The answer is computed by `public.live_sponsorships`, which runs as its owner
 * and can see the join; it crosses to the renderer as a boolean so that no
 * organisation id has to be published to work it out. This function is the rule
 * itself, kept separate from where the fact comes from.
 */
export function isSelfAdjacent(
  placement: SponsorshipPlacement,
  facts: { readonly listedInDirectory: boolean },
): boolean {
  return placement === 'directory' && facts.listedInDirectory;
}

/** Everything that must be said beside a placement, in order. */
export function sponsorDisclosures(sponsor: LiveSponsorship): string[] {
  const lines = [SPONSOR_EXPLANATION];
  if (sponsor.isCustomer) lines.push(SPONSOR_IS_RATED_DISCLOSURE);
  return lines;
}
