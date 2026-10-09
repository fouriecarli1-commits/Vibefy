/**
 * The deletion record said the artefact was gone. The artefact was not.
 *
 * `sweepRetention` writes a `retention_deletions` row, deletes the `evidence`
 * row, commits, and then asks the object store to remove the file. That
 * ordering is right, and the comment explaining it was half wrong: it said a
 * file left behind here "is found again by the next sweep — the row is gone, so
 * nothing points at it". The two halves contradict each other and the second is
 * the true one. The sweep finds work by reading `public.evidence`, so once the
 * row is deleted nothing will ever look for that file again.
 *
 * Measured on 2026-10-09 with a store whose `remove` throws:
 *
 *   · the `evidence` row is gone;
 *   · `retention_deletions` asserts the artefact was deleted;
 *   · the sweep reports `evidenceDeleted: 1`;
 *   · `audit_log` holds nothing;
 *   · the only trace is one log line, carrying an entity id that no longer
 *     exists in any table and not the path — so nobody could have found the
 *     file even knowing to look for it.
 *
 * We keep the bytes for ever while a statutory record says we do not. The
 * privacy policy names a retention period, and this is the mechanism that is
 * supposed to honour it.
 *
 * Three things are held here: the exception is recorded durably and with the
 * path, the sweep stops counting it as a deletion, and a later pass clears it
 * when the store is willing — because an audit row that always needs a person
 * is a backlog, not a fix.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { sweepRetention } from '../apps/worker/src/governance.ts';
import { connect } from './setup/client.ts';
import { memoryStorage } from './setup/artefacts.ts';
import { seedAccount, seedAssessment, sha256, type SeededAccount } from './setup/seed.ts';

let db: Client;
let pool: Pool;
let owner: SeededAccount;

beforeAll(async () => {
  db = await connect();
  const dsn = new URL(process.env.VIBEFYCODE_TEST_DSN!);
  pool = new Pool({
    host: dsn.searchParams.get('host')!,
    database: dsn.pathname.slice(1),
    user: 'postgres',
  });
  owner = await seedAccount(db, 'outlived');
});

afterAll(async () => {
  await pool?.end();
  await db?.end();
});

/** Expired evidence with a path, and nothing holding it open. */
async function expiredEvidence(path: string): Promise<string> {
  const seeded = await seedAssessment(db, owner);
  const { rows } = await db.query<{ id: string }>(
    `insert into public.evidence (assessment_id, organisation_id, kind, storage_path, sha256, retention_until)
     values ($1, $2, 'screenshot', $3, $4, now() - interval '1 day')
     returning id`,
    [seeded.assessmentId, owner.organisationId, path, sha256(path)],
  );
  return rows[0]!.id;
}

const auditFor = async (entityId: string, action: string) =>
  (
    await db.query<{ summary: string }>(
      `select summary from public.audit_log where entity_id = $1 and action = $2`,
      [entityId, action],
    )
  ).rows;

/** A store that will not let go. */
function refusingStorage(message = '403 from the object store') {
  const attempted: string[] = [];
  return {
    attempted,
    async remove(path: string) {
      attempted.push(path);
      throw new Error(message);
    },
  };
}

describe('a store that refuses to remove the artefact', () => {
  let evidenceId: string;
  const path = 'evidence/outlived.png';

  beforeAll(async () => {
    evidenceId = await expiredEvidence(path);
    await sweepRetention(pool, () => undefined, new Date(), 500, refusingStorage());
  }, 60_000);

  it('still deletes the row and records the deletion, which is the right order', async () => {
    // Unchanged on purpose. Deleting the file first and failing to delete the
    // row leaves a row pointing at nothing, which is the state the storage
    // argument exists to end.
    const row = await db.query('select id from public.evidence where id = $1', [evidenceId]);
    expect(row.rowCount).toBe(0);
    const deletion = await db.query(
      'select entity_id from public.retention_deletions where entity_id = $1',
      [evidenceId],
    );
    expect(deletion.rowCount).toBe(1);
  });

  it('writes down that we still hold the bytes, and where they are', async () => {
    const recorded = await auditFor(evidenceId, 'retention.artefact_not_removed');
    expect(recorded).toHaveLength(1);
    // The path is the whole point. The entity id names a row that no longer
    // exists anywhere, so a record carrying only that cannot be acted on.
    expect(recorded[0]!.summary).toContain(path);
    expect(recorded[0]!.summary).toMatch(/we still hold those bytes/i);
    expect(recorded[0]!.summary).toMatch(/403/);
  });

  it('does not count it as a deletion, because it was not one', async () => {
    const again = await expiredEvidence('evidence/outlived-two.png');
    const result = await sweepRetention(pool, () => undefined, new Date(), 500, refusingStorage());
    expect(result.artefactsOrphaned).toBeGreaterThanOrEqual(1);
    // Asked of this row rather than of the total, which another file's expired
    // evidence would otherwise inflate.
    const recorded = await auditFor(again, 'retention.artefact_not_removed');
    expect(recorded).toHaveLength(1);
  }, 60_000);
});

describe('a store that changes its mind', () => {
  it('clears the artefact on a later pass, and says it did', async () => {
    const path = 'evidence/changed-mind.png';
    const evidenceId = await expiredEvidence(path);

    // First pass: the store refuses, so the bytes stay and the exception is
    // written down.
    await sweepRetention(pool, () => undefined, new Date(), 500, refusingStorage());
    expect(await auditFor(evidenceId, 'retention.artefact_not_removed')).toHaveLength(1);

    // Second pass with a working store that actually holds the bytes.
    const storage = memoryStorage();
    await storage.put(path, Buffer.from('a screenshot'));
    await storage.put('evidence/not-mine.png', Buffer.from('somebody else'));
    const result = await sweepRetention(pool, () => undefined, new Date(), 500, storage);

    expect(await storage.get(path)).toBeNull();
    // And only that one.
    expect(await storage.get('evidence/not-mine.png')).not.toBeNull();
    expect(result.artefactsRecovered).toBeGreaterThanOrEqual(1);

    const cleared = await auditFor(evidenceId, 'retention.artefact_removed_later');
    expect(cleared).toHaveLength(1);
    expect(cleared[0]!.summary).toContain(path);
  }, 60_000);

  it('does not try the same orphan again once it is cleared', async () => {
    // The audit log is append-only, so an orphan cannot be marked resolved. The
    // second row is what stops the retry, and the query's `not exists` is the
    // whole mechanism.
    const path = 'evidence/already-cleared.png';
    const evidenceId = await expiredEvidence(path);
    await sweepRetention(pool, () => undefined, new Date(), 500, refusingStorage());

    const storage = memoryStorage();
    await storage.put(path, Buffer.from('bytes'));
    await sweepRetention(pool, () => undefined, new Date(), 500, storage);

    const tracker = refusingStorage();
    await sweepRetention(pool, () => undefined, new Date(), 500, tracker);
    expect(tracker.attempted).not.toContain(path);
    expect(await auditFor(evidenceId, 'retention.artefact_removed_later')).toHaveLength(1);
  }, 60_000);
});

describe('what it leaves alone', () => {
  it('records nothing when the store takes the file', async () => {
    const path = 'evidence/went-quietly.png';
    const evidenceId = await expiredEvidence(path);
    const storage = memoryStorage();
    await storage.put(path, Buffer.from('bytes'));

    const result = await sweepRetention(pool, () => undefined, new Date(), 500, storage);
    expect(await storage.get(path)).toBeNull();
    expect(await auditFor(evidenceId, 'retention.artefact_not_removed')).toHaveLength(0);
    expect(result.evidenceDeleted).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
