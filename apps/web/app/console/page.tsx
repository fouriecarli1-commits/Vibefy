import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { recordSignUpConsents } from '@/lib/consent';

export const metadata: Metadata = { title: 'Console' };

/**
 * M0 console: proof that authentication, the sign-up trigger and row-level
 * security work end to end. Everything this page reads is filtered by RLS, so
 * it shows the caller's own organisations and nothing else — by construction,
 * not by a WHERE clause we remembered to write.
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

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Console</h1>
        <p className="text-muted">Signed in as {user.email}</p>
      </header>

      {error ? (
        <p role="alert" className="rounded-xl border border-line p-5 text-bad">
          Could not load your workspaces: {error.message}
        </p>
      ) : (
        <section aria-labelledby="workspaces" className="space-y-4">
          <h2 id="workspaces" className="text-xl font-semibold">
            Your workspaces
          </h2>
          <ul className="space-y-3">
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
                <li key={organisation.id ?? index} className="rounded-xl border border-line p-5">
                  <h3 className="font-semibold">{organisation.name}</h3>
                  <p className="mt-1 text-sm text-muted">
                    /{organisation.slug} · {organisation.account_type}
                    {organisation.is_personal ? ' · personal' : ''} · you are {membership.role}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-line bg-surface-muted p-5 text-sm text-muted">
        <h2 className="font-semibold text-ink">What is not here yet</h2>
        <p className="mt-2">
          App intake, the authorisation-to-test flow and the assessment engine arrive in M1; reports
          and payments in M2; the badge in M3. See docs/OPEN_ITEMS.md.
        </p>
      </section>
    </div>
  );
}
