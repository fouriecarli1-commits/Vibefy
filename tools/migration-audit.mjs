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
 */
import { readdirSync, readFileSync } from 'node:fs';

const dir = 'supabase/migrations';
const rows = [];

for (const file of readdirSync(dir).sort()) {
  if (!file.endsWith('.sql')) continue;
  const sql = readFileSync(`${dir}/${file}`, 'utf8');
  const name = file.replace(/\.sql$/, '');

  // The first durable object each migration creates, as a catalogue check.
  let check = null;
  let m;
  if ((m = /create table (?:if not exists )?public\.(\w+)/i.exec(sql))) {
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
  // Two migrations only add a value to an enum, which no create statement
  // catches. Named rather than skipped: a gap in this list is a migration
  // nobody is checking.
  if (!check) {
    const value = /alter type public\.alert_kind add value '(\w+)'/.exec(sql);
    if (value) {
      check = `'${value[1]}' = any(enum_range(null::public.alert_kind)::text[])`;
    }
  }
  if (!check) {
    console.error(`no marker found for ${name} — add one by hand`);
    continue;
  }
  rows.push(`    ('${name}', ${check})`);
}

const VALUES = `  values\n${rows.join(',\n')}`;

console.log(`-- 1. Where this database is, one line per migration.
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
select coalesce(string_agg(migration, ', ' order by migration), 'nothing missing') as missing
  from state as t(migration, present)
 where not present;`);
