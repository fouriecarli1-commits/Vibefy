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
import { resetRetentionNotices, sweepRetention } from '../apps/worker/src/governance.ts';
import {
  ARTEFACT_ORPHANED,
  ARTEFACT_REMOVED_LATER,
  UNRESOLVED_ORPHANS_SQL,
  unresolvedOrphans,
} from '../packages/governance/src/index.ts';
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

/** Recovery rows naming a path, whatever row they claim to resolve. */
const recoveriesOf = async (path: string) =>
  (
    await db.query<{ id: string }>(
      `select id from public.audit_log
        where action = 'evidence.artefact_removed_later' and summary like '%' || $1 || '%'`,
      [path],
    )
  ).rows;

/**
 * An orphan of the kind `persist.ts` writes: no evidence row, so no entity id.
 *
 * `withPathColumn: false` is a row written before the path was kept in a
 * column, which is every such row already in the table — the prose is the only
 * place it appears, and the sweep still has to find it there.
 */
async function rollbackOrphan(path: string, withPathColumn = true): Promise<void> {
  await db.query(
    `insert into public.audit_log
       (organisation_id, actor_id, actor_role, action, entity_type, entity_id, summary, after_state)
     values ($1, null, 'system', 'evidence.artefact_orphaned', 'evidence', null, $2,
             case when $4::boolean then jsonb_build_object('storage_path', $3::text) end)`,
    [
      owner.organisationId,
      `A run was rolled back after its evidence was written and the object store would not ` +
        `remove the artefact at ${path}. No evidence row points at it.`,
      path,
      withPathColumn,
    ],
  );
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
    const recorded = await auditFor(evidenceId, 'evidence.artefact_orphaned');
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
    const recorded = await auditFor(again, 'evidence.artefact_orphaned');
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
    expect(await auditFor(evidenceId, 'evidence.artefact_orphaned')).toHaveLength(1);

    // Second pass with a working store that actually holds the bytes.
    const storage = memoryStorage();
    await storage.put(path, Buffer.from('a screenshot'));
    await storage.put('evidence/not-mine.png', Buffer.from('somebody else'));
    const result = await sweepRetention(pool, () => undefined, new Date(), 500, storage);

    expect(await storage.get(path)).toBeNull();
    // And only that one.
    expect(await storage.get('evidence/not-mine.png')).not.toBeNull();
    expect(result.artefactsRecovered).toBeGreaterThanOrEqual(1);

    const cleared = await auditFor(evidenceId, 'evidence.artefact_removed_later');
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
    expect(await auditFor(evidenceId, 'evidence.artefact_removed_later')).toHaveLength(1);
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
    expect(await auditFor(evidenceId, 'evidence.artefact_orphaned')).toHaveLength(0);
    expect(result.evidenceDeleted).toBeGreaterThanOrEqual(1);
  }, 60_000);
});

describe('an orphan a rolled-back run left behind', () => {
  it('is picked up by the same second pass, which is why it shares the action', async () => {
    /*
     * The justification for one mechanism, measured.
     *
     * `persist.ts` produces this state from the other direction: a transaction
     * rolled back after the artefacts were written, where the cleanup then
     * failed. No evidence row points at those bytes, so the first pass of this
     * sweep cannot reach them from the table — the second pass is the only
     * thing that can, and it finds its work by action name. If the two
     * producers used different names, half the orphans would sit there for
     * ever and an operator would have to know which producer left which row.
     */
    const path = 'evidence/left-by-a-rollback.png';
    await db.query(
      `insert into public.audit_log
         (organisation_id, actor_id, actor_role, action, entity_type, entity_id, summary)
       values ($1, null, 'system', 'evidence.artefact_orphaned', 'evidence', null, $2)`,
      [
        owner.organisationId,
        `A run was rolled back after its evidence was written and the object store would not ` +
          `remove the artefact at ${path}. No evidence row points at it.`,
      ],
    );

    const storage = memoryStorage();
    await storage.put(path, Buffer.from('a screenshot nobody can find'));
    const result = await sweepRetention(pool, () => undefined, new Date(), 500, storage);

    expect(await storage.get(path)).toBeNull();
    expect(result.artefactsRecovered).toBeGreaterThanOrEqual(1);
  }, 60_000);
});

describe('an orphan with no evidence row to name', () => {
  /*
   * The retry that never stopped retrying.
   *
   * `persist.ts` writes every rolled-back orphan with `entity_id` null, because
   * the evidence row it would have named does not exist. The pass that clears
   * orphans matched a recovery to its orphan on `entity_id`, and in SQL `null =
   * null` is not true — so `not exists` never saw the recovery row the previous
   * sweep had written. Measured on 2026-10-21: the file was removed again on
   * every sweep for ever, each pass counting `artefactsRecovered: 1` for work
   * already done and appending another `artefact_removed_later` row to an
   * append-only table. 288 rows a day, per orphan, with the sweep's own log line
   * reporting progress.
   *
   * The identity of an orphan is its path. These hold that it is matched by one.
   */
  it('is cleared once and then left alone', async () => {
    const path = 'assessments/rolled-back/evidence/once';
    await rollbackOrphan(path);

    const storage = memoryStorage();
    await storage.put(path, Buffer.from('a screenshot nobody can find'));
    const first = await sweepRetention(pool, () => undefined, new Date(), 500, storage);
    expect(first.artefactsRecovered).toBeGreaterThanOrEqual(1);
    expect(await storage.get(path)).toBeNull();
    expect(await recoveriesOf(path)).toHaveLength(1);

    // Second pass. A store that throws on anything it is asked for, so a retry
    // would both be visible and fail loudly rather than quietly succeeding
    // against a path that is already gone.
    const tracker = refusingStorage();
    const second = await sweepRetention(pool, () => undefined, new Date(), 500, tracker);
    expect(tracker.attempted).not.toContain(path);
    expect(await recoveriesOf(path)).toHaveLength(1);
    // And it is no longer counted as something we are holding.
    expect(second.artefactsRecovered).toBe(0);
  }, 60_000);

  it('is matched by its sentence when the path was never put in a column', async () => {
    // Every orphan row written before today is this row. The path is in the
    // prose and nowhere else, and both producers word that clause the same way,
    // which is what this holds.
    const path = 'assessments/rolled-back/evidence/legacy';
    await rollbackOrphan(path, false);

    const storage = memoryStorage();
    await storage.put(path, Buffer.from('bytes'));
    await sweepRetention(pool, () => undefined, new Date(), 500, storage);
    expect(await storage.get(path)).toBeNull();
    expect(await recoveriesOf(path)).toHaveLength(1);

    const tracker = refusingStorage();
    await sweepRetention(pool, () => undefined, new Date(), 500, tracker);
    expect(tracker.attempted).not.toContain(path);
    expect(await recoveriesOf(path)).toHaveLength(1);
  }, 60_000);
});

describe('what the sweep says about what it is still holding', () => {
  beforeAll(() => resetRetentionNotices());

  it('counts an orphan whose path cannot be read, instead of skipping it', async () => {
    /*
     * The bare `continue`.
     *
     * A row the pass cannot act on was skipped without a word, and it keeps one
     * of the `limit` places in an ordered page for ever — so enough of them and
     * the pass stops reaching the orphans a retry would clear, while every
     * counter still reads zero.
     */
    await db.query(
      `insert into public.audit_log
         (organisation_id, actor_id, actor_role, action, entity_type, entity_id, summary)
       values ($1, null, 'system', 'evidence.artefact_orphaned', 'evidence', null, $2)`,
      [owner.organisationId, 'Something went wrong with a file. No path was written down.'],
    );

    const said: { message: string; detail?: Record<string, unknown> }[] = [];
    const result = await sweepRetention(
      pool,
      (message, detail) => said.push({ message, ...(detail ? { detail } : {}) }),
      new Date(),
      500,
      memoryStorage(),
    );

    expect(result.artefactsUnreadable).toBeGreaterThanOrEqual(1);
    const line = said.find((entry) => entry.message === 'orphaned artefact has no readable path');
    expect(line).toBeDefined();
    // The audit row's own id, because that is the only thing a person can look
    // the row up by: there is no path and no entity id.
    expect(line!.detail?.auditLogId).toBeTruthy();
  }, 60_000);

  it('says what is outstanding on a sweep where nothing else happened', async () => {
    /*
     * All four event counters are zero both on a sweep with nothing to do and on
     * a sweep whose only remaining work is work the store keeps refusing. The
     * log line was suppressed on all-zero, so the second case said nothing at
     * all, for ever, while bytes a deletion record calls deleted sat in a
     * bucket.
     */
    const path = 'assessments/standing/evidence/refused';
    await rollbackOrphan(path);
    resetRetentionNotices();

    const said: { message: string; detail?: Record<string, unknown> }[] = [];
    const result = await sweepRetention(
      pool,
      (message, detail) => said.push({ message, ...(detail ? { detail } : {}) }),
      new Date(),
      500,
      refusingStorage(),
    );

    expect(result.evidenceDeleted).toBe(0);
    expect(result.artefactsOrphaned).toBe(0);
    expect(result.artefactsRecovered).toBe(0);
    expect(result.artefactsOutstanding).toBeGreaterThanOrEqual(1);

    const summary = said.find((entry) => entry.message === 'retention sweep');
    expect(summary).toBeDefined();
    expect(summary!.detail?.artefactsOutstanding).toBe(result.artefactsOutstanding);
  }, 60_000);

  it('says it once a day and not every five minutes', async () => {
    // The sweep runs 288 times a day. A standing condition repeated that often
    // is a quieter warning than one sentence, not a louder one.
    resetRetentionNotices();
    const lines: string[] = [];
    const log = (message: string) => lines.push(message);
    const now = new Date();
    await sweepRetention(pool, log, now, 500, refusingStorage());
    const again: string[] = [];
    await sweepRetention(pool, (message) => again.push(message), now, 500, refusingStorage());

    expect(lines).toContain('retention sweep');
    expect(again).not.toContain('retention sweep');
  }, 60_000);
});

describe('who can see that the bytes are gone', () => {
  it('writes the recovery against the organisation the orphan belonged to', async () => {
    /*
     * The customer's half of the audit trail.
     *
     * The log exists to be inspectable by the customer whose assessment it
     * describes, and the policy on the table shows them their own
     * organisation's rows. The recovery row was written with no organisation at
     * all — so the row saying "we still hold your artefact" was visible to them
     * and the row saying "it is gone now" was not, and from their side the
     * first notice stood for ever. Platform staff could see both, which is how
     * it went unnoticed.
     */
    const path = 'assessments/whose-bytes/evidence/one';
    await rollbackOrphan(path);

    const storage = memoryStorage();
    await storage.put(path, Buffer.from('bytes'));
    await sweepRetention(pool, () => undefined, new Date(), 500, storage);

    const { rows } = await db.query<{ organisation_id: string | null }>(
      `select organisation_id from public.audit_log
        where action = $1 and summary like '%' || $2 || '%'`,
      [ARTEFACT_REMOVED_LATER, path],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.organisation_id).toBe(owner.organisationId);
  }, 60_000);
});

describe('the two spellings of one rule', () => {
  it('agree about which orphans are still outstanding', async () => {
    /*
     * The sweep asks Postgres and the administrator's page asks TypeScript, and
     * both are reading the same rule: an orphan is identified by its path, and a
     * recovery row resolves it. Two spellings of one predicate is how a number
     * and the work it describes come apart, so they are held to the same answer
     * here — over whatever this whole file has left in the table, which is a
     * wider set of shapes than either could be given on purpose.
     */
    const bySql = await db.query<{ id: string }>(`${UNRESOLVED_ORPHANS_SQL}`, [
      ARTEFACT_ORPHANED,
      ARTEFACT_REMOVED_LATER,
    ]);
    const everything = await db.query(
      `select id, action, entity_id, summary, after_state
         from public.audit_log where action in ($1, $2)`,
      [ARTEFACT_ORPHANED, ARTEFACT_REMOVED_LATER],
    );

    // Both actions are in the table by now, and orphans of every shape this
    // file produces: with an entity id and without, resolved by path and
    // unresolvable for want of one.
    expect(everything.rowCount).toBeGreaterThan(6);
    const byCode = unresolvedOrphans(everything.rows);
    expect(byCode.map((row) => String(row.id)).sort()).toEqual(
      bySql.rows.map((row) => String(row.id)).sort(),
    );
    // And not vacuously: something is outstanding and something is not.
    expect(byCode.length).toBeGreaterThan(0);
    expect(byCode.length).toBeLessThan(everything.rowCount!);
  }, 60_000);
});
