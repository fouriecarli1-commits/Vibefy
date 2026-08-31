/**
 * The disclosures a listing carries.
 *
 * The paid-relationship sentence itself lives in `@vibefycode/shared` and is
 * re-exported here, because PART 8.1 requires it wherever a rating is displayed
 * and two surfaces wording it differently is how the softer wording ends up in
 * the place people actually look.
 */
import { MARKETING_CLIENT_DISCLOSURE } from '@vibefycode/shared';

export { MARKETING_CLIENT_DISCLOSURE };

/*
 * This sentence was a promise made before there was anything that could break
 * it: "if paid placement is ever introduced it will be labelled as advertising
 * and kept out of this ordering". There is now advertising on this page, so the
 * conditional has to go — a promise left standing next to the thing it was
 * about is how a reader learns the words were never load-bearing.
 *
 * What replaced it says the same thing in the present tense, which is a harder
 * sentence to keep and the only honest one available.
 */
export const NO_PAID_PLACEMENT =
  'Placement in this list is not for sale. Listings are ordered by the rubric alone. There is one paid placement on this page: it is labelled as advertising, it sits outside the list, it is withheld entirely if the advertiser is listed here themselves, and it has no effect on the ordering above it.';

export const DIRECTORY_SCOPE =
  'A listing means one assessment, on one date, against the scope its owner authorised, met the published threshold and was approved by a reviewer. It is not a statement about the application today, and it is not a security guarantee.';

export function disclosuresFor(entry: { ownerIsMarketingClient: boolean }): string[] {
  const lines = [DIRECTORY_SCOPE];
  if (entry.ownerIsMarketingClient) lines.push(MARKETING_CLIENT_DISCLOSURE);
  return lines;
}
