/**
 * What the public verification page may say about the person who owns the app.
 *
 * The page is unauthenticated, indexed while the badge is live, and carries an
 * OpenGraph card, so anything on it travels into any chat it is pasted into.
 * It was printing `organisations.name` twice — once as "Owned by X" under the
 * heading and once in the heading of the owner's own section — and handing the
 * same column to `anon` through two views.
 *
 * That column is what somebody typed into a sign-up form. `organisations`
 * defaults `account_type` to 'individual' and carries `is_personal`, which is
 * the schema stating that for a solo builder it holds a natural person's name.
 * An account name collected to run an account is not an account name collected
 * to publish; the difference between those two is consent, and we never asked.
 *
 * The rule these tests hold, which is broader than the two places that broke
 * it: nothing an organisation typed in order to open an account is readable by
 * `anon`. What a customer chose to publish — a trust page they wrote, a builder
 * profile they switched on — is published, and that is a different column with
 * a different history.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connect } from './setup/client.ts';

let db: Client;

beforeAll(async () => {
  db = await connect();
});

afterAll(async () => {
  await db?.end();
});

const page = readFileSync(join(process.cwd(), 'apps/web/app/a/[slug]/page.tsx'), 'utf8');

describe('the catalogue', () => {
  it('lets no view readable by anon depend on the organisation name', async () => {
    /*
     * Asked of `pg_depend` rather than by reading `pg_get_viewdef` for the
     * string "o.name".
     *
     * A view could alias the column, select it through another view, or reach
     * it under a different correlation name, and a text search would miss all
     * three. Postgres records a view's column-level dependencies exactly, so
     * this asks the question it actually means: does anything `anon` can read
     * read that column?
     */
    const { rows } = await db.query<{ view_name: string }>(
      `select distinct v.relname as view_name
         from pg_depend d
         join pg_rewrite r on r.oid = d.objid
         join pg_class v on v.oid = r.ev_class
         join pg_class t on t.oid = d.refobjid
         join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
         join pg_namespace n on n.oid = t.relnamespace
        where d.classid = 'pg_rewrite'::regclass
          and d.refclassid = 'pg_class'::regclass
          and n.nspname = 'public'
          and t.relname = 'organisations'
          and a.attname = 'name'
          and v.relkind = 'v'
          and has_table_privilege('anon', v.oid, 'select')
        order by 1`,
    );
    expect(rows.map((row) => row.view_name)).toEqual([]);
  });

  it('still carries the marketing disclosure, which is about us and not about them', async () => {
    // The guard above must not be satisfied by closing the views altogether.
    // The paid-relationship disclosure is required on every surface a rating
    // appears on, and it is a fact about our relationship rather than a name
    // for anybody, so it stays exactly where it was.
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'badge_verification'
        order by 1`,
    );
    const columns = rows.map((row) => row.column_name);
    expect(columns).toContain('owner_is_marketing_client');
    expect(columns).toContain('certified_origin');
    expect(columns).not.toContain('owner_name');
  });

  it('keeps the owner’s own words, which they wrote and published on purpose', async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'trust_page_public'
        order by 1`,
    );
    const columns = rows.map((row) => row.column_name);
    expect(columns).toContain('contact_email');
    expect(columns).toContain('security_contact');
    expect(columns).not.toContain('owner_name');
  });
});

describe('the page', () => {
  it('names the application by its certified origin, not by its owner', () => {
    expect(page).not.toMatch(/owner_name/);
    expect(page).toContain('{badge.certified_origin}</p>');
  });

  it('still says whose words the owner’s section holds', () => {
    // Removing the name must not remove the attribution. A reader who cannot
    // tell our findings from the owner's own claims has been misled by the
    // layout, which is the reason that section is walled off at all.
    expect(page).toContain('What the owner of this application says');
    expect(page).toContain('Not checked by us');
    expect(page).toMatch(/Written by the application’s owner, not by VibefyCode/);
  });
});
