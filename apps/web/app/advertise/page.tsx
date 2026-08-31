import type { Metadata } from 'next';
import Link from 'next/link';
import pricing from '../../../../config/pricing.json' with { type: 'json' };
import {
  FORBIDDEN_SURFACES,
  PERMITTED_PLACEMENTS,
  PLACEMENT_LABEL,
  SPONSOR_LABEL,
  type SponsorshipPlacement,
} from '@vibefycode/sponsorship';

export const metadata: Metadata = {
  title: 'Advertise on VibefyCode',
  description:
    'One paid placement per surface, on three surfaces, reviewed by a person before it appears. What it costs, and the rules that make the space worth buying.',
};

/**
 * The page that sells advertising space.
 *
 * Its argument is unusual and it is also the truth: what is for sale here is
 * scarcity. One placement per surface, on three surfaces, on a site with no
 * other advertising — and the reason that is worth paying for is the same
 * reason it has to stay that way. An advertisement is worth something on a
 * page people believe; the moment there are nine of them, nobody believes the
 * page and nobody wants the ninth.
 *
 * So the rules are the pitch rather than the small print, and they are stated
 * before the price. A buyer who reads them and leaves is a buyer who wanted
 * something we cannot sell, which is worth finding out on this page rather
 * than in an email six weeks later.
 */
const money = (usd: number) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(usd);

const RULES = [
  {
    title: 'It is never near a rating',
    body: 'A placement cannot appear on a verification page, in a report, in the reviewer queue, or anywhere behind a customer’s sign-in. Those surfaces are not on the list this feature can even hold — an advertisement standing beside the evidence it paid to be near is not repaired by a label, and the label makes it worse by proving somebody thought about it.',
  },
  {
    title: 'It cannot move a score or a listing',
    body: 'The scoring code receives a data structure with no field for advertising, and a test in our build pipeline constructs a maximally-paying customer and a free one with identical applications and asserts their scores are identical. The directory is ordered by the rubric; the placement sits outside that list and below the explanation of how the list is ordered.',
  },
  {
    title: 'If you are listed in the directory, your directory placement is withheld',
    body: 'Not moved, not re-labelled — withheld, and you are not charged for it. A company listed in the directory that has also bought the space beneath it has, to any reader, bought its way up the page. Being able to say we did not mean it that way is not the same as it not being that.',
  },
  {
    title: 'A person approves it before it appears',
    body: 'The same gate an assessment passes, and the database refuses to make one live without a recorded human review. We turn things down. What is being sold is a position beside our own credibility, and the day that stops being worth protecting is the day the space stops being worth buying.',
  },
  {
    title: 'It says what it is in its first two words',
    body: `Every placement is headed “${SPONSOR_LABEL}”, with a sentence underneath saying it is an advertisement, that it is not an assessment, and that it affects nothing on the site. Not “sponsored”, not “partner”, not “featured”: every softer word is one somebody chose because it reads less like an advertisement.`,
  },
];

export default function AdvertisePage() {
  const rates = pricing.sponsorship.perThirtyDays as Record<
    SponsorshipPlacement,
    { usd: number; zar: number }
  >;

  return (
    <div className="max-w-3xl space-y-12">
      <header className="space-y-4">
        <p className="eyebrow">Advertising</p>
        <h1 className="text-4xl font-bold tracking-tight">One space, on a quiet site</h1>
        <p className="max-w-prose text-lg text-muted">
          Three surfaces carry advertising. Each carries exactly one placement at a time, and there
          is none anywhere else. That is not restraint we are being modest about — it is the whole
          of what is for sale. An advertisement is worth something on a page people believe, and the
          moment there are nine of them nobody believes the page and nobody wants the ninth.
        </p>
      </header>

      {/* Before the price, deliberately. Somebody who reads these and leaves
          wanted something we cannot sell, and this page is a better place to
          find that out than an email six weeks later. */}
      <section aria-labelledby="rules" className="space-y-5">
        <h2 id="rules" className="text-2xl font-bold tracking-tight">
          What you cannot buy
        </h2>
        <ul className="space-y-5">
          {RULES.map((rule) => (
            <li key={rule.title} className="panel space-y-2">
              <h3 className="font-semibold">{rule.title}</h3>
              <p className="max-w-prose text-sm text-muted">{rule.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="where" className="space-y-4">
        <h2 id="where" className="text-2xl font-bold tracking-tight">
          Where it appears, and what it costs
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
            <caption className="sr-only">Placements and their rates per thirty days</caption>
            <thead>
              <tr className="border-b border-line-strong">
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Placement
                </th>
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Per 30 days
                </th>
              </tr>
            </thead>
            <tbody>
              {PERMITTED_PLACEMENTS.map((placement) => (
                <tr key={placement} className="border-b border-line">
                  <td className="py-3 pr-4">{PLACEMENT_LABEL[placement]}</td>
                  <td className="py-3 pr-4 font-medium" data-numeric>
                    {money(rates[placement].usd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="max-w-prose text-sm text-muted">
          Sold in periods of up to twelve months. A placement is a headline, a sentence and a link —
          no images, no scripts, nothing that follows anybody around. The limits are enforced by the
          database rather than by a specification, so a longer one cannot be sold by accident.
        </p>
      </section>

      <section aria-labelledby="never" className="space-y-3 rounded-xl border border-line p-6">
        <h2 id="never" className="text-lg font-semibold">
          The surfaces that will never carry one
        </h2>
        <ul className="space-y-3 text-sm">
          {Object.entries(FORBIDDEN_SURFACES).map(([surface, reason]) => (
            <li key={surface}>
              <code className="text-ink">{surface}</code>
              <p className="mt-1 max-w-prose text-muted">{reason}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="ask" className="space-y-3 rounded-xl border border-line-strong p-6">
        <h2 id="ask" className="text-lg font-semibold">
          Asking for one
        </h2>
        <p className="max-w-prose text-muted">
          There is no checkout for this. You write to us, a person reads it, and we say yes or no —
          which is slower than a payment form and is the point: a placement nobody looked at is the
          exact failure this company cannot have. Tell us which surface, for how long, and what you
          want it to say.
        </p>
        <p className="text-sm">
          <Link href="/legal">Our terms</Link> ·{' '}
          <Link href="/legal/rating-methodology-and-independence">
            The independence policy this sits under
          </Link>
        </p>
      </section>
    </div>
  );
}
