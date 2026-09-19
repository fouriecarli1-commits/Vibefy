import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { readAsAnon } from '@/lib/sql';

export const dynamic = 'force-dynamic';

interface Row {
  handle: string;
  display_name: string;
  tagline: string | null;
  app_name: string;
  badge_slug: string;
  score: string;
  rubric_version: string;
  assessed_at: string;
  expires_at: string | null;
}

/**
 * A page for the person who built the things.
 *
 * Somebody who builds quickly and wants to be taken seriously has nothing to
 * link to from a proposal or a CV. This is that link, and it is the first page
 * here that says something about a *person* rather than about an application —
 * which is why every fact on it had to be switched on by them, one application
 * at a time, and can be switched off again without asking us.
 *
 * Only applications whose badge is live today appear. An assessment that earned
 * no badge is the owner's to talk about if they want to; a page we host is not
 * where that decision should be made for them.
 *
 * Nothing here is a claim we are making about the person. It is a list of
 * assessments, each linking to its own verification page, where the scope and
 * the limits are stated in full — and the sentence at the bottom says so,
 * because a page of green ticks reads as an endorsement unless it does.
 */
async function load(handle: string): Promise<Row[]> {
  return readAsAnon(async (client) => {
    const { rows } = await client.query<Row>(
      `select handle, display_name, tagline, app_name, badge_slug, score,
              rubric_version, assessed_at, expires_at
         from public.builder_profile_public
        where handle = $1
        order by assessed_at desc`,
      [handle.toLowerCase()],
    );
    return rows;
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const rows = await load(handle);
  const profile = rows[0];
  if (!profile) return { title: 'Not found' };
  return {
    title: `${profile.display_name} — assessed work`,
    description:
      profile.tagline ??
      `Applications by ${profile.display_name} that VibefyCode has assessed, with badges that are live today.`,
  };
}

export default async function BuilderProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const rows = await load(handle);
  const profile = rows[0];
  if (!profile) notFound();

  return (
    <div className="max-w-3xl space-y-10">
      <header className="space-y-3">
        <p className="eyebrow">Assessed work</p>
        <h1 className="text-4xl font-bold tracking-tight">{profile.display_name}</h1>
        {profile.tagline && <p className="text-lg text-muted">{profile.tagline}</p>}
      </header>

      <section aria-labelledby="work" className="space-y-5">
        <h2 id="work" className="text-2xl font-bold tracking-tight">
          {rows.length} application{rows.length === 1 ? '' : 's'} with a live mark
        </h2>
        <ul className="space-y-4">
          {rows.map((row) => (
            <li key={row.badge_slug} className="panel space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h3 className="text-lg font-semibold">
                  <Link href={`/a/${row.badge_slug}`}>{row.app_name}</Link>
                </h3>
                <span className="font-medium">{Number(row.score).toFixed(1)} / 100</span>
              </div>
              <p className="text-sm text-muted">
                Assessed {new Date(row.assessed_at).toISOString().slice(0, 10)} against rubric v
                {row.rubric_version}
                {row.expires_at
                  ? `, current until ${new Date(row.expires_at).toISOString().slice(0, 10)}`
                  : ''}
                .
              </p>
              <p className="text-sm">
                <Link href={`/a/${row.badge_slug}`}>What was checked, and what was not</Link>
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* A page of scores reads as an endorsement unless it says otherwise, and
          this one is a list of assessments rather than an opinion about a
          person. Last, where the reader has the list in front of them. */}
      <section
        aria-labelledby="what-this-is"
        className="space-y-3 rounded-xl border border-line-strong p-6"
      >
        <h2 id="what-this-is" className="text-xl font-semibold">
          What this page is
        </h2>
        <p className="text-muted">
          A list of applications this person or team asked us to assess, and chose to show here, one
          at a time. It is not a rating of them, and it is not a recommendation. Each assessment
          covered a stated scope on a stated date, and the page behind each link says what that
          scope was and what it did not cover.
        </p>
        <p className="text-muted">
          Applications whose mark is not live today do not appear here, and neither does anything
          its owner did not choose to show. That means this page tells you nothing about work that
          is missing from it.
        </p>
        <p className="text-sm">
          <Link href="/methodology">How the score is worked out</Link> ·{' '}
          <Link href="/services">What VibefyCode does</Link>
        </p>
      </section>
    </div>
  );
}
