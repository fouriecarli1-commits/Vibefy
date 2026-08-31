import type { Metadata } from 'next';
import Link from 'next/link';
import {
  categoriesOf,
  DIMENSIONS,
  isSortKey,
  queryDirectory,
  NO_PAID_PLACEMENT,
  DIRECTORY_SCOPE,
  MARKETING_CLIENT_DISCLOSURE,
  type DirectoryEntry,
  type SortKey,
} from '@vibefycode/directory';
import { SponsorSlot } from '@/components/sponsor-slot';
import { readAsAnon } from '@/lib/sql';

export const metadata: Metadata = {
  title: 'Directory',
  description:
    'Applications with a live Verified by VibefyCode badge, ordered by the published rubric. Placement is not for sale.',
};

export const dynamic = 'force-dynamic';

interface DirectoryRow {
  slug: string;
  name: string;
  certified_origin: string;
  score: string;
  rubric_version: string;
  assessed_at: string;
  dimension_scores: { dimension: string; score: number }[] | null;
  tagline: string | null;
  category: string | null;
  is_marketing_client: boolean;
}

/**
 * The public directory.
 *
 * Read as `anon`, from a view that joins the live badge rather than a stored
 * flag — so a suspension removes a listing at the moment it changes the
 * verification page, and there is no cache anywhere saying otherwise.
 */
async function loadEntries(): Promise<DirectoryEntry[]> {
  const rows = await readAsAnon(async (client) => {
    const { rows } = await client.query<DirectoryRow>(
      `select slug, name, certified_origin, score, rubric_version, assessed_at,
              dimension_scores, tagline, category, is_marketing_client
         from public.directory`,
    );
    return rows;
  });

  return rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    certifiedOrigin: row.certified_origin,
    score: Number(row.score),
    rubricVersion: row.rubric_version,
    assessedOn: new Date(row.assessed_at).toISOString().slice(0, 10),
    dimensions: (row.dimension_scores ?? []).map((entry) => ({
      dimension: entry.dimension as DirectoryEntry['dimensions'][number]['dimension'],
      score: Number(entry.score),
    })),
    tagline: row.tagline,
    category: row.category,
    ownerIsMarketingClient: row.is_marketing_client,
  }));
}

const SORT_LABEL: Record<SortKey, string> = {
  score: 'Overall score',
  recent: 'Most recently assessed',
  functional_integrity: 'Functional integrity',
  security_posture: 'Security posture',
  data_privacy_practice: 'Data privacy practice',
  practicality_ux: 'Practicality and UX',
  production_readiness: 'Production readiness',
  store_distribution_readiness: 'Store distribution readiness',
};

export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; category?: string; page?: string }>;
}) {
  const params = await searchParams;
  const entries = await loadEntries();
  const sort: SortKey = params.sort && isSortKey(params.sort) ? params.sort : 'score';
  const result = queryDirectory(entries, {
    search: params.q ?? '',
    category: params.category ?? null,
    sort,
    page: Number(params.page ?? '1') || 1,
  });
  const categories = categoriesOf(entries);

  return (
    <div className="space-y-10">
      <header className="max-w-2xl space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">Directory</h1>
        <p className="text-muted">
          Applications with a live &ldquo;Verified by VibefyCode&rdquo; badge. A listing appears
          only while the badge is live: if one is suspended, expires or is revoked, its listing goes
          with it in the same instant.
        </p>
        <p className="text-sm text-muted">{DIRECTORY_SCOPE}</p>
      </header>

      <form
        method="get"
        action="/directory"
        className="grid gap-4 rounded-xl border border-line p-5 sm:grid-cols-3"
      >
        <div className="space-y-2">
          <label htmlFor="q" className="block text-sm font-medium">
            Search
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={params.q ?? ''}
            placeholder="Name, domain or category"
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="sort" className="block text-sm font-medium">
            Order by
          </label>
          <select
            id="sort"
            name="sort"
            defaultValue={sort}
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2"
          >
            <option value="score">{SORT_LABEL.score}</option>
            <option value="recent">{SORT_LABEL.recent}</option>
            {DIMENSIONS.map((dimension) => (
              <option key={dimension} value={dimension}>
                {SORT_LABEL[dimension]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label htmlFor="category" className="block text-sm font-medium">
            Category
          </label>
          <select
            id="category"
            name="category"
            defaultValue={params.category ?? ''}
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2"
          >
            <option value="">All</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-3">
          <button
            type="submit"
            className="rounded-lg bg-accent px-4 py-3 font-medium text-on-accent"
          >
            Apply
          </button>
        </div>
      </form>

      <p className="text-sm text-muted">
        {result.total} {result.total === 1 ? 'listing' : 'listings'} · {result.orderingNote}
      </p>

      {result.entries.length === 0 ? (
        <p className="rounded-xl border border-line p-5 text-sm text-muted">
          Nothing matches that. The directory only ever contains applications with a live badge, so
          it is small by design rather than by accident.
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {result.entries.map((entry) => (
            <li key={entry.slug} className="rounded-xl border border-line p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="font-semibold">
                  <Link href={`/a/${entry.slug}`}>{entry.name}</Link>
                </h2>
                <span className="text-xl font-bold tracking-tight">{entry.score.toFixed(1)}</span>
              </div>
              <p className="mt-1 text-sm text-muted">
                {entry.certifiedOrigin.replace(/^https:\/\//, '')} · assessed {entry.assessedOn} ·
                rubric v{entry.rubricVersion}
              </p>
              {entry.tagline && <p className="mt-3 text-sm">{entry.tagline}</p>}
              {entry.category && <p className="mt-2 text-sm text-muted">{entry.category}</p>}
              {entry.ownerIsMarketingClient && (
                <p className="mt-3 rounded-lg border border-line bg-surface-muted p-3 text-sm text-muted">
                  {MARKETING_CLIENT_DISCLOSURE}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <section className="rounded-xl border border-line bg-surface-muted p-5 text-sm text-muted">
        <h2 className="font-semibold text-ink">How this list is ordered</h2>
        <p className="mt-2">{NO_PAID_PLACEMENT}</p>
        <p className="mt-2">
          Owners choose whether to appear here and can remove a listing at any time, including while
          certified. <Link href="/methodology">How the rubric works</Link>.
        </p>
      </section>

      {/* Below the list and below the explanation of how the list is ordered,
          so a reader has been told what they are looking at before they are
          shown something somebody paid to put there. */}
      <SponsorSlot placement="directory" />
    </div>
  );
}
