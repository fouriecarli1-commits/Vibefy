#!/usr/bin/env node
/**
 * Rewriting SQL into a form that is safe to run twice.
 *
 * Migrations here are pasted into a SQL console by hand. A paste that stops
 * halfway leaves the database in a state no migration expects, and re-running
 * the same file then fails on `type ... already exists` or `policy ... already
 * exists` — which says nothing about what is actually missing and leaves
 * somebody with no way forward except running the file a statement at a time.
 *
 * Two things need this and they used to be one: `idempotent-catch-up.mjs`,
 * which produces a repair file, and `docs/sql/OUTSTANDING.sql`, the document
 * Anré actually pastes. The document's own header promised "loop dit 'n tweede
 * keer en niks gebeur" and carried the migrations unguarded, so the promise was
 * false — found on 2026-10-23 when a paste stopped on `policy
 * "reviews_need_second_step" for table "reviews" already exists`, which is the
 * first block of twenty-one. Nothing had ever run the document twice; the test
 * beside it compared the document to the migrations and would have failed had
 * the guards been there.
 *
 * So the transformation lives here, one copy, used by the tool that writes the
 * repair file and by the one that writes the document.
 *
 * The files in `supabase/migrations` stay written for a database that does not
 * have them yet, which is the only assumption that makes them readable: a
 * migration that guards every statement is a migration nobody can see the shape
 * of.
 */

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
      // `on` is often on the next line, and was for the first policy written
      // that way — which the output then failed to guard on its second run.
      /create policy\s+(\w+)\s+on\s+(public\.\w+)/gi,
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
  // A policy that is dropped and not replaced. `replaceTriggersAndPolicies`
  // guards the drop it writes itself, but the first migration to remove a
  // policy outright — the one that stopped a customer writing their own score —
  // failed on its second run with `policy ... does not exist`, which reads like
  // a broken database rather than a step already taken.
  out = out.replace(/drop policy (?!if exists)/gi, 'drop policy if exists ');
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

export { idempotent };
