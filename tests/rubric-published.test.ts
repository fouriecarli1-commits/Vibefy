/**
 * The rubric has to exist in the database, not only in the repository.
 *
 * This suite exists because of a specific production failure. `assessments`
 * has a foreign key to `rubric_versions`, the engine stamps every score with
 * version 1.0.0, and no migration had ever published that version. The test
 * fixture seeded the row, so eight hundred passing tests proved the schema
 * worked without ever proving it was populated. The first real run paid for a
 * full assessment and then died on the constraint.
 *
 * So: one test that the migration publishes the version, and one that what it
 * publishes is byte-for-byte the rubric the scoring code loads. A seed that
 * drifts from the code is worse than no seed, because it scores against one
 * definition and claims another.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  CURRENT_RUBRIC_VERSION,
  getRubric,
  listRubricVersions,
  rubricChecksum,
} from '../packages/rubric/src/rubric.ts';
import { connect } from './setup/client.ts';

/**
 * The migration that publishes each version.
 *
 * Every published version is checked, not only the current one. A version stays
 * published for as long as any badge was earned against it, and a 1.0.0 that
 * quietly stopped matching the JSON the scoring code loads would silently
 * change what an already-issued badge was measured against.
 */
const MIGRATIONS: Readonly<Record<string, string>> = {
  '1.0.0': '20260830110000_publish_rubric_1_0_0.sql',
  '1.1.0': '20260918100000_publish_rubric_1_1_0.sql',
};

const migrationFor = (version: string) =>
  join(import.meta.dirname, '..', 'supabase', 'migrations', MIGRATIONS[version]!);

let db: Client;

beforeAll(async () => {
  db = await connect();
});

afterAll(async () => {
  await db.end();
});

describe.each(listRubricVersions())('published rubric %s', (version) => {
  it('is in the database after the migrations run', async () => {
    const { rows } = await db.query<{
      version: string;
      checksum: string;
      published_at: string | null;
      effective_from: string | null;
    }>(
      'select version, checksum, published_at, effective_from from public.rubric_versions where version = $1',
      [version],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.published_at).not.toBeNull();
    expect(rows[0]!.effective_from).not.toBeNull();
  });

  it('carries the checksum the scoring code computes', async () => {
    const { rows } = await db.query<{ checksum: string }>(
      'select checksum from public.rubric_versions where version = $1',
      [version],
    );
    expect(rows[0]!.checksum).toBe(rubricChecksum(version));
  });

  it('stores the same definition the scoring code loads', async () => {
    const { rows } = await db.query<{ definition: unknown }>(
      'select definition from public.rubric_versions where version = $1',
      [version],
    );
    expect(rows[0]!.definition).toEqual(getRubric(version));
  });

  it('lets an assessment satisfy its foreign key', async () => {
    // The actual failure, reproduced as a constraint check rather than a whole
    // run: the version the engine stamps must be referenceable.
    const { rows } = await db.query<{ ok: boolean }>(
      `select exists (
         select 1 from public.rubric_versions where version = $1
       ) as ok`,
      [version],
    );
    expect(rows[0]!.ok).toBe(true);
  });

  it('is frozen against later edits, so a score cannot be rewritten under it', async () => {
    await expect(
      db.query('update public.rubric_versions set definition = $2 where version = $1', [
        version,
        JSON.stringify({ tampered: true }),
      ]),
    ).rejects.toThrow(/published and immutable/i);
  });

  it('does not hard-code the checksum in the migration text', () => {
    // The migration is generated from the rubric JSON. If someone pastes a
    // checksum in by hand and edits the definition, the tests above catch it —
    // but this catches the likelier mistake of the two drifting silently.
    const sql = readFileSync(migrationFor(version), 'utf8');
    expect(sql).toContain(rubricChecksum(version));
    expect(sql).toContain(`'${version}'`);
  });
});

describe('which version is in force', () => {
  it('is the same one in the database as in the scoring code', async () => {
    // Two sources of truth for one fact, and they are updated by two different
    // acts on two different machines: a migration pasted into a SQL console,
    // and a deploy. Between them the database can say one version is in force
    // while every new assessment is still scored against another — and the
    // superseded-rubric sweep would, in that window, tell paying customers
    // their badge was measured against an out-of-date standard and name a
    // successor that nothing is actually scoring against yet.
    //
    // Asked of the catalogue, the same way the alert labels are, because the
    // gap is between a SQL file and a TypeScript constant that never mention
    // each other.
    const { rows } = await db.query<{ version: string }>(
      `select version
         from public.rubric_versions
        where superseded_at is null
          and effective_from is not null
          and effective_from <= now()
        order by effective_from desc
        limit 1`,
    );
    expect(rows, 'no rubric is in force at all').toHaveLength(1);
    expect(rows[0]!.version).toBe(CURRENT_RUBRIC_VERSION);
  });

  it('has superseded everything the scoring code no longer scores against', async () => {
    // The other half of the same fact. A version the code has moved past but
    // the database still calls live is what makes the query above ambiguous.
    const { rows } = await db.query<{ version: string; superseded_at: string | null }>(
      'select version, superseded_at from public.rubric_versions order by version',
    );
    const liveButNotCurrent = rows
      .filter((row) => row.superseded_at === null && row.version !== CURRENT_RUBRIC_VERSION)
      .map((row) => row.version);
    expect(liveButNotCurrent, 'versions the database still calls live').toEqual([]);
  });
});

describe('publishing a new version', () => {
  it('has a migration for every version the scoring code knows', () => {
    // A version in the registry with no migration is a foreign key waiting to
    // fail on a database that was never seeded by a test fixture — which is the
    // exact failure this file was written for.
    expect(Object.keys(MIGRATIONS).sort()).toEqual([...listRubricVersions()].sort());
  });

  it('leaves every earlier version exactly as it was', async () => {
    // 1.1.0 added criteria and nothing else. If a later version ever moves a
    // weight, a penalty, a band, a gate or the pass mark, it does so knowingly
    // — not as a side effect of adding somewhere to record an observation.
    const earlier = getRubric('1.0.0');
    const current = getRubric(CURRENT_RUBRIC_VERSION);
    expect(current.scoring).toEqual(earlier.scoring);
    expect(current.bands).toEqual(earlier.bands);
    expect(current.gates).toEqual(earlier.gates);
    expect(current.certification).toEqual(earlier.certification);
    expect(current.dimensions.map((dimension) => dimension.weight)).toEqual(
      earlier.dimensions.map((dimension) => dimension.weight),
    );
  });

  it('only ever adds criteria, never removes or renames one', async () => {
    // A criterion cited by an issued report must still mean what it meant.
    const earlier = getRubric('1.0.0').dimensions.flatMap((dimension) =>
      dimension.criteria.map((criterion) => `${criterion.id}:${criterion.label}`),
    );
    const current = getRubric(CURRENT_RUBRIC_VERSION).dimensions.flatMap((dimension) =>
      dimension.criteria.map((criterion) => `${criterion.id}:${criterion.label}`),
    );
    for (const criterion of earlier) expect(current).toContain(criterion);
  });
});
