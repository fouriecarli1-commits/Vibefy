import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { seatVerdict } from '@vibefycode/workspace';
import { ActionForm, Field, Select } from '@/components/action-form';
import { createClient } from '@/lib/supabase/server';
import { changeRole, inviteMember, removeMember, revokeInvitation } from '../../actions';

export const metadata: Metadata = { title: 'Team & seats' };

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=/console/workspace/${id}/team`);

  const { data: members } = await supabase
    .from('memberships')
    .select('id, role, created_at, users (id, full_name, email)')
    .eq('organisation_id', id)
    .order('created_at');

  // Invitations are readable only by owners and admins, so a member simply sees
  // an empty list here rather than an error.
  const { data: invitations } = await supabase
    .from('invitations')
    .select('id, email, role, expires_at, created_at')
    .eq('organisation_id', id)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('seats, plan, status')
    .eq('organisation_id', id)
    .in('status', ['active', 'trialing'])
    .order('seats', { ascending: false })
    .limit(1)
    .maybeSingle();

  const seats = seatVerdict({
    seats: Number(subscription?.seats ?? 1),
    members: (members ?? []).length,
    pendingInvitations: (invitations ?? []).length,
  });

  return (
    <div className="space-y-10">
      <section aria-labelledby="seats" className="space-y-4">
        <h2 id="seats" className="text-2xl font-bold tracking-tight">
          Seats
        </h2>
        <p className="rounded-xl border border-line bg-surface-muted p-5 text-sm">
          {seats.explanation} An invitation that has not been accepted still holds a seat, and the
          limit is enforced by the database rather than by this page.
        </p>
      </section>

      <section aria-labelledby="members" className="space-y-4">
        <h2 id="members" className="text-xl font-semibold">
          Members
        </h2>
        <ul className="space-y-3">
          {(members ?? []).map((membership) => {
            const person = membership.users as unknown as {
              id: string;
              full_name: string | null;
              email: string;
            } | null;
            return (
              <li key={membership.id as string} className="rounded-xl border border-line p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="font-medium">{person?.full_name ?? person?.email ?? 'Member'}</span>
                  <span className="text-sm text-muted">{String(membership.role)}</span>
                </div>
                <p className="mt-1 text-sm text-muted">{person?.email}</p>
                <div className="mt-4 grid gap-6 sm:grid-cols-2">
                  <ActionForm action={changeRole} submitLabel="Change role">
                    <input type="hidden" name="membershipId" value={membership.id as string} />
                    <Select
                      label="Role"
                      name="role"
                      defaultValue={String(membership.role)}
                      options={[
                        { value: 'member', label: 'Member — reads and requests assessments' },
                        { value: 'admin', label: 'Admin — also manages people and policies' },
                        { value: 'owner', label: 'Owner — also manages billing and single sign-on' },
                      ]}
                    />
                  </ActionForm>
                  <ActionForm action={removeMember} submitLabel="Remove" destructive>
                    <input type="hidden" name="membershipId" value={membership.id as string} />
                    <p className="text-sm text-muted">
                      Access ends immediately. A workspace must keep at least one owner.
                    </p>
                  </ActionForm>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="invite" className="space-y-4">
        <h2 id="invite" className="text-xl font-semibold">
          Invite someone
        </h2>
        <div className="rounded-xl border border-line p-5">
          <p className="mb-4 text-sm text-muted">
            We do not send invitation emails yet. The link is shown to you once, when you create the
            invitation, and we cannot show it again — only its hash is stored. Pass it on yourself.
          </p>
          <ActionForm action={inviteMember} submitLabel="Create invitation">
            <input type="hidden" name="organisationId" value={id} />
            <Field label="Email address" name="email" type="email" required />
            <Select
              label="Role"
              name="role"
              defaultValue="member"
              options={[
                { value: 'member', label: 'Member' },
                { value: 'admin', label: 'Admin' },
              ]}
              hint="Ownership is granted to an existing member by an owner, never sent in an email."
            />
          </ActionForm>
        </div>

        {(invitations ?? []).length > 0 && (
          <ul className="space-y-3">
            {(invitations ?? []).map((invitation) => (
              <li key={invitation.id as string} className="rounded-xl border border-line p-5 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="font-medium">{String(invitation.email)}</span>
                  <span className="text-muted">
                    {String(invitation.role)} · expires{' '}
                    {new Date(invitation.expires_at as string).toISOString().slice(0, 10)}
                  </span>
                </div>
                <div className="mt-3">
                  <ActionForm action={revokeInvitation} submitLabel="Withdraw" destructive>
                    <input type="hidden" name="invitationId" value={invitation.id as string} />
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
