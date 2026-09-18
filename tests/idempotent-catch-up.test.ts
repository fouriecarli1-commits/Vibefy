/**
 * A repair script that can be run twice.
 *
 * Migrations here are pasted into a SQL console by hand, and a paste that fails
 * halfway leaves the database in a state no migration expects: the first type
 * created, the table after it not. Re-running the same file then fails with
 *
 *     ERROR: 42710: type "engagement_status" already exists
 *
 * which says nothing about what is actually missing and leaves somebody with no
 * way forward but to read the migration and run it a statement at a time.
 *
 * `tools/idempotent-catch-up.mjs` rewrites a range of migrations into a form
 * that can simply be run again. Two things have to be true of the result, and
 * neither is worth believing without checking: running it twice must not fail,
 * and what it builds must be exactly what the real migrations build. A repair
 * script that is safe to re-run and produces a *different* schema is worse than
 * the error it replaces.
 *
 * Both bugs this file caught were found by running the output rather than by
 * reading it — an older view definition replayed over a newer one, and an index
 * rename that had already happened.
 */
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { connect } from './setup/client.ts';

const FROM = '20260826120000';
const PROBE = 'catchup_idempotence_probe';

let main: Client;
let probe: Client;

/**
 * The shape of a schema, from the catalogue.
 *
 * Compared instead of a `pg_dump`, which needs the binary on the path and
 * prints a different random token on every run.
 */
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
  return {
    host: url.searchParams.get('host')!,
    database,
    user: 'postgres',
  };
};

beforeAll(async () => {
  main = await connect();

  // A database carrying only what came before the catch-up range, which is the
  // situation the tool exists for.
  const admin = new Client(dsnFor('postgres'));
  await admin.connect();
  await admin.query(`drop database if exists ${PROBE}`);
  await admin.query(`create database ${PROBE}`);
  await admin.end();

  probe = new Client(dsnFor(PROBE));
  await probe.connect();

  const { readFileSync, readdirSync } = await import('node:fs');
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

describe('the catch-up script', () => {
  const sql = execFileSync('node', ['tools/idempotent-catch-up.mjs', FROM], { encoding: 'utf8' });

  it('applies to a database that is behind', async () => {
    await expect(probe.query(sql)).resolves.toBeDefined();
  }, 120_000);

  it('applies again on top of itself, which is the whole point', async () => {
    // The state a half-finished paste leaves behind, and the error somebody
    // actually hits: `type "engagement_status" already exists`.
    await expect(probe.query(sql)).resolves.toBeDefined();
  }, 120_000);

  it('builds exactly what the real migrations build', async () => {
    // A repair script that is safe to re-run and produces a different schema is
    // worse than the error it replaces.
    expect(await fingerprint(probe)).toBe(await fingerprint(main));
  }, 120_000);

  it('survives a third run, because twice could be luck', async () => {
    await expect(probe.query(sql)).resolves.toBeDefined();
    expect(await fingerprint(probe)).toBe(await fingerprint(main));
  }, 120_000);
});

describe('what the rewriting does and does not touch', () => {
  const sql = execFileSync('node', ['tools/idempotent-catch-up.mjs', FROM], { encoding: 'utf8' });

  /**
   * The script with the guarded blocks taken out.
   *
   * The first version of these tests asserted that no `create type` or `alter
   * index ... rename` appeared anywhere, and failed — because the guarded form
   * contains exactly those statements, indented, inside the guard. The claim
   * worth making is that none is left *unguarded*, which is what this asks.
   */
  const unguarded = sql.replace(/do \$guard\$[\s\S]*?end \$guard\$;/g, '');

  it('guards every enum type, which has no `if not exists` of its own', () => {
    expect(unguarded).not.toMatch(/create type public\.\w+ as enum/);
    expect(sql).toContain('from pg_type t join pg_namespace n');
  });

  it('drops a view before recreating it, because an older definition has fewer columns', () => {
    // Found by running it twice: `create or replace view` refuses to drop a
    // column, so replaying an earlier definition over a later one fails.
    expect(sql).toMatch(/drop view if exists public\.badge_verification;/);
  });

  it('guards the renames, which cannot be repeated', () => {
    expect(unguarded).not.toMatch(/alter index \w+\s+rename to/);
    expect(unguarded).not.toMatch(/alter table public\.\w+\s+rename column/);
  });

  it('leaves the migrations themselves alone', async () => {
    // The files stay written for a database that does not have them yet, which
    // is the only assumption that makes them readable. A migration that guards
    // every statement is a migration nobody can see the shape of.
    const { readFileSync } = await import('node:fs');
    const original = readFileSync(
      'supabase/migrations/20260826160000_remediation_engagements.sql',
      'utf8',
    );
    expect(original).toMatch(/^create type public\.engagement_status as enum/m);
  });
});
