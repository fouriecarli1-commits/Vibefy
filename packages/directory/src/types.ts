/**
 * What the directory is allowed to rank on.
 *
 * "No pay-for-placement in organic results" is a sentence in the brief, a clause
 * in the Badge Licence and a rule in the FTC's guidance on reviews. It is
 * enforced here the same way the scoring boundary is: the entry a ranking
 * function receives has no field for a plan, a price, a spend or a marketing
 * relationship, and the build fails if someone adds one.
 *
 * There is exactly one exception and it is the opposite of a loophole:
 * `ownerIsMarketingClient` exists so the listing can be *labelled*, and a
 * separate compile-time check asserts it is not among the keys the comparator
 * may read.
 */

export type DirectoryDimension =
  | 'functional_integrity'
  | 'security_posture'
  | 'data_privacy_practice'
  | 'practicality_ux'
  | 'production_readiness'
  | 'store_distribution_readiness';

/** The facts a listing displays. Every one of them is already on the badge's verification page. */
export interface DirectoryEntry {
  readonly slug: string;
  readonly name: string;
  readonly certifiedOrigin: string;
  readonly score: number;
  readonly rubricVersion: string;
  readonly assessedOn: string;
  readonly dimensions: readonly { readonly dimension: DirectoryDimension; readonly score: number }[];
  readonly tagline: string | null;
  readonly category: string | null;
  /** Carried to be disclosed, never to be ranked on. */
  readonly ownerIsMarketingClient: boolean;
}

/** The subset a comparator may look at. Deliberately smaller than the entry. */
export type RankableFields = Pick<DirectoryEntry, 'slug' | 'score' | 'assessedOn' | 'dimensions'>;

export type SortKey = 'score' | 'recent' | DirectoryDimension;

export interface DirectoryQuery {
  readonly search?: string;
  readonly category?: string | null;
  readonly sort?: SortKey;
  readonly minScore?: number | null;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface DirectoryPage {
  readonly entries: readonly DirectoryEntry[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly sort: SortKey;
  /** Shown beneath the results, always. */
  readonly orderingNote: string;
}

// ---------------------------------------------------------------------------
// Structural enforcement
// ---------------------------------------------------------------------------

type CommercialKey =
  | 'plan'
  | 'planTier'
  | 'tier'
  | 'price'
  | 'priceId'
  | 'amount'
  | 'amountPaid'
  | 'spend'
  | 'subscription'
  | 'subscriptionId'
  | 'invoice'
  | 'invoiceId'
  | 'stripeCustomerId'
  | 'isMarketingClient'
  | 'ownerIsMarketingClient'
  | 'marketingClient'
  | 'isPaying'
  | 'boost'
  | 'rank'
  | 'placement'
  | 'promoted'
  | 'sponsored'
  | 'featured'
  | 'seats';

type FreeOfCommercialInfluence<T> = Extract<keyof T, CommercialKey> extends never ? true : never;

/**
 * The entry itself carries the marketing flag, because it has to be shown. What
 * must not is anything the ordering can see — so it is `RankableFields`, not
 * `DirectoryEntry`, that is asserted clean.
 */
const _rankableIsClean: FreeOfCommercialInfluence<RankableFields> = true;
const _pageIsClean: FreeOfCommercialInfluence<DirectoryPage> = true;

export const DIRECTORY_ORDERING_ASSERTED = _rankableIsClean && _pageIsClean;
