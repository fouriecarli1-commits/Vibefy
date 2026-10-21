import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { entitlementFor, type PlanTier } from '@vibefycode/billing';
import { createClient } from '@/lib/supabase/server';
import { readAsUser } from '@/lib/sql';
import { couldNot } from '@/lib/what-we-could-not-do';
import { whatComesNext } from '@/lib/what-comes-next';
import { embedded } from '@/lib/embedded';
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
    .select('role, organisations (id, name, slug, account_type, is_personal)')
    .order('organisation_id');

  /*
   * One query rather than four, and read as the caller.
   *
   * The list used to carry the screening status and nothing else, so an
   * application that was authorised and ready to assess looked exactly like one
   * waiting for a DNS record. The three facts that decide what to do next —
   * whether the gate says it may be tested, whether anything is in flight, and
   * what the last run came to — live in three other tables, and `readAsUser`
   * runs the join under the caller's own row-level security rather than
   * assembling it from four round trips through PostgREST.
   */
  const apps = await readAsUser(user.id, async (client) => {
    const { rows } = await client.query<{
      id: string;
      name: string;
      primary_url: string;
      screening_status: string;
      authorisation: string | null;
      authorised: boolean;
      open_request: string | null;
      latest_assessment: string | null;
      latest_assessment_id: string | null;
    }>(
      `select a.id, a.name, a.primary_url, a.screening_status::text as screening_status,
              (select c.status::text from public.current_authorisation(a.id) c) as authorisation,
              public.app_is_authorised_for_testing(a.id) as authorised,
              (select r.status::text from public.assessment_requests r
                where r.app_id = a.id and r.status in ('queued', 'claimed')
                order by r.created_at desc limit 1) as open_request,
              (select s.status::text from public.assessments s
                where s.app_id = a.id order by s.created_at desc limit 1) as latest_assessment,
              (select s.id::text from public.assessments s
                where s.app_id = a.id order by s.created_at desc limit 1) as latest_assessment_id
         from public.apps a
        where a.archived_at is null
        order by a.created_at desc`,
    );
    return rows;
  }).catch((error: unknown) => {
    // The list is the front door. Losing it to a failed read and saying nothing
    // is the defect this codebase keeps finding, so the page says it below and
    // the log says which read it was.
    couldNot(
      'read the applications on the console',
      {
        shown: 'the console with no applications on it, as though none had been added',
      },
      error,
    );
    return null;
  });

  /*
   * The plan of one workspace, not of whichever subscription came back first.
   *
   * Row-level security lets a member read the subscriptions of every workspace
   * they belong to, and this selected `plan, status` — without
   * `organisation_id`, so there was nothing to scope by even in principle. A
   * consultant in a client's Agency workspace saw "Plan: agency" on their own
   * console, with that plan's depth and badge eligibility beside it.
   *
   * It was a display fault rather than an entitlement bypass, and saying so
   * matters: what an account may actually do is decided by `resolvePlan(client,
   * { organisationId, appId })` in the worker and in the server actions, scoped
   * to one workspace and always so. Nobody got a run they had not paid for.
   * They got a front door that disagreed with the thing enforcing it.
   */
  const workspaceOf = (row: { organisations: unknown }) =>
    embedded<{ id: string; is_personal: boolean }>(
      row.organisations as
        | { id: string; is_personal: boolean }
        | { id: string; is_personal: boolean }[]
        | null,
    );
  const shownWorkspace =
    (memberships ?? []).map(workspaceOf).find((org) => org?.is_personal)?.id ??
    workspaceOf(memberships?.[0] ?? { organisations: null })?.id;

  const { data: subscriptions } = await supabase
    .from('subscriptions')
    .select('organisation_id, plan, status');
  const live = subscriptions?.find(
    (row) =>
      String(row.organisation_id) === String(shownWorkspace) &&
      ['active', 'trialing'].includes(String(row.status)),
  );
  const currentPlan = (live?.plan ?? 'free') as PlanTier;
  const entitlement = entitlementFor(currentPlan);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Console</h1>
        <p className="text-muted">Signed in as {user.email}</p>
      </header>

      {/* The plan decides how deep an assessment runs and whether a badge can be
          held at all, so it belongs on the front door rather than two levels
          into a menu. A customer who cannot see which plan they are on finds out
          when a run is refused. */}
      <div className="bar flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          Plan: <span className="font-medium capitalize">{currentPlan.replace(/_/g, ' ')}</span>
          <span className="text-muted">
            {' '}
            · {entitlement.depth} depth ·{' '}
            {entitlement.badgeEligible ? 'badge-eligible' : 'not badge-eligible'}
          </span>
        </p>
        <Link href="/console/billing" className="nav-cta">
          Plan &amp; billing
        </Link>
      </div>

      <section aria-labelledby="applications" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="applications" className="text-xl font-semibold">
            Your applications
          </h2>
          <Link href="/console/apps/new" className="nav-cta">
            Add an application
          </Link>
        </div>

        {apps === null && (
          <p role="alert" className="rounded-xl border border-line p-5 text-bad">
            Your applications could not be loaded just now. Nothing has happened to them — this is a
            fault on our side, and it is recorded.
          </p>
        )}

        {(apps ?? []).length > 0 ? (
          <ul className="space-y-3">
            {(apps ?? []).map((app) => {
              const screening = String(app.screening_status ?? 'pending');
              const next = whatComesNext({
                appId: String(app.id),
                screening,
                authorisation: app.authorisation,
                authorisedForTesting: app.authorised === true,
                openRequest: app.open_request,
                latestAssessment: app.latest_assessment,
                latestAssessmentId: app.latest_assessment_id,
              });
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
                  {/* The step this application is actually on. Every one of
                      these states already decides what the product will allow;
                      until now it was legible only by opening the page that
                      enforces it. */}
                  <p className="text-sm">
                    <span className="font-medium">
                      {next.yours ? 'Your next step: ' : 'Waiting: '}
                    </span>
                    {next.href ? <Link href={next.href}>{next.label}</Link> : next.label}
                    <span className="text-muted"> — {next.what}</span>
                  </p>
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
                <li key={organisation.id ?? index} className="panel space-y-2">
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
