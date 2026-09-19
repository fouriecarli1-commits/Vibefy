import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActionForm, Field } from '@/components/action-form';
import { createClient } from '@/lib/supabase/server';
import { saveBuilderProfile, setAppOnProfile, setBuilderProfilePublished } from './actions';

export const metadata: Metadata = { title: 'Your public page' };

/**
 * The controls for a page about you.
 *
 * Three decisions, kept apart because they are three decisions: what the page
 * is called, whether anybody can read it, and which applications are on it.
 * Bundling them would mean somebody changing their handle discovers they have
 * published a list of everything they have ever had assessed.
 *
 * Every application is a separate switch, and the page says beside each one
 * whether its mark is live — because an application with no live mark is on the
 * list and invisible to a reader, and somebody who does not know that will
 * think the page is broken.
 */
export default async function BuilderProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/console/profile');

  const { data: memberships } = await supabase
    .from('memberships')
    .select('role, organisations (id, name, is_personal)')
    .in('role', ['owner', 'admin']);

  const workspaces = (memberships ?? [])
    .map((membership) => membership.organisations as unknown as { id: string; name: string })
    .filter(Boolean);

  /*
   * Which workspace this page is about.
   *
   * The first version silently took whichever came back first, which is fine
   * for the common case of one workspace and wrong for everybody else: a
   * person who belongs to three would have configured one of them without ever
   * being told which, and would have had no way to reach the other two.
   */
  const asked = typeof params.workspace === 'string' ? params.workspace : null;
  const organisation = workspaces.find((row) => row.id === asked) ?? workspaces[0];

  if (!organisation) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Your public page</h1>
        <p className="text-muted">
          Only an owner or an admin of a workspace can set one up.{' '}
          <Link href="/console/workspace">Your workspaces are here</Link>.
        </p>
      </div>
    );
  }

  const { data: profile } = await supabase
    .from('builder_profiles')
    .select('handle, display_name, tagline, published')
    .eq('organisation_id', organisation.id)
    .maybeSingle();

  const { data: apps } = await supabase
    .from('apps')
    .select('id, name')
    .eq('organisation_id', organisation.id)
    .order('name');

  const { data: shown } = await supabase
    .from('builder_profile_apps')
    .select('app_id')
    .eq('organisation_id', organisation.id);

  const { data: badges } = await supabase.from('badges').select('app_id, status');

  const onProfile = new Set((shown ?? []).map((row) => String(row.app_id)));
  const liveBadge = new Set(
    (badges ?? []).filter((row) => row.status === 'active').map((row) => String(row.app_id)),
  );

  return (
    <div className="max-w-3xl space-y-10">
      <header className="space-y-2">
        <p className="text-sm text-muted">
          <Link href="/console">Console</Link> · Your public page
        </p>
        <h1 className="text-3xl font-bold tracking-tight">Your public page</h1>
        <p className="text-sm text-muted">
          For <strong>{organisation.name}</strong>. A page belongs to one workspace, because the
          applications on it do.
        </p>
        {workspaces.length > 1 && (
          <p className="flex flex-wrap gap-3 text-sm">
            {workspaces
              .filter((row) => row.id !== organisation.id)
              .map((row) => (
                <Link key={row.id} href={`/console/profile?workspace=${row.id}`}>
                  Switch to {row.name}
                </Link>
              ))}
          </p>
        )}
        <p className="max-w-prose text-muted">
          A page listing the applications you have had assessed, for a proposal or the bottom of a
          CV. Nothing appears on it until you put it there, one application at a time, and taking
          any of it down is one action that needs nobody’s agreement but yours.
        </p>
      </header>

      <section aria-labelledby="address" className="space-y-4 rounded-xl border border-line p-6">
        <h2 id="address" className="text-lg font-semibold">
          The address and the name
        </h2>
        <ActionForm action={saveBuilderProfile} submitLabel="Save">
          <input type="hidden" name="organisationId" value={organisation.id} />
          <Field
            label="Handle"
            name="handle"
            defaultValue={profile?.handle ? String(profile.handle) : ''}
            hint="Your page will be at /b/your-handle. Lowercase letters, numbers and hyphens."
          />
          <Field
            label="Name to show"
            name="displayName"
            defaultValue={profile?.display_name ? String(profile.display_name) : organisation.name}
            hint="Your name, or your team’s."
          />
          <Field
            label="One line about you"
            name="tagline"
            defaultValue={profile?.tagline ? String(profile.tagline) : ''}
            hint="Optional. A sentence at most — this is not a biography."
          />
        </ActionForm>
      </section>

      {profile && (
        <section
          aria-labelledby="published"
          className="space-y-4 rounded-xl border border-line p-6"
        >
          <h2 id="published" className="text-lg font-semibold">
            {profile.published ? 'Your page is live' : 'Your page is not published'}
          </h2>
          <p className="max-w-prose text-sm text-muted">
            {profile.published ? (
              <>
                Anybody with the address can read it:{' '}
                <Link href={`/b/${String(profile.handle)}`}>/b/{String(profile.handle)}</Link>.
                Taking it down takes effect immediately, including for anybody already holding the
                link.
              </>
            ) : (
              'Nobody can read it, including anybody who has the address. Publishing takes effect immediately.'
            )}
          </p>
          <ActionForm
            action={setBuilderProfilePublished}
            submitLabel={profile.published ? 'Take it down' : 'Publish it'}
          >
            <input type="hidden" name="organisationId" value={organisation.id} />
            <input type="hidden" name="published" value={profile.published ? 'false' : 'true'} />
          </ActionForm>
        </section>
      )}

      <section aria-labelledby="which" className="space-y-4">
        <h2 id="which" className="text-2xl font-bold tracking-tight">
          Which applications
        </h2>
        <p className="max-w-prose text-muted">
          One decision each. An application only appears to a reader while its mark is live — an
          assessment that earned no mark is yours to talk about, and this page is not where that
          gets decided for you.
        </p>
        <ul className="space-y-3">
          {(apps ?? []).map((app) => {
            const id = String(app.id);
            const listed = onProfile.has(id);
            return (
              <li key={id} className="panel space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="font-semibold">{String(app.name)}</h3>
                  <span className="text-sm text-muted">
                    {listed
                      ? liveBadge.has(id)
                        ? 'On your page'
                        : 'On your page, but hidden until its mark is live'
                      : 'Not on your page'}
                  </span>
                </div>
                <ActionForm
                  action={setAppOnProfile}
                  submitLabel={listed ? 'Take it off' : 'Put it on'}
                >
                  <input type="hidden" name="organisationId" value={organisation.id} />
                  <input type="hidden" name="appId" value={id} />
                  <input type="hidden" name="shown" value={listed ? 'false' : 'true'} />
                </ActionForm>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
