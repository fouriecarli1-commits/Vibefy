import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PLACEMENT_LABEL, SPONSOR_LABEL, type SponsorshipPlacement } from '@vibefycode/sponsorship';
import { ActionForm, Field } from '@/components/action-form';
import { createClient } from '@/lib/supabase/server';
import { approveSponsorship, endSponsorship, rejectSponsorship } from './actions';

export const metadata: Metadata = { title: 'Placements' };

/**
 * The queue for paid placements.
 *
 * The database will not make one live without a recorded reviewer, which is the
 * lock. This is the screen that lock exists for — and the reason it is a screen
 * rather than a SQL statement is that "a person approves every placement" is a
 * claim the advertising page makes to buyers, and a claim nobody can act on is
 * one that will quietly stop being true.
 *
 * What is shown is what somebody deciding actually needs: the words that will
 * appear, where they will appear, who is paying, and whether we also rate them.
 * That last one is why the disclosure exists, and it belongs in front of the
 * person deciding rather than only in front of the reader afterwards.
 */

interface Row {
  id: string;
  status: string;
  placement: SponsorshipPlacement;
  advertiser_name: string;
  advertiser_url: string;
  headline: string;
  body: string;
  starts_on: string;
  ends_on: string;
  price_cents: number;
  currency: string;
  organisation_id: string | null;
  review_note: string | null;
}

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(
    cents / 100,
  );

export default async function SponsorshipsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/admin/sponsorships');

  const { data: profile } = await supabase
    .from('users')
    .select('platform_role')
    .eq('id', user.id)
    .single();
  if (profile?.platform_role !== 'admin') redirect('/console');

  const { data } = await supabase
    .from('sponsorships')
    .select(
      'id, status, placement, advertiser_name, advertiser_url, headline, body, starts_on, ends_on, price_cents, currency, organisation_id, review_note',
    )
    .order('created_at', { ascending: false });

  const rows = (data ?? []) as unknown as Row[];
  const waiting = rows.filter((row) => row.status === 'pending_review');
  const live = rows.filter((row) => row.status === 'live');
  const settled = rows.filter((row) => !['pending_review', 'live'].includes(row.status));

  const card = (row: Row) => (
    <li key={row.id} className="panel space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="eyebrow">{PLACEMENT_LABEL[row.placement]}</p>
          <h3 className="font-semibold">{row.headline}</h3>
        </div>
        <span className="chip" data-numeric>
          {money(row.price_cents, row.currency)}
        </span>
      </div>

      <p className="max-w-prose text-sm text-muted">{row.body}</p>
      <p className="text-sm">
        {row.advertiser_name} · <span className="break-all text-muted">{row.advertiser_url}</span>
      </p>
      <p className="text-sm text-muted">
        {row.starts_on} to {row.ends_on}
      </p>

      {row.organisation_id && (
        // In front of the person deciding, not only in front of the reader
        // afterwards. An advertiser we also rate is the whole reason the
        // disclosure exists.
        <p role="note" className="rounded-lg border border-line-strong p-3 text-sm">
          <strong>This advertiser is also assessed by us.</strong> The placement carries that
          disclosure, and it is withheld entirely on the directory if they are listed there.
        </p>
      )}

      {row.review_note && <p className="text-sm text-muted">Note: {row.review_note}</p>}

      {row.status === 'pending_review' && (
        <div className="flex flex-wrap gap-6">
          <ActionForm action={approveSponsorship} submitLabel="Approve and publish">
            <input type="hidden" name="id" value={row.id} />
            <Field label="Note (optional)" name="note" />
          </ActionForm>
          <ActionForm action={rejectSponsorship} submitLabel="Turn down" destructive>
            <input type="hidden" name="id" value={row.id} />
            <Field
              label="Why"
              name="note"
              required
              hint="Recorded against the placement. A refusal with no ground written down is one nobody can defend later."
            />
          </ActionForm>
        </div>
      )}

      {row.status === 'live' && (
        <ActionForm action={endSponsorship} submitLabel="Take it down" destructive>
          <input type="hidden" name="id" value={row.id} />
        </ActionForm>
      )}
    </li>
  );

  return (
    <div className="max-w-3xl space-y-10">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">Placements</h1>
        <p className="max-w-prose text-muted">
          Every paid placement passes through here before it appears, and the database refuses to
          make one live without a recorded review. What is being sold is a position beside our own
          credibility — the day turning one down stops being worth doing is the day the space stops
          being worth buying. <Link href="/advertise">What buyers are told</Link>.
        </p>
      </header>

      <section aria-labelledby="waiting" className="space-y-4">
        <h2 id="waiting" className="text-xl font-semibold">
          Waiting for a decision ({waiting.length})
        </h2>
        {waiting.length === 0 ? (
          <p className="text-muted">Nothing is waiting.</p>
        ) : (
          <ul className="space-y-5">{waiting.map(card)}</ul>
        )}
      </section>

      <section aria-labelledby="live" className="space-y-4">
        <h2 id="live" className="text-xl font-semibold">
          On the site now ({live.length})
        </h2>
        {live.length === 0 ? (
          <p className="text-muted">
            No placement is running. Every surface is showing nothing, which is the default and
            costs nobody anything.
          </p>
        ) : (
          <ul className="space-y-5">{live.map(card)}</ul>
        )}
      </section>

      {settled.length > 0 && (
        <section aria-labelledby="settled" className="space-y-4">
          <h2 id="settled" className="text-xl font-semibold">
            Decided ({settled.length})
          </h2>
          <ul className="space-y-3 text-sm">
            {settled.map((row) => (
              <li key={row.id} className="rounded-lg border border-line p-4">
                <p className="font-medium">
                  {row.advertiser_name} · {row.status}
                </p>
                {row.review_note && <p className="mt-1 text-muted">{row.review_note}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="border-t border-line pt-6 text-sm text-muted">
        <p>
          Every placement on the site is headed “{SPONSOR_LABEL}”, says in the sentence beneath that
          it is an advertisement, and appears on none of the surfaces that show a rating.
        </p>
      </footer>
    </div>
  );
}
