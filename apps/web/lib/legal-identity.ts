import type { PoolClient } from 'pg';

/**
 * Who a workspace is, in law, and how to reach it.
 *
 * Four facts the console never held, and each one is load-bearing somewhere:
 *
 *   · the country decides which law governs the agreement, and therefore which
 *     variant of a document somebody is accepting. The registry carries one
 *     baseline for everybody, which is true only while there is one set of
 *     documents, and the founder has said there will not be;
 *   · the registration number is who the counterparty actually is. A display
 *     name is not a party to a contract, and an authorisation warranty given by
 *     a name that identifies nobody is worth less than one given by a company
 *     number;
 *   · the email and the phone number are how somebody is reached about a
 *     suspension, a revocation or a statutory deadline, which an account login
 *     is not;
 *   · the DUNS number is for a buyer whose procurement asks. Optional, and
 *     nothing here refuses anybody for lacking one.
 */

export interface LegalIdentity {
  readonly country: string | null;
  readonly registrationNumber: string | null;
  readonly dunsNumber: string | null;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
}

/** ISO 3166-1 alpha-2, upper case, as the column's own constraint spells it. */
const ISO_ALPHA_2 = /^[A-Z]{2}$/;
const DUNS = /^[0-9]{9}$/;

/**
 * Why the form will not be accepted, field by field, or nothing.
 *
 * Checked here as well as by the database. The column constraints are what
 * actually holds the rule; what Postgres says when one is violated — `violates
 * check constraint "organisations_duns_is_nine_digits"` — is not a sentence to
 * show somebody filling in a form.
 */
export function whyTheIdentityIsRefused(identity: LegalIdentity): Record<string, string> {
  const refused: Record<string, string> = {};

  if (identity.country !== null && !ISO_ALPHA_2.test(identity.country)) {
    refused.country = 'Choose a country from the list.';
  }
  if (identity.dunsNumber !== null && !DUNS.test(identity.dunsNumber)) {
    refused.dunsNumber =
      'A DUNS number is nine digits. Leave it empty if you do not have one — nothing here needs it.';
  }
  if (
    identity.contactEmail !== null &&
    !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(identity.contactEmail)
  ) {
    refused.contactEmail = 'That does not look like an email address.';
  }
  if (identity.contactPhone !== null && !/^[+0-9][0-9\s()-]{5,24}$/.test(identity.contactPhone)) {
    refused.contactPhone =
      'Digits, spaces and + ( ) - only. Include the country code if this number is not local to you.';
  }
  return refused;
}

/** Empty becomes null, so "not answered" and "answered with nothing" are one thing. */
export function identityFromForm(read: (field: string) => string | null): LegalIdentity {
  const value = (field: string) => {
    const written = (read(field) ?? '').trim();
    return written === '' ? null : written;
  };
  const country = value('country');
  return {
    country: country === null ? null : country.toUpperCase(),
    registrationNumber: value('registrationNumber'),
    dunsNumber: value('dunsNumber')?.replace(/[\s-]/g, '') ?? null,
    contactEmail: value('contactEmail'),
    contactPhone: value('contactPhone'),
  };
}

/**
 * Whether this database has the columns yet.
 *
 * The migration is one of a pile the founder runs by hand, so the product has
 * to work before it has been run. The alternative — a page that throws
 * `column "country" does not exist` — is the failure this console spends its
 * time removing, and it would arrive on the page somebody opened to answer the
 * question the migration exists for.
 *
 * Asked once per process and remembered, like the provenance column in the
 * worker, with the same seam for a test that needs to ask again.
 */
let columnsPresent: boolean | null = null;

export function forgetIdentityColumns(): void {
  columnsPresent = null;
}

export async function databaseCarriesIdentity(client: Pick<PoolClient, 'query'>): Promise<boolean> {
  if (columnsPresent !== null) return columnsPresent;
  const { rows } = await client.query(
    `select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'organisations'
        and column_name in ('country', 'registration_number', 'duns_number', 'contact_phone')
      group by table_name having count(*) = 4`,
  );
  columnsPresent = rows.length > 0;
  return columnsPresent;
}

export async function readLegalIdentity(
  client: Pick<PoolClient, 'query'>,
  organisationId: string,
): Promise<LegalIdentity | null> {
  if (!(await databaseCarriesIdentity(client))) return null;
  const { rows } = await client.query<{
    country: string | null;
    registration_number: string | null;
    duns_number: string | null;
    billing_email: string | null;
    contact_phone: string | null;
  }>(
    `select country, registration_number, duns_number, billing_email, contact_phone
       from public.organisations where id = $1`,
    [organisationId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    country: row.country,
    registrationNumber: row.registration_number,
    dunsNumber: row.duns_number,
    contactEmail: row.billing_email,
    contactPhone: row.contact_phone,
  };
}

export async function writeLegalIdentity(
  client: Pick<PoolClient, 'query'>,
  organisationId: string,
  identity: LegalIdentity,
): Promise<void> {
  await client.query(
    `update public.organisations
        set country = $2, registration_number = $3, duns_number = $4,
            billing_email = $5, contact_phone = $6
      where id = $1`,
    [
      organisationId,
      identity.country,
      identity.registrationNumber,
      identity.dunsNumber,
      identity.contactEmail,
      identity.contactPhone,
    ],
  );
}
