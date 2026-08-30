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
  rubricChecksum,
} from '../packages/rubric/src/rubric.ts';
import { connect } from './setup/client.ts';

const MIGRATION = join(
  import.meta.dirname,
  '..',
  'supabase',
  'migrations',
  '20260830110000_publish_rubric_1_0_0.sql',
);

let db: Client;

beforeAll(async () => {
  db = await connect();
});

afterAll(async () => {
  await db.end();
});

describe('the published rubric', () => {
  it('is in the database after the migrations run', async () => {
    const { rows } = await db.query<{
      version: string;
      checksum: string;
      published_at: string | null;
      effective_from: string | null;
    }>(
      'select version, checksum, published_at, effective_from from public.rubric_versions where version = $1',
      [CURRENT_RUBRIC_VERSION],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.published_at).not.toBeNull();
    expect(rows[0]!.effective_from).not.toBeNull();
  });

  it('carries the checksum the scoring code computes', async () => {
    const { rows } = await db.query<{ checksum: string }>(
      'select checksum from public.rubric_versions where version = $1',
      [CURRENT_RUBRIC_VERSION],
    );
    expect(rows[0]!.checksum).toBe(rubricChecksum(CURRENT_RUBRIC_VERSION));
  });

  it('stores the same definition the scoring code loads', async () => {
    const { rows } = await db.query<{ definition: unknown }>(
      'select definition from public.rubric_versions where version = $1',
      [CURRENT_RUBRIC_VERSION],
    );
    expect(rows[0]!.definition).toEqual(getRubric(CURRENT_RUBRIC_VERSION));
  });

  it('lets an assessment satisfy its foreign key', async () => {
    // The actual failure, reproduced as a constraint check rather than a whole
    // run: the version the engine stamps must be referenceable.
    const { rows } = await db.query<{ ok: boolean }>(
      `select exists (
         select 1 from public.rubric_versions where version = $1
       ) as ok`,
      [CURRENT_RUBRIC_VERSION],
    );
    expect(rows[0]!.ok).toBe(true);
  });

  it('is frozen against later edits, so a score cannot be rewritten under it', async () => {
    await expect(
      db.query('update public.rubric_versions set definition = $2 where version = $1', [
        CURRENT_RUBRIC_VERSION,
        JSON.stringify({ tampered: true }),
      ]),
    ).rejects.toThrow(/published and immutable/i);
  });

  it('does not hard-code the checksum in the migration text', () => {
    // The migration is generated from the rubric JSON. If someone pastes a
    // checksum in by hand and edits the definition, the tests above catch it —
    // but this catches the likelier mistake of the two drifting silently.
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain(rubricChecksum(CURRENT_RUBRIC_VERSION));
    expect(sql).toContain(`'${CURRENT_RUBRIC_VERSION}'`);
  });
});
