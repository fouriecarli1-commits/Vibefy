/**
 * The party to the agreement, which the console never asked for.
 *
 * It held a display name. "Futurebox" is not a party to a contract;
 * "FUTUREBOXSTUDIO (PTY) LTD (2026/714071/07)" is — and the authorisation
 * warranty, which is the legal basis for every run this product makes, was
 * being given by the first kind of name.
 *
 * The country is the field with the longest reach. The legal registry carries
 * one `jurisdictionBaseline` for everybody, which is true only while there is
 * one set of documents; the founder has said there will not be. So the country
 * is stored as a code rather than a label, the consent record gains a column
 * saying which variant was shown, and the day a South African Terms exists
 * nothing has to be re-derived from a name somebody typed.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { COUNTRIES, countryName, isKnownCountry } from '../packages/shared/src/countries.ts';
import {
  databaseCarriesIdentity,
  forgetIdentityColumns,
  identityFromForm,
  readLegalIdentity,
  whyTheIdentityIsRefused,
  writeLegalIdentity,
} from '../apps/web/lib/legal-identity.ts';
import { connect } from './setup/client.ts';
import { seedAccount, type SeededAccount } from './setup/seed.ts';

let db: Client;
let owner: SeededAccount;

beforeAll(async () => {
  db = await connect();
  owner = await seedAccount(db, 'legal-identity');
});

afterAll(async () => {
  await db?.end();
});

afterEach(() => {
  forgetIdentityColumns();
});

const form = (fields: Record<string, string>) => identityFromForm((field) => fields[field] ?? null);

describe('what the form may carry', () => {
  it('treats an empty answer as no answer', () => {
    // "Not stated" and "stated as nothing" are one thing, and null is the one
    // the column's constraints are written for.
    const identity = form({ country: '', registrationNumber: '   ', dunsNumber: '' });
    expect(identity).toEqual({
      country: null,
      registrationNumber: null,
      dunsNumber: null,
      contactEmail: null,
      contactPhone: null,
    });
  });

  it('normalises the two fields that arrive in several shapes', () => {
    const identity = form({ country: 'za', dunsNumber: '123-456 789' });
    expect(identity.country, 'the column is upper case and so is the list').toBe('ZA');
    expect(identity.dunsNumber, 'one number should not have three spellings').toBe('123456789');
  });

  it('refuses a DUNS number that is not one, and says it is optional', () => {
    const refused = whyTheIdentityIsRefused(form({ dunsNumber: '12345' }));
    expect(refused.dunsNumber).toMatch(/nine digits/);
    expect(refused.dunsNumber, 'nobody is kept out for lacking one').toMatch(/Leave it empty/);
  });

  it('refuses an address that is not one', () => {
    expect(whyTheIdentityIsRefused(form({ contactEmail: 'anré at example' })).contactEmail).toMatch(
      /email address/,
    );
    expect(whyTheIdentityIsRefused(form({ contactEmail: 'anre@example.com' }))).toEqual({});
  });

  it('takes a phone number in the shapes people write them', () => {
    for (const written of ['+27 82 000 0000', '082 000 0000', '+44 (0)20 7946 0000']) {
      expect(whyTheIdentityIsRefused(form({ contactPhone: written })), written).toEqual({});
    }
    expect(whyTheIdentityIsRefused(form({ contactPhone: 'call me' })).contactPhone).toBeTruthy();
  });

  it('refuses a country that is not a code', () => {
    expect(whyTheIdentityIsRefused({ ...form({}), country: 'South Africa' }).country).toBeTruthy();
    expect(whyTheIdentityIsRefused(form({ country: 'ZA' })).country).toBeUndefined();
  });
});

describe('the country list', () => {
  it('is codes with labels, not labels', () => {
    // The code is what means something: it decides which variant of a document
    // applies. The name is a label in a select and nothing is built from it.
    expect(COUNTRIES.length).toBeGreaterThan(150);
    for (const country of COUNTRIES.slice(0, 20)) {
      expect(country.code, country.name).toMatch(/^[A-Z]{2}$/);
    }
    expect(isKnownCountry('ZA')).toBe(true);
    expect(isKnownCountry('za'), 'the column is upper case').toBe(false);
    expect(isKnownCountry('XX')).toBe(false);
  });

  it('has no duplicates, which a hand-kept list grows', () => {
    const codes = COUNTRIES.map((country) => country.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('answers with the code when it does not know the name', () => {
    expect(countryName('ZA')).toBe('South Africa');
    expect(countryName('XX')).toBe('XX');
    expect(countryName(null)).toBeNull();
  });
});

describe('the columns themselves', () => {
  it('are there after the migration, and the code asks rather than assumes', async () => {
    expect(await databaseCarriesIdentity(db)).toBe(true);
  });

  it('keeps what was written, and reads the contact address back', async () => {
    await writeLegalIdentity(db, owner.organisationId, {
      country: 'ZA',
      registrationNumber: '2026/714071/07',
      dunsNumber: '123456789',
      contactEmail: 'hello@futurebox.studio',
      contactPhone: '+27 82 000 0000',
    });
    const read = await readLegalIdentity(db, owner.organisationId);
    expect(read).toEqual({
      country: 'ZA',
      registrationNumber: '2026/714071/07',
      dunsNumber: '123456789',
      contactEmail: 'hello@futurebox.studio',
      contactPhone: '+27 82 000 0000',
    });
  });

  it('refuses a country the column cannot mean', async () => {
    // The constraint is what holds the rule; the function above only spares somebody
    // the sentence Postgres would have shown them.
    await expect(
      db.query(`update public.organisations set country = 'South Africa' where id = $1`, [
        owner.organisationId,
      ]),
    ).rejects.toThrow(/country/);
  });

  it('refuses a DUNS number that is not nine digits', async () => {
    await expect(
      db.query(`update public.organisations set duns_number = '12345' where id = $1`, [
        owner.organisationId,
      ]),
    ).rejects.toThrow(/duns/);
  });

  it('lets a consent say which country’s document was accepted', async () => {
    /*
     * The evidentiary point. A version and a hash answer "which words" while
     * there is one document per type; the moment there is a South African
     * variant and a European one, they cannot say which of the two a person
     * read — and that is the whole value of this table.
     */
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'consents'
          and column_name = 'document_country'`,
    );
    expect(rows).toHaveLength(1);
    await expect(
      db.query(
        `insert into public.consents
           (user_id, document_type, document_version, document_sha256, document_country)
         values ($1, 'terms_of_service', '1.0.0', $2, 'South Africa')`,
        [owner.userId, 'a'.repeat(64)],
      ),
    ).rejects.toThrow(/document_country/);
  });
});
