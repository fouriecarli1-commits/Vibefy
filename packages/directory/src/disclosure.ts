/**
 * The disclosures a listing carries.
 *
 * The paid-relationship sentence itself lives in `@vibefy/shared` and is
 * re-exported here, because PART 8.1 requires it wherever a rating is displayed
 * and two surfaces wording it differently is how the softer wording ends up in
 * the place people actually look.
 */
import { MARKETING_CLIENT_DISCLOSURE } from '@vibefy/shared';

export { MARKETING_CLIENT_DISCLOSURE };

export const NO_PAID_PLACEMENT =
  'Placement here is not for sale. Listings are ordered by the rubric alone, and if paid placement is ever introduced it will be labelled as advertising and kept out of this ordering.';

export const DIRECTORY_SCOPE =
  'A listing means one assessment, on one date, against the scope its owner authorised, met the published threshold and was approved by a reviewer. It is not a statement about the application today, and it is not a security guarantee.';

export function disclosuresFor(entry: { ownerIsMarketingClient: boolean }): string[] {
  const lines = [DIRECTORY_SCOPE];
  if (entry.ownerIsMarketingClient) lines.push(MARKETING_CLIENT_DISCLOSURE);
  return lines;
}
