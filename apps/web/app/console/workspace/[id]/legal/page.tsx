import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { COUNTRIES, countryName } from '@vibefycode/shared';
import { ActionForm, Field } from '@/components/action-form';
import { createClient } from '@/lib/supabase/server';
import { whoIsSignedIn } from '@/lib/who-is-signed-in';
import { readAsUser } from '@/lib/sql';
import { readLegalIdentity } from '@/lib/legal-identity';
import { saveLegalIdentity } from '../../actions';

export const metadata: Metadata = { title: 'Legal identity' };
export const dynamic = 'force-dynamic';

/**
 * Who this workspace is, in law, and where to write to it.
 *
 * The console asked for a name and nothing else. A display name is not a party
 * to a contract, and an authorisation warranty — the legal basis for every run
 * this product makes — was being given by one. The country is the part with the
 * longest reach: it decides which law governs the agreement, and therefore
 * which variant of a document somebody is shown and accepts.
 *
 * It degrades rather than throwing. The migration that adds these columns is
 * one of a pile the founder runs by hand, and a page that answers `column
 * "country" does not exist` would arrive on the screen somebody opened to
 * answer the question the migration exists for.
 */
export default async function LegalIdentityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await whoIsSignedIn(supabase);
  if (!user) redirect(`/sign-in?next=/console/workspace/${id}/legal`);

  const { data: organisation } = await supabase
    .from('organisations')
    .select('id, name')
    .eq('id', id)
    .maybeSingle();
  if (!organisation) notFound();

  const identity = await readAsUser(user.id, (client) => readLegalIdentity(client, id));

  if (!identity) {
    return (
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Legal identity</h2>
        <p className="max-w-prose text-muted">
          This database does not have these columns yet. They arrive with the pending migration in{' '}
          <code>docs/sql/OUTSTANDING.sql</code> — block 21 — and this page works the moment it has
          run. Nothing is lost in the meantime; there is simply nowhere to put the answers.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Legal identity</h2>
        <p className="max-w-prose text-muted">
          Who {organisation.name} is as a party to an agreement, and where to reach somebody about
          this workspace. The country decides which law governs that agreement and which version of
          our documents applies to you.
        </p>
      </div>

      <ActionForm action={saveLegalIdentity} submitLabel="Save">
        <input type="hidden" name="organisationId" value={id} />

        <div className="space-y-2">
          <label htmlFor="field-country" className="block text-sm font-medium">
            Country
          </label>
          <select
            id="field-country"
            name="country"
            defaultValue={identity.country ?? ''}
            aria-describedby="field-country-hint"
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2"
          >
            <option value="">Not stated</option>
            {COUNTRIES.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </select>
          <p id="field-country-hint" className="text-sm text-muted">
            Where the entity below is registered, or where you are if you are not a company. It
            decides which law governs our agreement with you.
            {identity.country ? ` Currently ${countryName(identity.country)}.` : ''}
          </p>
        </div>

        <Field
          label="Company or registration number"
          name="registrationNumber"
          defaultValue={identity.registrationNumber ?? ''}
          placeholder="2026/714071/07"
          hint="As the register issues it. This is who the agreement is with — a trading name is not a party to one. Leave it empty if you are not registered as a company."
        />
        <Field
          label="DUNS number"
          name="dunsNumber"
          defaultValue={identity.dunsNumber ?? ''}
          placeholder="123456789"
          hint="Nine digits, and only if you already have one. Some corporate buyers ask for it; nothing here needs it and nothing is refused without it."
        />
        <Field
          label="Contact email"
          name="contactEmail"
          type="email"
          defaultValue={identity.contactEmail ?? ''}
          hint="Where we write about this workspace — a badge suspension, a revocation, a deadline we owe you. It can be a shared address, and it does not have to be the one you sign in with."
        />
        <Field
          label="Mobile number"
          name="contactPhone"
          defaultValue={identity.contactPhone ?? ''}
          placeholder="+27 82 000 0000"
          hint="For the things an email is too slow for. Include the country code. We do not use it for marketing, and it is in your audit export like everything else we hold about you."
        />
      </ActionForm>
    </section>
  );
}
