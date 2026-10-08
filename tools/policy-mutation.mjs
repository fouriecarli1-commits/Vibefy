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
 * Four classes, because the failures are different:
 *
 *     node tools/policy-mutation.mjs reads    > supabase/migrations/29999999999999_mutate.sql
 *     node tools/policy-mutation.mjs writes   > supabase/migrations/29999999999999_mutate.sql
 *     node tools/policy-mutation.mjs triggers > supabase/migrations/29999999999999_mutate.sql
 *     node tools/policy-mutation.mjs definers  > supabase/migrations/29999999999999_mutate.sql
 *     node tools/policy-mutation.mjs recorders > supabase/migrations/29999999999999_mutate.sql
 *     node tools/policy-mutation.mjs checks    > supabase/migrations/29999999999999_mutate.sql
 *     node tools/policy-mutation.mjs uniques   > supabase/migrations/29999999999999_mutate.sql
 *     node tools/policy-mutation.mjs restrictives > supabase/migrations/29999999999999_mutate.sql
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
  checks: {
    /*
     * Every `check` constraint on a table in `public`.
     *
     * The other classes measure things that run: a policy is consulted, a
     * trigger fires, a definer function is called. A check constraint is the
     * layer with no code in it — it makes a state impossible by refusing the
     * row, and a later migration can drop one in a line with nothing anywhere
     * saying so.
     *
     * The schema leans on them for real rules, not only shapes: a revoked badge
     * must carry a reason of at least ten characters, an expiry must be bounded
     * at twelve months, a public id must match the pattern the badge URL is
     * built from, and the four-part ceiling constraint that decision 734 found
     * was being tested one flag at a time.
     *
     * Not-null constraints are left alone. They are a different question and
     * dropping them all at once produces failures about shape rather than about
     * rules, which drowns what this is looking for.
     */
    sql: `select c.relname as tablename, con.conname as policyname
           from pg_constraint con
           join pg_class c on c.oid = con.conrelid
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and con.contype = 'c'
          order by c.relname, con.conname`,
    alter: (row) =>
      `alter table public.${row.tablename} drop constraint if exists ${row.policyname};`,
  },
  uniques: {
    /*
     * The uniqueness rules, which are the other half of the layer with no code.
     *
     * `checks` refuses a row whose own columns are wrong. A unique index refuses
     * a row because of a row that is already there, which is how this schema
     * says "only one of these may be live": one active badge per application,
     * one live authorisation superseding another, one live invitation per email
     * address, one default policy profile, one live spend pause — the worker's
     * own comment leans on that one in as many words, "the partial unique index
     * means two workers crossing the line at once produce one pause, not two".
     *
     * And the idempotency ones, which are the same rule pointed at somebody
     * else's retries: a provider event id, an invoice, a subscription, an alert
     * dedupe key. Dropping one of those does not corrupt a row; it lets a
     * replayed webhook be applied twice.
     *
     * Primary keys are left alone. They are the shape of a table rather than a
     * rule about it, and dropping them fails everything at once, which drowns
     * what this is looking for — the same reason `checks` leaves not-null
     * constraints out.
     *
     * A unique index may be backed by a constraint or stand on its own, so the
     * mutation has to try both and swallow the one that does not apply.
     */
    sql: `select c.relname as tablename, i.relname as policyname,
                 exists (
                   select 1 from pg_constraint con
                    where con.conindid = idx.indexrelid
                 ) as from_constraint
            from pg_index idx
            join pg_class i on i.oid = idx.indexrelid
            join pg_class c on c.oid = idx.indrelid
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and idx.indisunique
             and not idx.indisprimary
           order by c.relname, i.relname`,
    alter: (row) =>
      row.from_constraint
        ? `alter table public.${row.tablename} drop constraint if exists ${row.policyname};`
        : `drop index if exists public.${row.policyname};`,
  },
  /**
   * Every restrictive policy, opened.
   *
   * A restrictive policy is the shape this schema reaches for when a rule must
   * hold whatever else is permitted — the second step in front of issuing a
   * badge, inviting somebody, or recording a review, and the rule that only an
   * owner creates an owner. It is also the shape whose loss is hardest to see
   * by reading: a restrictive policy that stops restricting leaves every
   * permissive policy in place, so every statement that used to work still
   * works and the one that should not now does too.
   *
   * All of them carry a `with check` and no `using`, so opening the check is
   * the whole mutation. Postgres will not let a policy change between
   * permissive and restrictive, which is the other reason to do it this way.
   */
  restrictives: {
    sql: `select tablename, policyname from pg_policies
           where schemaname = 'public' and permissive = 'RESTRICTIVE'
             and with_check is not null
           order by tablename, policyname`,
    alter: (row) => `alter policy ${row.policyname} on public.${row.tablename} with check (true);`,
  },

  recorders: {
    /*
     * The triggers that write rather than refuse.
     *
     * `triggers` selects on `raise exception`, which is the right definition
     * for the rules that make illegal states impossible — and it means a
     * trigger whose whole job is to *record* something was in no class at all.
     * The two that set a statutory deadline, the one that writes a badge's
     * lifecycle to an append-only log, the one that records a refusal at
     * intake: each is a promise the product publishes, and none of them raises.
     *
     * Expect `set_updated_at` to make up most of the list and most of the
     * silence. That is not a hole worth closing; the four substantive ones are
     * what this is for, and they are easy to pick out by name.
     */
    sql: `select c.relname as tablename, t.tgname as policyname
           from pg_trigger t
           join pg_class c on c.oid = t.tgrelid
           join pg_namespace n on n.oid = c.relnamespace
           join pg_proc p on p.oid = t.tgfoid
          where n.nspname = 'public' and not t.tgisinternal
            and pg_get_functiondef(p.oid) not ilike '%raise exception%'
          order by c.relname, t.tgname`,
    alter: (row) => `alter table public.${row.tablename} disable trigger ${row.policyname};`,
  },
  definers: {
    /*
     * The authority check inside a `security definer` function.
     *
     * These run as the function's owner, which bypasses row-level security
     * altogether — that is what they are for. So every policy measured by the
     * three classes above is irrelevant inside one, and the guard at the top is
     * the whole of the access control:
     *
     *     if not public.is_reviewer() then
     *       raise exception 'Only a VibefyCode reviewer may ...';
     *     end if;
     *
     * The mutation turns each such condition into `if false then`, which leaves
     * the function doing exactly its job for a caller who should never have been
     * able to ask. Everything else in the body is left alone, so a failure names
     * the guard rather than the function.
     */
    sql: `select p.oid, p.proname, pg_get_functiondef(p.oid) as definition
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prosecdef
            and pg_get_functiondef(p.oid) ilike '%raise exception%'
            and (pg_get_functiondef(p.oid) ilike '%is_reviewer%'
                 or pg_get_functiondef(p.oid) ilike '%is_platform_admin%'
                 or pg_get_functiondef(p.oid) ilike '%is_org_admin%'
                 or pg_get_functiondef(p.oid) ilike '%is_org_member%'
                 or pg_get_functiondef(p.oid) ilike '%auth.uid()%')
          order by p.proname`,
    /*
     * Rewrites the whole definition rather than patching it in place, because
     * there is no `alter function ... set body` and a half-applied edit to a
     * definer function is the worst thing this tool could leave behind.
     *
     * A guard is opened when either half of this schema's two spellings
     * applies, and the first version of this class knew only one of them:
     *
     *   · the condition names an authority — `if not public.is_reviewer()`;
     *   · or the `raise` inside it carries `insufficient_privilege`, which is
     *     the errcode this schema uses for "you may not".
     *
     * The second was added after the first run reported "4 found" and mutated
     * two. `accept_invitation` guards itself with `if caller is null` and with
     * an address comparison, which is the function's whole point — a forwarded
     * link must not work for whoever received it — and neither is an `if not`.
     * A class that skips the guard it cannot phrase, and prints a clean result,
     * is the defect this tool exists to find, committed by the tool.
     *
     * Everything else in the body is left exactly as it was, so a failure names
     * the guard rather than the function. A check that is not about who is
     * calling — `if previous is null then raise ... no_data_found` — is not
     * touched.
     */
    alter: (row) => {
      let opened = 0;
      const neutralised = row.definition.replace(
        // A line comment between `then` and the `raise` is ordinary in this
        // schema — several guards explain themselves there, and the email
        // comparison in `accept_invitation` is one — so it is skipped rather
        // than treated as a different shape.
        /\bif\s+(.+?)\s+then\s*((?:--[^\n]*\n\s*)*raise\s+exception[\s\S]*?;)\s*end\s+if\s*;/gi,
        (whole, condition, raised) => {
          const aboutTheCaller =
            /is_reviewer|is_platform_admin|is_org_admin|is_org_member|auth\.uid\(\)|\bcaller\b/i.test(
              condition,
            ) || /insufficient_privilege/i.test(raised);
          if (!aboutTheCaller) return whole;
          opened += 1;
          return `if false then ${raised} end if;`;
        },
      );
      if (opened === 0) {
        return `-- UNMUTATED ${row.proname}: no guard this class knows how to open. Read it by hand.`;
      }
      return `-- ${row.proname}: ${opened} guard(s) opened.\n${neutralised};`;
    },
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
  definers: 'security definer functions found; their authority checks opened',
  recorders: 'recording triggers disabled',
  checks: 'check constraints dropped',
  uniques: 'uniqueness rules dropped',
  restrictives: 'restrictive policies opened',
};
// A class added without a label printed "26 undefined.", which is a header
// somebody would paste into a decision entry.
if (!LABEL[which]) {
  console.error(`No label for class "${which}". Add one to LABEL in this file.`);
  process.exit(1);
}
console.log(`-- ${rows.length} ${LABEL[which]}.`);
const statements = rows.map((row) => chosen.alter(row));
for (const statement of statements) console.log(statement);

/*
 * An unmutated row is not a clean result.
 *
 * The first `definers` run printed "4 security definer functions found" and
 * silently left two of them alone, which reads as "four were measured". Said
 * at the end as well as inline, because the inline note scrolls away under a
 * function definition and the count at the top is the line people quote.
 */
const skipped = statements.filter((statement) => statement.startsWith('-- UNMUTATED'));
if (skipped.length > 0) {
  console.log(
    `-- ${skipped.length} of ${rows.length} were NOT mutated and are NOT measured by this run:`,
  );
  for (const statement of skipped) console.log(`--   ${statement.replace('-- UNMUTATED ', '')}`);
}
