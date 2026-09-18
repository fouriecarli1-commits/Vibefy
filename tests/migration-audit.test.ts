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
    const named = [...audit.matchAll(/\('(\d{14}_[a-z0-9_]+)'/g)].map((match) => match[1]!);
    expect(named.sort()).toEqual(MIGRATIONS);
  });

  it('reads the catalogue and writes nothing', () => {
    // It is meant to be pasted into a production console by somebody who is
    // already having a bad afternoon.
    expect(audit).not.toMatch(/\b(insert|update|delete|drop|alter|create|truncate)\b/i);
    expect(audit.trim().startsWith('select')).toBe(true);
  });

  it('marks a missing migration in a way nobody skims past', () => {
    expect(audit).toContain('>>> MISSING');
  });

  it('names the marker it checked, so a wrong answer can be argued with', () => {
    // Every check is a visible predicate rather than an opaque call: somebody
    // who thinks the audit is wrong can read the line and see why.
    expect(audit).toMatch(/to_regclass|information_schema\.columns|pg_proc|pg_type|enum_range/);
  });
});
