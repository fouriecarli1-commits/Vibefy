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
import { Pool } from 'pg';

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
    /*
     * This asked for the absence of the bare words `insert`, `update`, `delete`
     * and so on anywhere in the query, and that check caused a defect rather
     * than preventing one. Two markers need to say which privilege a migration
     * removed, and `UPDATE` inside `has_column_privilege(...)` writes nothing
     * whatever — so both were written instead as "the customer has no privilege
     * at all on this column", which is false and should be false: a customer
     * must be able to read their own screening status and their own appeal's
     * resolution. The audit then called a fully-migrated database incomplete.
     *
     * The statement-shape check below is the real guarantee and always was: a
     * query whose every statement begins with `select` or `with` cannot write,
     * whatever words appear inside it. Kept as a word check is the narrow set
     * that could do damage from inside a select — against the SQL with comments
     * stripped, because a first attempt at this forbade `copy` and matched "one
     * line you can copy back" in the audit's own explanation.
     */
    const sql = audit
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(sql).not.toMatch(/\b(drop|truncate|grant|revoke)\b/i);
    expect(sql).not.toMatch(
      /\binsert\s+into\b|\bdelete\s+from\b|\bcreate\s+(table|index|function|type|policy)\b/i,
    );
    expect(sql).not.toMatch(/\bpg_sleep\b|\bdblink\b|^\s*copy\s/im);

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

/**
 * Whether a marker tells the truth, which nothing above asks.
 *
 * The tests in the block above check the audit's shape: every migration named,
 * nothing that writes. Neither asks whether a marker answers correctly, and two
 * did not. `the_acceptable_use_verdict_is_ours` and `our_side_of_a_record_is_ours`
 * each asked whether `authenticated` holds *any* privilege on a column, and the
 * answer is yes and should be yes — a customer must be able to read their own
 * screening status and their own appeal's resolution. So the audit reported a
 * fully-migrated database as missing two of eighteen migrations: the one thing
 * it exists not to do, told to the one person who runs it precisely because he
 * is unsure where he stands.
 *
 * The test database has every migration by construction — `globalSetup` resets
 * it and applies them all — so the audit run against it must come back empty.
 * A marker that asks the wrong question now fails on the day it is written.
 */
describe('the markers themselves', () => {
  it('report nothing missing against a database that has every migration', async () => {
    const dsn = process.env.VIBEFYCODE_TEST_DSN;
    expect(dsn, 'the audit cannot be checked for truth without the test database').toBeTruthy();
    const url = new URL(dsn!);
    const pool = new Pool({
      host: url.searchParams.get('host')!,
      database: url.pathname.slice(1),
      user: 'postgres',
    });
    try {
      const last = audit
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .split(';')
        .map((statement) => statement.trim())
        .filter(Boolean)
        .at(-1)!;
      const { rows } = await pool.query<{ missing: string }>(last);
      expect(rows[0]?.missing, 'the audit calls a fully-migrated database incomplete').toBe(
        'nothing missing',
      );
    } finally {
      await pool.end();
    }
  }, 60_000);
});
