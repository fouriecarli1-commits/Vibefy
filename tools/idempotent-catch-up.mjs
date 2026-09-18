#!/usr/bin/env node
/**
 * A catch-up script that can be run twice.
 *
 * Migrations here are pasted into a SQL console by hand, and a paste that fails
 * halfway leaves the database in a state no migration expects: the first type
 * created, the table after it not. Re-running the same file then fails on
 * `type "engagement_status" already exists` — which says nothing about what is
 * actually missing and gives somebody no way forward except reading the
 * migration and running it a statement at a time.
 *
 * So this rewrites a range of migrations into a form that is safe to re-run.
 * Each object is created only if it is not already there; everything already
 * applied is skipped in silence. Run it on a database that is up to date and
 * nothing happens.
 *
 * It is a repair tool, not the migrations themselves. The files in
 * `supabase/migrations` stay written for a database that does not have them
 * yet, which is the only assumption that makes them readable — a migration
 * that guards every statement is a migration nobody can see the shape of.
 *
 * `tests/idempotent-catch-up.test.ts` proves the claim the hard way: it applies
 * the output to an empty database, applies it a second time on top of itself,
 * and compares the resulting schema to the one the real migrations produce.
 * Nothing here is trusted because it looks right.
 *
 *     node tools/idempotent-catch-up.mjs [fromMigration] > catch-up.sql
 */
import { readdirSync, readFileSync } from 'node:fs';

const from = process.argv[2] ?? '00000000000000';
const dir = 'supabase/migrations';

/** `create type X as enum (...)` has no `if not exists`, so it gets a guard. */
function guardTypes(sql) {
  return sql.replace(
    /create type public\.(\w+) as enum\s*\(([\s\S]*?)\);/gi,
    (_match, name, body) =>
      `do $guard$ begin\n  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = '${name}') then\n    create type public.${name} as enum (${body});\n  end if;\nend $guard$;`,
  );
}

/** A trigger and a policy are both cheaper to drop and recreate than to guard. */
function replaceTriggersAndPolicies(sql) {
  return sql
    .replace(
      /create trigger (\w+)([\s\S]*?)\son\s+(public\.\w+)/gi,
      (match, name, middle, table) =>
        `drop trigger if exists ${name} on ${table};\ncreate trigger ${name}${middle} on ${table}`,
    )
    .replace(
      /create policy (\w+) on (public\.\w+)/gi,
      (_match, name, table) =>
        `drop policy if exists ${name} on ${table};\ncreate policy ${name} on ${table}`,
    );
}

function idempotent(sql) {
  let out = sql;
  out = guardTypes(out);
  out = replaceTriggersAndPolicies(out);
  out = out.replace(/create table (?!if not exists)/gi, 'create table if not exists ');
  out = out.replace(/create (unique )?index (?!if not exists)/gi, 'create $1index if not exists ');
  /*
   * A view defined twice in the range cannot simply be replaced on a second
   * run: `create or replace view` refuses to drop a column, and replaying an
   * earlier definition over a later one does exactly that. Caught by running
   * the output twice rather than by reading it —
   *
   *     ERROR: cannot drop columns from view
   *
   * Dropped first, and deliberately without `cascade`: if something ever does
   * depend on one of these, the right outcome is a loud failure rather than a
   * silently destroyed dependent.
   */
  out = out.replace(
    /create (?:or replace )?view (public\.\w+)/gi,
    (_match, view) => `drop view if exists ${view};\ncreate view ${view}`,
  );
  out = out.replace(
    /alter table (public\.\w+)\s+add column (?!if not exists)/gi,
    'alter table $1 add column if not exists ',
  );
  out = out.replace(/drop constraint (?!if exists)/gi, 'drop constraint if exists ');
  // There is no `add constraint if not exists`, so a second run fails with
  // "constraint ... already exists" — found by running the output twice, like
  // everything else in this file. Guarded on the constraint name against the
  // table it belongs to, because two tables may each carry one of that name.
  out = out.replace(
    /alter table (public\.(\w+))\s+add constraint (\w+)([\s\S]*?);/gi,
    (_m, table, bare, name, body) =>
      `do $guard$ begin\n  if not exists (select 1 from pg_constraint where conname = '${name}' and conrelid = 'public.${bare}'::regclass) then\n    alter table ${table} add constraint ${name}${body};\n  end if;\nend $guard$;`,
  );
  // `alter table ... rename column a to b` fails once b exists. Guarded on the
  // old name still being there, which is the only way to ask "has this run".
  out = out.replace(
    /alter table (public\.(\w+))\s+rename column (\w+) to (\w+);/gi,
    (_m, table, bare, before, after) =>
      `do $guard$ begin\n  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = '${bare}' and column_name = '${before}') then\n    alter table ${table} rename column ${before} to ${after};\n  end if;\nend $guard$;`,
  );
  // `alter index a rename to b` fails once b exists, like the column rename.
  // Guarded on the old name still being there.
  out = out.replace(
    /alter index (\w+)\s+rename to (\w+);/gi,
    (_m, before, after) =>
      `do $guard$ begin\n  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = '${before}') then\n    alter index ${before} rename to ${after};\n  end if;\nend $guard$;`,
  );

  return out;
}

const files = readdirSync(dir)
  .filter((file) => file.endsWith('.sql') && file.replace(/\.sql$/, '') >= from)
  .sort();

const parts = [
  `-- ============================================================================
-- CATCH-UP, safe to run more than once.
--
-- Generated by tools/idempotent-catch-up.mjs. Every object is created only if
-- it is not already there, so a paste that failed halfway can simply be run
-- again, and a database that is already up to date is left alone.
--
-- Covers ${files.length} migration(s), from ${files[0]?.replace(/\\.sql$/, '')} onward, in order.
-- Run the whole thing in one go.
-- ============================================================================
`,
];

for (const file of files) {
  const sql = readFileSync(`${dir}/${file}`, 'utf8');
  parts.push(`\n-- ▼ ${file.replace(/\.sql$/, '')}\n`, idempotent(sql).trimEnd(), '\n');

  // A new enum value cannot be *used* in the transaction that added it —
  // Postgres refuses with "unsafe use of new value", naming the value and not
  // the reason. A pasted script runs as one transaction, so a migration that
  // adds a label and a later one that writes it would fail here for a reason
  // that has nothing to do with either of them being applied twice.
  //
  // Stopping the transaction at this point is harmless precisely because of
  // what this script is: everything above is safe to run again, so a run that
  // stops after the commit and a run that stops before it are the same run.
  if (/alter type public\.\w+ add value/i.test(sql)) {
    parts.push('-- A new enum value has to be committed before anything can use it.', 'commit;\n');
  }
}

console.log(parts.join('\n'));
