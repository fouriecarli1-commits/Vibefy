import {
  SPONSOR_LABEL,
  assertPlaceable,
  sponsorDisclosures,
  type LiveSponsorship,
  type SponsorshipPlacement,
} from '@vibefycode/sponsorship';
import { readAsAnon } from '@/lib/sql';

/**
 * A paid placement, on the three surfaces permitted to carry one.
 *
 * Three things it does that an advertising slot usually does not.
 *
 * It refuses a surface it was not built for. `assertPlaceable` throws rather
 * than rendering, so a slot dropped onto a verification page next year fails
 * the build instead of quietly appearing beside somebody's score.
 *
 * It withholds rather than relabels. A sponsor whose own application is listed
 * on the same page has, to any reader, bought its way up that page — and being
 * able to say we did not mean it that way is not the same as it not being that.
 * The slot renders nothing, and the sponsor is not charged for a placement
 * nobody saw.
 *
 * It says what it is in the first two words. Not "sponsored", not "partner",
 * not "featured" — every softer word is one somebody chose because it reads
 * less like an advertisement, which is exactly the reason not to use it.
 */
export async function SponsorSlot({ placement }: { placement: SponsorshipPlacement }) {
  assertPlaceable(placement);

  const sponsor = await readAsAnon(async (client) => {
    const { rows } = await client.query<{
      id: string;
      placement: SponsorshipPlacement;
      advertiser_name: string;
      advertiser_url: string;
      headline: string;
      body: string;
      sponsor_is_a_customer: boolean;
      sponsor_is_marketing_client: boolean;
      sponsor_is_listed_in_directory: boolean;
    }>(
      `select id, placement, advertiser_name, advertiser_url, headline, body,
              sponsor_is_a_customer, sponsor_is_marketing_client,
              sponsor_is_listed_in_directory
         from public.live_sponsorships where placement = $1 limit 1`,
      [placement],
    );
    return rows[0] ?? null;
  }).catch(() => null);

  if (!sponsor) return null;

  const live: LiveSponsorship = {
    id: sponsor.id,
    placement: sponsor.placement,
    advertiserName: sponsor.advertiser_name,
    advertiserUrl: sponsor.advertiser_url,
    headline: sponsor.headline,
    body: sponsor.body,
    isCustomer: sponsor.sponsor_is_a_customer,
    sponsorIsMarketingClient: sponsor.sponsor_is_marketing_client,
  };

  // Advertising beside your own rating. The one case a label genuinely cannot
  // fix: a company listed in the directory that has also bought the space
  // beneath it has, to any reader, bought its way up the page, and being able
  // to say we did not mean it that way is not the same as it not being that.
  //
  // Withheld, not moved and not re-labelled — and the sponsor is not charged
  // for a placement nobody saw.
  if (placement === 'directory' && sponsor.sponsor_is_listed_in_directory) return null;

  return (
    <aside aria-label={SPONSOR_LABEL} className="mt-12 space-y-3 rounded-xl border border-line p-6">
      <p className="eyebrow">{SPONSOR_LABEL}</p>
      <h2 className="text-lg font-semibold">{live.headline}</h2>
      <p className="max-w-prose text-muted">{live.body}</p>
      <p className="text-sm">
        <a href={live.advertiserUrl} rel="nofollow noopener sponsored" target="_blank">
          {live.advertiserName}
        </a>
      </p>
      {/* Under the advertisement, not above it, and in the same type size as
          everything else we say about ourselves. A disclosure set in small grey
          text is a disclosure designed not to be read. */}
      {sponsorDisclosures(live).map((line) => (
        <p key={line} className="max-w-prose text-sm text-muted">
          {line}
        </p>
      ))}
    </aside>
  );
}
