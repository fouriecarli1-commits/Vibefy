import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { recordSignUpConsents } from '@/lib/consent';

export const metadata: Metadata = { title: 'Console' };

/**
 * Screening is the check that runs before anything is authorised, and its state
 * decides what a customer can do next — so it is shown as a chip rather than
 * left in the database. Colour alone would be invisible to a colourblind reader;
 * `data-tone` moves the border as well.
 */
const SCREENING_TONE: Record<string, string | undefined> = {
  cleared: 'ok',
  passed: 'ok',
  pending: 'warn',
  in_review: 'warn',
  refused: 'bad',
  blocked: 'bad',
};

/**
 * The console's front door.
 *
 * Everything here is filtered by row-level security, so it shows the caller's
 * own workspaces and applications and nothing else — by construction, rather
 * than by a WHERE clause somebody remembered to write.
 *
 * It listed neither for its first weeks. The page queried `apps` and discarded
 * the result, and nothing anywhere linked to `/console/apps/new`, so the one
 * action the console exists for was reachable only by typing the URL. The
 * navigation described this page as "your applications and their state" the
 * whole time. A page that quietly does not keep its own promise is worse than a
 * missing page: a missing page sends you looking somewhere else.
 */
export default async function ConsolePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/sign-in?next=/console');

  await recordSignUpConsents();

  const { data: memberships, error } = await supabase
    .from('memberships')
    .select('role, organisations (id, name, slug, account_type, is_personal)');

  const { data: apps } = await supabase
    .from('apps')
    .select('id, name, primary_url, screening_status')
    .order('created_at', { ascending: false });

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Console</h1>
        <p className="text-muted">Signed in as {user.email}</p>
      </header>

      <section aria-labelledby="applications" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="applications" className="text-xl font-semibold">
            Your applications
          </h2>
          <Link href="/console/apps/new" className="nav-cta">
            Add an application
          </Link>
        </div>

        {(apps ?? []).length > 0 ? (
          <ul className="space-y-3">
            {(apps ?? []).map((app) => {
              const screening = String(app.screening_status ?? 'pending');
              return (
                <li key={String(app.id)} className="panel space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <h3 className="font-semibold">
                      <Link href={`/console/apps/${String(app.id)}`}>{String(app.name)}</Link>
                    </h3>
                    <span className="chip" data-tone={SCREENING_TONE[screening]}>
                      {screening.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <p className="text-sm text-muted">{String(app.primary_url)}</p>
                </li>
              );
            })}
          </ul>
        ) : (
          // An empty state that says what to do next. The alternative — an empty
          // list under a heading — reads as a page that is broken rather than as
          // one that is waiting.
          <div className="bar">
            <div className="space-y-2">
              <p className="text-sm">
                Nothing here yet. Add the application you want assessed, and the next step will be
                proving you are entitled to authorise testing of it.
              </p>
              <p className="text-xs text-muted">
                Nothing is tested before that check passes — for your protection and ours.
              </p>
            </div>
          </div>
        )}
      </section>

      {error ? (
        <p role="alert" className="rounded-xl border border-line p-5 text-bad">
          Could not load your workspaces: {error.message}
        </p>
      ) : (
        <section aria-labelledby="workspaces" className="space-y-4">
          <h2 id="workspaces" className="text-xl font-semibold">
            Your workspaces
          </h2>
          <ul className="grid-cards">
            {(memberships ?? []).map((membership, index) => {
              const organisation = membership.organisations as unknown as {
                id: string;
                name: string;
                slug: string;
                account_type: string;
                is_personal: boolean;
              } | null;
              if (!organisation) return null;
              return (
                <li key={organisation.id ?? index} className="panel space-y-1.5">
                  <h3 className="font-semibold">{organisation.name}</h3>
                  <p className="text-sm text-muted">
                    /{organisation.slug} · {organisation.account_type}
                    {organisation.is_personal ? ' · personal' : ''} · you are {membership.role}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
