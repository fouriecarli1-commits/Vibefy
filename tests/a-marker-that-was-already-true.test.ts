/**
 * What an audit marker actually claims.
 *
 * `tools/migration-audit.mjs` derives, for each migration, one boolean the
 * catalogue can answer: has this migration been applied? The claim that makes
 * an audit worth anything is therefore two-sided, and only one side had ever
 * been checked.
 *
 *   - **False before.** If the marker is already true on a database that has
 *     not run the migration, the audit reports it applied when it is not. That
 *     is the defect found by hand on 2026-10-10: two migrations whose markers
 *     asked whether `authenticated` *lacked* a privilege, which is also true of
 *     a database where the table does not exist yet. A fully-migrated database
 *     was told it was missing two of eighteen outstanding blocks, and somebody
 *     following `docs/DOEN.md` would have pasted them again.
 *   - **True after.** If the marker is false once the migration has run, the
 *     audit reports it missing for ever. `tests/migration-audit.test.ts` checks
 *     this side, against the finished database.
 *
 * So this walks the migrations in order against an empty database and asks each
 * marker both questions at the moment they mean something: immediately before
 * its own migration, and immediately after.
 *
 * It replaces a regex mirror. `an-audit-marker-names-what-its-migration-made`
 * reimplemented the tool's first three guess shapes in its own patterns and
 * asked whether an earlier migration had already created the named object. The
 * tool has eight shapes. The five it did not mirror — a column, a view, a
 * rubric version, a policy, an enum value — were never checked at all, and the
 * two defective markers were in the group it could not see.
 *
 * There is a third claim, and it is the one that protects what he actually
 * runs. `audit.sql` asks all sixty-four markers in one statement, so a marker
 * that *errors* on a partially-migrated database does not come back false — it
 * fails the whole query and he gets no answer at all. Measured on 2026-10-10:
 * none of the sixty-four errors at any point in the sequence, because they all
 * ask `to_regclass`, `information_schema` or a `pg_` catalogue, each of which
 * answers for an object that is not there rather than raising. So the count of
 * markers that could not be evaluated is asserted to be zero rather than
 * quietly folded into "not applied".
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { markerFor } from '../tools/migration-audit.mjs';

const DIR = 'supabase/migrations';
const PROBE = 'marker_truth_probe';

const migrations = readdirSync(DIR)
  .filter((file) => file.endsWith('.sql'))
  .sort();

let probe: Client;

beforeAll(async () => {
  const url = new URL(process.env.VIBEFYCODE_TEST_DSN!);
  const host = url.searchParams.get('host')!;
  const admin = new Client({ host, database: 'postgres', user: 'postgres' });
  await admin.connect();
  await admin.query(`drop database if exists ${PROBE}`);
  await admin.query(`create database ${PROBE}`);
  await admin.end();

  probe = new Client({ host, database: PROBE, user: 'postgres' });
  await probe.connect();
  await probe.query(readFileSync('supabase/shim/local-postgres-shim.sql', 'utf8'));
}, 120_000);

afterAll(async () => {
  await probe?.end();
});

/**
 * What the marker says right now.
 *
 * Three answers, not two. Swallowing the error as `false` was the first draft,
 * and it hid the claim that matters most: a marker the database cannot
 * evaluate takes the whole generated audit down with it, because `audit.sql`
 * asks all sixty-four in one statement.
 *
 * In a transaction that is always rolled back, because an unevaluable marker
 * aborts the transaction it is asked in and the next question has to be
 * askable.
 */
async function askMarker(check: string): Promise<'yes' | 'no' | 'unaskable'> {
  await probe.query('begin');
  try {
    const { rows } = await probe.query<{ answer: boolean | null }>(`select (${check}) as answer`);
    return rows[0]?.answer === true ? 'yes' : 'no';
  } catch {
    return 'unaskable';
  } finally {
    await probe.query('rollback');
  }
}

describe('every marker, asked before and after its own migration', () => {
  it('has something to ask about each migration', () => {
    // The anchor. Everything below is a loop over this list, and a loop over
    // nothing asserts nothing.
    expect(migrations.length).toBeGreaterThan(60);
    const unmarked = migrations.filter((file) => !markerFor(readFileSync(join(DIR, file), 'utf8')));
    expect(unmarked, 'migrations the audit can say nothing about').toEqual([]);
  });

  it('is false before its migration and true after, for all of them', async () => {
    const trueTooEarly: string[] = [];
    const falseAfterwards: string[] = [];
    const unaskable: string[] = [];
    let asked = 0;

    for (const file of migrations) {
      const sql = readFileSync(join(DIR, file), 'utf8');
      const check = markerFor(sql)!;
      const name = file.replace(/\.sql$/, '');
      const where = `${name}\n      ${check}`;

      const before = await askMarker(check);
      if (before === 'yes') trueTooEarly.push(where);
      if (before === 'unaskable') unaskable.push(`${where}\n      (before it ran)`);

      await probe.query(sql);

      const after = await askMarker(check);
      if (after === 'no') falseAfterwards.push(where);
      if (after === 'unaskable') unaskable.push(`${where}\n      (after it ran)`);
      asked += 1;
    }

    expect(asked, 'no migration was applied, so nothing was asked').toBe(migrations.length);

    expect(
      unaskable,
      `Markers the database could not evaluate. audit.sql asks all of them in one\n` +
        `statement, so one of these means he gets no audit at all rather than one\n` +
        `wrong line. Ask a catalogue that answers for a missing object — to_regclass,\n` +
        `information_schema, or a pg_ table — rather than one that raises:\n  ` +
        unaskable.join('\n  '),
    ).toEqual([]);

    expect(
      trueTooEarly,
      `Markers already true before their own migration ran. The audit calls these applied\n` +
        `on a database that has not got them, which sends somebody to paste a block twice:\n  ` +
        trueTooEarly.join('\n  '),
    ).toEqual([]);

    expect(
      falseAfterwards,
      `Markers still false after their own migration ran. The audit calls these missing\n` +
        `for ever:\n  ` +
        falseAfterwards.join('\n  '),
    ).toEqual([]);
  }, 300_000);
});
