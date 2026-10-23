/**
 * The document promised a second run does nothing, and nothing had ever run it
 * twice.
 *
 * `docs/sql/OUTSTANDING.sql` is the only file in this repository somebody runs
 * against the production database by hand. Its header has said since it was
 * written that each block "is so geskryf dat dit homself nie twee keer doen
 * nie" — run it again and nothing happens — and the blocks were the migrations
 * word for word. A migration here is deliberately written for a database that
 * does not have it yet: `create type`, `create policy`, `create trigger`, none
 * of which can be repeated.
 *
 * So the promise was false, and on 2026-10-23 the founder's paste stopped on:
 *
 *     ERROR: 42710: policy "reviews_need_second_step" for table "reviews"
 *     already exists
 *
 * — block 1 of 21, against a database that already had it. A paste is one
 * implicit transaction, so that single statement rolled back the whole
 * document: twenty-one migrations' worth of work undone by a statement that
 * could not say "already done".
 *
 * The test beside this one compared the document with the migrations statement
 * for statement, which is what kept them honest — and is also why nobody could
 * have added the guards without this file existing first. It compares against
 * the guarded form now.
 *
 * What is held here is the sentence in the header, run rather than asserted:
 * the document applies to a database that is behind, applies again on top of
 * itself, and what it builds is what the real migrations build.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { connect } from './setup/client.ts';

/** The first of the twenty-one blocks the document carries. */
const FROM = '20260923110000';
const PROBE = 'outstanding_paste_probe';
const DOCUMENT = readFileSync('docs/sql/OUTSTANDING.sql', 'utf8');

let main: Client;
let probe: Client;

/** The same catalogue fingerprint `idempotent-catch-up.test.ts` compares on. */
async function fingerprint(client: Client): Promise<string> {
  const { rows } = await client.query<{ line: string }>(`
    select line from (
      select 'column ' || table_name || '.' || column_name || ' ' || data_type ||
             coalesce(' default ' || column_default, '') as line
        from information_schema.columns where table_schema = 'public'
      union all
      select 'type ' || t.typname || ' ' ||
             coalesce((select string_agg(e.enumlabel, ',' order by e.enumsortorder)
                         from pg_enum e where e.enumtypid = t.oid), '')
        from pg_type t join pg_namespace n on n.oid = t.typnamespace
       where n.nspname = 'public' and t.typtype = 'e'
      union all
      select 'index ' || indexname || ' ' || indexdef
        from pg_indexes where schemaname = 'public'
      union all
      select 'view ' || viewname from pg_views where schemaname = 'public'
      union all
      select 'policy ' || tablename || '.' || policyname from pg_policies where schemaname = 'public'
      union all
      select 'routine ' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
    ) as everything
    order by line
  `);
  return rows.map((row) => row.line).join('\n');
}

const dsnFor = (database: string) => {
  const url = new URL(process.env.VIBEFYCODE_TEST_DSN!);
  return { host: url.searchParams.get('host')!, database, user: 'postgres' };
};

beforeAll(async () => {
  main = await connect();

  // A database carrying only what came before the twenty-one, which is the
  // state the document exists to catch up from.
  const admin = new Client(dsnFor('postgres'));
  await admin.connect();
  await admin.query(`drop database if exists ${PROBE}`);
  await admin.query(`create database ${PROBE}`);
  await admin.end();

  probe = new Client(dsnFor(PROBE));
  await probe.connect();
  await probe.query(readFileSync('supabase/shim/local-postgres-shim.sql', 'utf8'));
  for (const file of readdirSync('supabase/migrations').sort()) {
    if (!file.endsWith('.sql') || file.replace(/\.sql$/, '') >= FROM) continue;
    await probe.query(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  }
}, 180_000);

afterAll(async () => {
  await probe?.end();
  await main?.end();
});

describe('the document he pastes', () => {
  it('applies to a database that is behind', async () => {
    // Sent as one string, which is how a SQL window sends it: one implicit
    // transaction, all of it or none.
    await expect(probe.query(DOCUMENT)).resolves.toBeDefined();
  }, 120_000);

  it('applies again on top of itself, which is what its header promises', async () => {
    await expect(probe.query(DOCUMENT)).resolves.toBeDefined();
  }, 120_000);

  it('builds exactly what the real migrations build', async () => {
    // A document that is safe to re-run and produces a different schema from
    // the one the tests ran against is worse than the error it replaces.
    expect(await fingerprint(probe)).toBe(await fingerprint(main));
  }, 120_000);

  it('survives a third run, because twice could be luck', async () => {
    await expect(probe.query(DOCUMENT)).resolves.toBeDefined();
    expect(await fingerprint(probe)).toBe(await fingerprint(main));
  }, 120_000);

  it('applies to a database that already has everything, which is where it failed', async () => {
    /*
     * The founder's actual situation on 2026-10-23: the policy in block 1 was
     * already there. This is the case the old document could not survive, and
     * the only one that was never tried.
     */
    const already = await connect();
    try {
      await expect(already.query(DOCUMENT)).resolves.toBeDefined();
      await expect(already.query(DOCUMENT)).resolves.toBeDefined();
      expect(await fingerprint(already)).toBe(await fingerprint(main));
    } finally {
      await already.end();
    }
  }, 180_000);
});
