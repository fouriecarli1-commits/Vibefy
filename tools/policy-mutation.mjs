#!/usr/bin/env node
/**
 * Which of this schema's rules would nothing notice the loss of?
 *
 * A policy or a trigger with no test can be deleted, weakened by a later
 * migration, or quietly shadowed, and nothing anywhere will say so. Reading the
 * suite does not answer it: a test can mention a table, exercise it as the
 * database owner — which bypasses policies entirely — and look like coverage.
 *
 * So this asks the question the only way it can be answered. It prints a
 * migration that opens a whole class of policies at once:
 *
 *     alter policy <name> on public.<table> using (true);
 *
 * Put that in `supabase/migrations/` with a timestamp that sorts last, run the
 * suite, and read the failures. Every policy in the class whose loss nothing
 * notices is a hole in the tests, not in the schema. Then delete the file.
 *
 * Three classes, because the failures are different:
 *
 *     node tools/policy-mutation.mjs reads    > supabase/migrations/29999999999999_mutate.sql
 *     node tools/policy-mutation.mjs writes   > supabase/migrations/29999999999999_mutate.sql
 *     node tools/policy-mutation.mjs triggers > supabase/migrations/29999999999999_mutate.sql
 *
 * `reads` opens every policy that scopes a select to a membership or to a
 * person: a hole there means one customer reading another's findings. `writes`
 * removes every `auth.uid()` comparison from a `with check`: a hole there means
 * a row recorded in somebody else's name — an authorisation to test an
 * application granted by a person who did not grant it. `triggers` disables
 * every trigger whose function can raise, which is where this schema makes
 * illegal states impossible.
 *
 * Measured on 2026-09-23: of forty-four read-scoping policies, sixteen had no
 * test; of twenty-six assertion triggers, none did. The layer that looked most
 * carefully built was the one that was, and the layer nobody had thought to
 * measure was not. That is the argument for running this rather than reasoning
 * about it.
 *
 * Expect `deployment.test.ts` to fail on the schema-file comparison. That is the
 * gate noticing the migrations changed, which is its job, and it is the one
 * failure to ignore.
 *
 * This writes nothing to the database and touches no file. It prints SQL.
 */
import { Client } from 'pg';

const CLASSES = {
  reads: {
    sql: `select tablename, policyname from pg_policies
           where schemaname = 'public' and permissive = 'PERMISSIVE'
             and cmd in ('SELECT', 'ALL') and 'authenticated' = any(roles)
             and (qual like '%is_org_member%' or qual like '%auth.uid()%'
                  or qual like '%has_org_role%')
           order by tablename, policyname`,
    alter: (row) => `alter policy ${row.policyname} on public.${row.tablename} using (true);`,
  },
  writes: {
    sql: `select tablename, policyname, qual, with_check from pg_policies
           where schemaname = 'public' and permissive = 'PERMISSIVE'
             and with_check like '%auth.uid()%'
           order by tablename, policyname`,
    /*
     * Only the `auth.uid()` comparison goes. Leaving the rest of the clause in
     * place is the point: the question is whether *this* condition is tested,
     * not whether the policy exists at all.
     *
     * An UPDATE policy's `using` clause is opened with its `with check`. Without
     * that, `using` still filters the rows the update can see, so the statement
     * matches nothing and a test asserting "nothing changed" passes with the
     * condition gone — which is how two of the twelve slipped through the first
     * time this ran.
     */
    alter: (row) => {
      const open = (clause) =>
        clause.replace(/\(?\w+(\.\w+)? = auth\.uid\(\)\)?/g, 'true').replace(/^\((.*)\)$/, '$1');
      const using = row.qual && row.qual.includes('auth.uid()') ? ` using (${open(row.qual)})` : '';
      return `alter policy ${row.policyname} on public.${row.tablename}${using} with check (${open(row.with_check)});`;
    },
  },
  triggers: {
    /*
     * Every trigger whose function can raise.
     *
     * This schema's house rule is that a rule lives in the database, so the
     * triggers are where illegal states are made impossible: a badge that
     * issues without a human review, an assessment approved against an expired
     * authorisation, an append-only table written over. A trigger nobody tests
     * is one a later migration can drop and nothing will say so.
     *
     * `disable trigger` rather than a rewritten function body: it is one
     * statement, it is exact, and it cannot leave a half-edited function behind
     * if the run is interrupted.
     */
    sql: `select c.relname as tablename, t.tgname as policyname
           from pg_trigger t
           join pg_class c on c.oid = t.tgrelid
           join pg_namespace n on n.oid = c.relnamespace
           join pg_proc p on p.oid = t.tgfoid
          where n.nspname = 'public' and not t.tgisinternal
            and pg_get_functiondef(p.oid) ilike '%raise exception%'
          order by c.relname, t.tgname`,
    alter: (row) => `alter table public.${row.tablename} disable trigger ${row.policyname};`,
  },
};

const which = process.argv[2] ?? 'reads';
const chosen = CLASSES[which];
if (!chosen) {
  console.error(`Unknown class "${which}". Expected one of: ${Object.keys(CLASSES).join(', ')}`);
  process.exit(1);
}

const dsn = process.env.VIBEFYCODE_TEST_DSN ?? process.env.SUPABASE_DB_URL;
if (!dsn) {
  console.error(
    'Set VIBEFYCODE_TEST_DSN (printed by scripts/test-db.sh) or SUPABASE_DB_URL first.\n' +
      'It is read to ask the catalogue which policies exist; nothing is written to it.',
  );
  process.exit(1);
}

const url = new URL(dsn);
const socket = url.searchParams.get('host');
const client = new Client(
  socket
    ? { host: socket, database: url.pathname.replace(/^\//, ''), user: 'postgres' }
    : { connectionString: dsn },
);
await client.connect();
const { rows } = await client.query(chosen.sql);
await client.end();

console.log(`-- TEMPORARY. Generated by tools/policy-mutation.mjs ${which}. Delete after reading.`);
const LABEL = {
  reads: 'read-scoping policies opened',
  writes: 'own-name with-check clauses opened',
  triggers: 'assertion triggers disabled',
};
console.log(`-- ${rows.length} ${LABEL[which]}.`);
for (const row of rows) console.log(chosen.alter(row));
