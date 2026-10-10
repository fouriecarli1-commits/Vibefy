#!/usr/bin/env node
/**
 * Which migrations a database already has.
 *
 * Written the day a migration failed on Supabase with
 *
 *     function public.app_has_remediation(uuid) does not exist
 *
 * which is not a fault in that migration at all: it is what a database three
 * migrations behind says when you run the fourth. There was no way to see that
 * from the outside, because this project applies migrations by hand in a SQL
 * editor and nothing records which have been run.
 *
 * So this generates a read-only query that asks the catalogue for one durable
 * object per migration — a table, a type, a function, a column, a view, an enum
 * value — and prints a line per migration saying whether it is there. It writes
 * nothing and locks nothing; it is safe to paste into a production console.
 *
 * It is a diagnostic, not a ledger. A migration whose marker exists could still
 * have been applied partly, and one whose marker was later dropped reads as
 * missing. It answers "where am I roughly", which is the question somebody
 * actually has when a paste fails.
 *
 *     node tools/migration-audit.mjs > audit.sql
 *
 * Generated fresh each time, and the output says when and for how many
 * migrations, because a stale `audit.sql` names migrations as missing that
 * have been there for hours. A migration it cannot derive a marker for is
 * refused rather than dropped: a partial audit is the same sentence with a
 * different meaning.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = 'supabase/migrations';
const rows = [];
const unmarked = [];

/**
 * The catalogue check for one migration, in the order the guesses are tried.
 *
 * Exported because `tests/a-marker-that-was-already-true.test.ts` builds the
 * database one migration at a time and asks each marker whether it is already
 * satisfied before its own migration runs. A test that mirrored this chain in
 * its own regexes covered three of the eight shapes and drifted from the other
 * five in silence — among them the two shapes whose markers were found to be
 * true before their own migrations on 2026-10-10.
 *
 * Returns null when nothing here matches, which is the case the CLI refuses on.
 */
export function markerFor(sql) {
  // The first durable object each migration creates, as a catalogue check.
  let check = null;
  let m;

  // A migration may name its own marker, and one that changes data rather than
  // creating anything has to. Every shape below is a guess at what a migration
  // left behind; this is the migration saying so itself, which is both more
  // reliable and the only option when what it left behind is a column value.
  //
  //   -- audit-marker: exists (select 1 from public.t where ...)
  //
  // Checked first, so a migration can always overrule a guess that is wrong
  // about it — five of the patterns below were added one at a time, each after
  // a migration shape nobody had written before, and this is how that stops.
  if ((m = /^\s*--\s*audit-marker:\s*(.+?)\s*$/im.exec(sql))) {
    check = m[1];
  } else if ((m = /create table (?:if not exists )?public\.(\w+)/i.exec(sql))) {
    check = `to_regclass('public.${m[1]}') is not null`;
  } else if ((m = /create type public\.(\w+)/i.exec(sql))) {
    check = `exists (select 1 from pg_type where typname='${m[1]}')`;
  } else if ((m = /create (?:or replace )?function public\.(\w+)/i.exec(sql))) {
    check = `exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='${m[1]}')`;
  } else if (
    (m =
      /alter table public\.(\w+)\s+(?:rename column \w+ to (\w+)|add column (?:if not exists )?(\w+))/i.exec(
        sql,
      ))
  ) {
    const col = m[2] ?? m[3];
    check = `exists (select 1 from information_schema.columns where table_schema='public' and table_name='${m[1]}' and column_name='${col}')`;
  } else if ((m = /create (?:or replace )?view public\.(\w+)/i.exec(sql))) {
    check = `to_regclass('public.${m[1]}') is not null`;
  } else if (/insert into public\.rubric_versions/i.test(sql)) {
    const v = /values \(\s*'([\d.]+)'/.exec(sql);
    check = `exists (select 1 from public.rubric_versions where version='${v?.[1]}')`;
  }
  // Some migrations only add a value to an enum, which no create statement
  // catches. Named rather than skipped: a gap in this list is a migration
  // nobody is checking. Written against any enum rather than the one that
  // happened to need it first — the next one will be a different type, and a
  // marker that only knows `alert_kind` would quietly stop covering it.
  // A migration whose first durable object is a policy or a grant. Both are
  // real objects the catalogue can be asked about, and a migration that only
  // fixes permissions is exactly the kind nobody thinks to check for.
  if (!check) {
    const policy = /create policy\s+(\w+)\s+on\s+public\.(\w+)/i.exec(sql);
    if (policy) {
      check = `exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid where p.polname='${policy[1]}' and c.relname='${policy[2]}')`;
    }
  }
  if (!check) {
    const value = /alter type public\.(\w+) add value (?:if not exists )?'(\w+)'/i.exec(sql);
    if (value) {
      check = `'${value[2]}' = any(enum_range(null::public.${value[1]})::text[])`;
    }
  }
  return check ?? null;
}

/*
 * Guarded, so the file can be imported for `markerFor` without running.
 * Importing it printed the whole audit to stdout the first time a test asked
 * for the function, and would have called `process.exit(1)` from inside the
 * test process if a marker had been missing. The same guard stub-check was
 * missing, found the same way.
 */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.sql')) continue;
    const sql = readFileSync(`${dir}/${file}`, 'utf8');
    const name = file.replace(/\.sql$/, '');

    const check = markerFor(sql);
    if (!check) {
      unmarked.push(name);
      continue;
    }
    rows.push(`    ('${name}', ${check})`);
  }

  /*
   * A migration with no marker used to be warned about and dropped.
   *
   * The warning went to stderr, the exit code stayed 0, and the documented
   * invocation is `node tools/migration-audit.mjs > audit.sql` — so the message
   * landed on a screen nobody was reading and the file reported `nothing
   * missing` about a set that never contained that migration. The one defect
   * this tool exists to prevent, reproduced in the tool.
   *
   * So it refuses. A partial audit is worse than no audit: it is the same
   * sentence with a different meaning.
   */
  if (unmarked.length > 0) {
    console.error(`\n✗ No marker for ${unmarked.length} migration(s). Nothing was written.\n`);
    for (const name of unmarked) console.error(`  ${name}`);
    console.error(
      '\n  Add one by hand as a comment in the migration:\n' +
        '  -- audit-marker: exists (select 1 from public.some_table where ...)\n',
    );
    process.exit(1);
  }

  const VALUES = `  values\n${rows.join(',\n')}`;

  /*
   * When, and how many.
   *
   * A stale `audit.sql` — generated before two markers were corrected and
   * re-used an hour later out of habit — named two migrations as missing from a
   * database that had them. Nothing on the file said how old it was or what it
   * covered, so there was no way to see that from the answer.
   */
  console.log(`-- ============================================================================
-- Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by
-- tools/migration-audit.mjs, and it covers ${rows.length} migration(s).
--
-- Regenerate it before using it. It is only as current as the moment it was
-- written: a migration added since, or a marker corrected since, is not in it.
-- ============================================================================

-- 1. Where this database is, one line per migration.
with state as (
${VALUES}
)
select migration, case when present then 'ok' else '>>> MISSING' end as state
  from state as t(migration, present)
 order by migration;

-- 2. The same answer as one line you can copy back, because reading thirty
--    rows off a screen and retyping the gaps is how a migration gets missed.
with state as (
${VALUES}
)
select coalesce(string_agg(migration, ', ' order by migration) filter (where not present),
                'nothing missing') as missing,
       count(*) as checked
  from state as t(migration, present);`);
}
