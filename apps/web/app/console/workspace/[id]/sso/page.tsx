import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ActionForm, Checkbox, Field, Select } from '@/components/action-form';
import { createClient } from '@/lib/supabase/server';
import { saveSsoConnection, setSsoEnforcement, verifySsoDomain } from '../../actions';

export const metadata: Metadata = { title: 'Single sign-on' };

export default async function SsoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=/console/workspace/${id}/sso`);

  const { data: connections } = await supabase
    .from('sso_connections')
    .select('*')
    .eq('organisation_id', id)
    .order('created_at');

  return (
    <div className="space-y-10">
      <section className="rounded-xl border border-line bg-surface-muted p-5 text-sm">
        <h2 className="font-semibold text-ink">How a domain claim works</h2>
        <p className="mt-2 text-muted">
          Claiming an email domain routes everyone at that domain through your identity provider. An
          unverified claim would let anyone route another company’s staff logins through their own,
          so the domain is proved by DNS TXT — the same method an application’s ownership is proved
          by — and one domain can belong to one workspace only.
        </p>
        <p className="mt-2 text-muted">
          Registering the identity provider itself is still a manual step on our side. Nothing
          changes for your users until it is done, and enforcement cannot be switched on before the
          domain is verified.
        </p>
      </section>

      {(connections ?? []).map((connection) => (
        <section
          key={connection.id as string}
          className="space-y-4 rounded-xl border border-line p-5"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-semibold">{String(connection.email_domain)}</h2>
            <span className="text-sm text-muted">
              {String(connection.provider).toUpperCase()} ·{' '}
              {connection.domain_verified_at ? 'domain verified' : 'domain not verified'}
              {connection.enforced ? ' · enforced' : ''}
            </span>
          </div>

          {!connection.domain_verified_at && (
            <div className="text-sm">
              <p className="text-muted">Publish this TXT record at the domain root, then verify:</p>
              <pre className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface-muted p-3">
                <code>
                  {String(connection.email_domain)}. IN TXT &quot;
                  {String(connection.domain_challenge)}&quot;
                </code>
              </pre>
              <div className="mt-4">
                <ActionForm action={verifySsoDomain} submitLabel="Verify domain">
                  <input type="hidden" name="connectionId" value={connection.id as string} />
                </ActionForm>
              </div>
            </div>
          )}

          <ActionForm action={setSsoEnforcement} submitLabel="Update enforcement">
            <input type="hidden" name="connectionId" value={connection.id as string} />
            <Checkbox
              name="enforced"
              label="Refuse password sign-in for addresses at this domain"
              defaultChecked={Boolean(connection.enforced)}
              hint="Requires a verified domain. Enforcing an unverified one would lock out the people who own it."
            />
          </ActionForm>
        </section>
      ))}

      <section aria-labelledby="claim" className="space-y-4">
        <h2 id="claim" className="text-xl font-semibold">
          Claim a domain
        </h2>
        <div className="rounded-xl border border-line p-5">
          <ActionForm action={saveSsoConnection} submitLabel="Claim domain">
            <input type="hidden" name="organisationId" value={id} />
            <Field label="Email domain" name="emailDomain" required placeholder="acme.example" />
            <Select
              label="Protocol"
              name="provider"
              defaultValue="saml"
              options={[
                { value: 'saml', label: 'SAML 2.0' },
                { value: 'oidc', label: 'OpenID Connect' },
              ]}
            />
            <Select
              label="Role for people who sign in this way"
              name="defaultRole"
              defaultValue="member"
              options={[
                { value: 'member', label: 'Member' },
                { value: 'admin', label: 'Admin' },
              ]}
              hint="Ownership is never granted by single sign-on."
            />
          </ActionForm>
        </div>
      </section>
    </div>
  );
}
