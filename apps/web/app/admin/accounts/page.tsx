import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PLAN_TIERS, entitlementFor } from '@vibefycode/billing';
import { ActionForm, Select } from '@/components/action-form';
import { createClient } from '@/lib/supabase/server';
import { setPlan, setPlatformRole } from './actions';

export const metadata: Metadata = { title: 'Accounts' };

/**
 * The operator's view of who is who.
 *
 * This page exists because of a specific afternoon. Setting a plan and
 * promoting a reviewer were possible only by typing SQL into the Supabase
 * console, and finding out which account owned an application was possible only
 * by writing a join. Two of those statements ran against the wrong
 * organisation, and neither of us noticed for an hour, because there was
 * nowhere to look.
 *
 * So the page answers three questions in one screen: who owns what, what plan
 * they are on, and what that plan actually permits. The last one is rendered
 * from the entitlement table rather than described, because "one_off" means
 * nothing to the person choosing it and "full depth, up to $4.00, badge-
 * eligible" means everything.
 */

interface Row {
  organisationId: string;
  organisationName: string;
  plan: string | null;
  status: string | null;
  members: { id: string; email: string; role: string; platformRole: string }[];
  apps: { id: string; name: string; url: string | null }[];
}

export default async function AccountsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/admin/accounts');

  const { data: profile } = await supabase
    .from('users')
    .select('platform_role')
    .eq('id', user.id)
    .single();
  if (profile?.platform_role !== 'admin') {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Accounts</h1>
        <p className="text-muted">
          This screen is for VibefyCode administrators. Row-level security means the underlying rows
          are unreadable to anyone else in any case — this message only explains why the page is
          empty.
        </p>
      </div>
    );
  }

  const [organisations, memberships, people, apps, subscriptions] = await Promise.all([
    supabase.from('organisations').select('id, name').order('name'),
    supabase.from('memberships').select('organisation_id, user_id, role'),
    supabase.from('users').select('id, email, platform_role'),
    supabase.from('apps').select('id, name, primary_url, organisation_id').order('name'),
    supabase.from('subscriptions').select('organisation_id, plan, status'),
  ]);

  const personById = new Map(
    (people.data ?? []).map((row) => [
      String(row.id),
      { email: String(row.email), platformRole: String(row.platform_role) },
    ]),
  );

  const rows: Row[] = (organisations.data ?? []).map((organisation) => {
    const id = String(organisation.id);
    const subscription = (subscriptions.data ?? []).find(
      (row) => String(row.organisation_id) === id,
    );
    return {
      organisationId: id,
      organisationName: String(organisation.name),
      plan: subscription ? String(subscription.plan) : null,
      status: subscription ? String(subscription.status) : null,
      members: (memberships.data ?? [])
        .filter((row) => String(row.organisation_id) === id)
        .map((row) => {
          const person = personById.get(String(row.user_id));
          return {
            id: String(row.user_id),
            email: person?.email ?? 'unknown',
            role: String(row.role),
            platformRole: person?.platformRole ?? 'user',
          };
        }),
      apps: (apps.data ?? [])
        .filter((row) => String(row.organisation_id) === id)
        .map((row) => ({
          id: String(row.id),
          name: String(row.name),
          url: row.primary_url === null ? null : String(row.primary_url),
        })),
    };
  });

  const planOptions = PLAN_TIERS.map((plan) => {
    const entitlement = entitlementFor(plan);
    return {
      value: plan,
      label: `${plan} — ${entitlement.depth} depth, up to $${entitlement.maxRunCostUsd.toFixed(2)}, ${
        entitlement.badgeEligible ? 'badge-eligible' : 'no badge'
      }`,
    };
  });

  const roleOptions = [
    { value: 'user', label: 'user — a customer, nothing more' },
    { value: 'reviewer', label: 'reviewer — may approve assessments' },
    { value: 'admin', label: 'admin — may approve assessments and change accounts' },
  ];

  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">Accounts</h1>
        <p className="max-w-prose text-muted">
          Who owns which application, what plan they are on, and what that plan permits. Every
          change here is written to the audit log under your name, and the log cannot be edited
          afterwards.
        </p>
        <p className="text-sm text-muted">
          <Link href="/admin/costs">Unit economics</Link> · <Link href="/review">Review queue</Link>
        </p>
      </header>

      {rows.length === 0 && <p className="text-muted">No workspaces exist yet.</p>}

      {rows.map((row) => (
        <section
          key={row.organisationId}
          aria-labelledby={`org-${row.organisationId}`}
          className="space-y-5 rounded-xl border border-line p-6"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id={`org-${row.organisationId}`} className="text-xl font-bold">
              {row.organisationName}
            </h2>
            <p className="text-sm text-muted">
              {row.plan ? (
                <>
                  {row.plan} · {row.status}
                </>
              ) : (
                'no subscription row — the free tier applies'
              )}
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
                Applications
              </h3>
              {row.apps.length === 0 ? (
                <p className="text-sm text-muted">None.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {row.apps.map((app) => (
                    <li key={app.id}>
                      <Link href={`/console/apps/${app.id}`}>{app.name}</Link>
                      {app.url && <span className="text-muted"> · {app.url}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">People</h3>
              {row.members.length === 0 ? (
                <p className="text-sm text-muted">None.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {row.members.map((member) => (
                    <li key={member.id}>
                      {member.email}{' '}
                      <span className="text-muted">
                        · {member.role}
                        {member.platformRole !== 'user' && ` · platform ${member.platformRole}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="grid gap-6 border-t border-line pt-5 md:grid-cols-2">
            <div>
              <h3 className="mb-3 font-semibold">Set the plan</h3>
              <ActionForm action={setPlan} submitLabel="Set plan">
                <input type="hidden" name="organisationId" value={row.organisationId} />
                <Select
                  label="Plan"
                  name="plan"
                  options={planOptions}
                  defaultValue={row.plan ?? 'free'}
                  hint="Decides assessment depth, what one run may cost, and whether this workspace can hold a badge. Stripe will write this row itself once billing is live."
                />
              </ActionForm>
            </div>

            {row.members.map((member) => (
              <div key={`role-${member.id}`}>
                <h3 className="mb-3 font-semibold">Platform role · {member.email}</h3>
                <ActionForm action={setPlatformRole} submitLabel="Set role">
                  <input type="hidden" name="userId" value={member.id} />
                  <Select
                    label="Role"
                    name="role"
                    options={roleOptions}
                    defaultValue={member.platformRole}
                    hint="A reviewer approves assessments. Owning an application and reviewing one are separate things, and the same person doing both is a conflict worth avoiding."
                  />
                </ActionForm>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
