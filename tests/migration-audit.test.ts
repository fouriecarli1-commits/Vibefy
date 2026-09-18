/**
 * Knowing which migrations a database already has.
 *
 * Written the day a paste into the Supabase console failed with
 *
 *     function public.app_has_remediation(uuid) does not exist
 *
 * which is not a fault in the migration that was pasted. It is what a database
 * three migrations behind says when you run the fourth — and there was no way
 * to see that from outside, because this project applies migrations by hand and
 * nothing records which have been run.
 *
 * The audit is a generated, read-only query that asks the catalogue for one
 * durable object per migration. What these tests hold is the thing that would
 * make it useless: a migration it silently skips. A gap in the list is a
 * migration nobody is checking, and the whole point is to find gaps.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MIGRATIONS = readdirSync('supabase/migrations')
  .filter((file) => file.endsWith('.sql'))
  .map((file) => file.replace(/\.sql$/, ''))
  .sort();

const audit = execFileSync('node', ['tools/migration-audit.mjs'], { encoding: 'utf8' });

describe('the migration audit', () => {
  it('covers every migration, with none silently skipped', () => {
    // The failure mode that matters: a migration with no marker is dropped from
    // the query, and a database missing it reports itself as complete.
    // Deduplicated: the audit asks the same question twice, once as a table to
    // read and once as a line to copy back, so every name appears in both.
    const named = [
      ...new Set([...audit.matchAll(/\('(\d{14}_[a-z0-9_]+)'/g)].map((match) => match[1]!)),
    ];
    expect(named.sort()).toEqual(MIGRATIONS);
  });

  it('reads the catalogue and writes nothing', () => {
    // It is meant to be pasted into a production console by somebody who is
    // already having a bad afternoon.
    expect(audit).not.toMatch(/\b(insert|update|delete|drop|alter|create|truncate)\b/i);

    // Every statement, not just the first: the audit grew a second query and a
    // test that only looked at the opening word would not have noticed.
    const statements = audit
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);
    expect(statements.length).toBeGreaterThan(1);
    for (const statement of statements) {
      expect(statement.toLowerCase(), statement.slice(0, 40)).toMatch(/^(select|with)\b/);
    }
  });

  it('marks a missing migration in a way nobody skims past', () => {
    expect(audit).toContain('>>> MISSING');
  });

  it('names the marker it checked, so a wrong answer can be argued with', () => {
    // Every check is a visible predicate rather than an opaque call: somebody
    // who thinks the audit is wrong can read the line and see why.
    expect(audit).toMatch(/to_regclass|information_schema\.columns|pg_proc|pg_type|enum_range/);
  });

  it('hands back a line somebody can copy rather than thirty rows to read off a screen', () => {
    // Reading a long table off a console and retyping the gaps is how a
    // migration gets missed — which is the failure this whole tool exists for.
    expect(audit).toMatch(/string_agg\(migration/);
    expect(audit).toContain('nothing missing');
  });
});
