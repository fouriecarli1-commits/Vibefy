import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActionForm, Field, Select } from '@/components/action-form';
import { createClient } from '@/lib/supabase/server';
import { createWorkspace } from './actions';

export const metadata: Metadata = { title: 'Workspaces' };

/**
 * Workspaces.
 *
 * Every account gets a personal one on sign-up. A shared one — an agency or an
 * organisation — is created here, and the person who creates it is its owner
 * from the same moment it exists.
 */
export default async function WorkspacesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/console/workspace');

  const { data: memberships } = await supabase
    .from('memberships')
    .select('id, role, organisations (id, name, slug, account_type, is_personal)');

  return (
    <div className="max-w-3xl space-y-10">
      <header className="space-y-2">
        <p className="text-sm text-muted">
          <Link href="/console">Console</Link> · Workspaces
        </p>
        <h1 className="text-3xl font-bold tracking-tight">Workspaces</h1>
        <p className="text-muted">
          A workspace holds applications, assessments, badges and billing. Everything you can see is
          scoped to the workspaces you are a member of — enforced by the database, not by a filter
          this page remembered to apply.
        </p>
      </header>

      <ul className="space-y-3">
        {(memberships ?? []).map((membership) => {
          const organisation = membership.organisations as unknown as {
            id: string;
            name: string;
            slug: string;
            account_type: string;
            is_personal: boolean;
          } | null;
          if (!organisation) return null;
          return (
            <li key={organisation.id} className="rounded-xl border border-line p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="font-semibold">{organisation.name}</h2>
                <span className="text-sm text-muted">you are {String(membership.role)}</span>
              </div>
              <p className="mt-1 text-sm text-muted">
                /{organisation.slug} · {organisation.account_type}
                {organisation.is_personal ? ' · personal' : ''}
              </p>
              {!organisation.is_personal && (
                <p className="mt-3 text-sm">
                  <Link href={`/console/workspace/${organisation.id}/team`}>Manage</Link>
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <section aria-labelledby="new" className="space-y-4">
        <h2 id="new" className="text-xl font-semibold">
          Create a shared workspace
        </h2>
        <div className="rounded-xl border border-line p-5">
          <ActionForm action={createWorkspace} submitLabel="Create workspace">
            <Field label="Name" name="name" required placeholder="Acme Digital" />
            <Select
              label="Type"
              name="accountType"
              defaultValue="agency"
              options={[
                { value: 'agency', label: 'Agency — you assess applications you built for clients' },
                {
                  value: 'organisation',
                  label: 'Organisation — you oversee applications built inside your own institution',
                },
              ]}
              hint="This decides which surfaces appear, not what anything scores."
            />
          </ActionForm>
        </div>
      </section>
    </div>
  );
}
