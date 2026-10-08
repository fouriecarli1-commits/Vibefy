/**
 * Eleven tables are append-only, and nothing held the list.
 *
 * `tools/policy-mutation.mjs triggers`, re-run on 2026-10-08: twenty-nine
 * assertion triggers, and disabling all of them fails sixty-eight test files.
 * The trigger layer that had no coverage at all in September now has a great
 * deal — so the question is not whether these rules are tested but whether the
 * *set* is. Eleven of the twenty-nine are one rule applied eleven times:
 * `reject_mutation`, which raises on any update or delete.
 *
 * A behavioural test for each would be eleven near-identical seeds, and several
 * already exist scattered through the suite. What did not exist is anything
 * saying which tables are supposed to be on the list. A trigger dropped by a
 * later migration, or a new log table that nobody thought to guard, is invisible
 * to a suite that tests tables one at a time.
 *
 * So this is the list, written down with what each record is for, plus the two
 * directions of drift: a table here that has lost its trigger, and a trigger in
 * the schema that is not here. The second one matters as much as the first —
 * the list is only worth having if it cannot quietly fall behind the schema.
 *
 * One behavioural case as well, on `audit_log`, because the structural check
 * would pass unchanged if somebody replaced `reject_mutation`'s body with
 * `return new`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connect, expectRefusal } from './setup/client.ts';
import { seedAccount, type SeededAccount } from './setup/seed.ts';

type Event = 'update' | 'delete';

/**
 * What may only be added to, and why that is the rule.
 *
 * `billing_events` is the one exception and it is deliberate: its updates are
 * guarded by `billing_events_immutable_payload` instead, which permits a change
 * to `handled` and nothing else, because the webhook handler has to mark an
 * event as applied. The payload the provider sent is still untouchable.
 */
const APPEND_ONLY: Readonly<Record<string, { events: readonly Event[]; why: string }>> = {
  alert_deliveries: {
    events: ['update', 'delete'],
    why: 'What we sent somebody and when. A delivery record edited after a complaint is not a delivery record.',
  },
  audit_exports: {
    events: ['update', 'delete'],
    why: 'The row that lets a file produced in a dispute be checked against what we say we exported.',
  },
  audit_log: {
    events: ['update', 'delete'],
    why: 'Every action taken in a workspace. A log its subject can edit is not evidence of anything.',
  },
  authorisations: {
    events: ['update', 'delete'],
    why: 'The record that makes our testing lawful. A withdrawal is a new row, so nothing legitimate edits one.',
  },
  badge_events: {
    events: ['update', 'delete'],
    why: 'Why a badge moved. The history a customer and a reader are both entitled to see unchanged.',
  },
  billing_events: {
    events: ['delete'],
    why: 'What the payment provider told us. Its updates are narrowed to `handled` by billing_events_immutable_payload.',
  },
  consents: {
    events: ['update', 'delete'],
    why: 'What somebody accepted, which version, and when. The basis for every scan we run.',
  },
  drift_reports: {
    events: ['update', 'delete'],
    why: 'What got worse on an application and when we saw it.',
  },
  listing_events: {
    events: ['update', 'delete'],
    why: 'Why a directory listing appeared or went. The directory is a claim about who we certified.',
  },
  retention_deletions: {
    events: ['update', 'delete'],
    why: 'What we deleted and under which schedule — the evidence that the retention policy was carried out.',
  },
  reviews: {
    events: ['update', 'delete'],
    why: 'A reviewer’s written reasoning. A review rewritten after an appeal is not the review that was made.',
  },
};

interface TriggerRow {
  readonly relname: string;
  readonly tgname: string;
  readonly on_update: boolean;
  readonly on_delete: boolean;
}

let db: Client;
let account: SeededAccount;
let triggers: readonly TriggerRow[];

beforeAll(async () => {
  db = await connect();
  account = await seedAccount(db, 'append-only');
  const { rows } = await db.query<TriggerRow>(`
    select c.relname, t.tgname,
           (t.tgtype & 16) > 0 as on_update,
           (t.tgtype & 8) > 0 as on_delete
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_proc p on p.oid = t.tgfoid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not t.tgisinternal and p.proname = 'reject_mutation'
     order by c.relname
  `);
  triggers = rows;
});

afterAll(async () => {
  await db?.end();
});

describe('the list, against the schema', () => {
  it('finds a reject_mutation trigger for every table on it, covering what it should', () => {
    const byTable = new Map(triggers.map((row) => [row.relname, row]));
    const missing: string[] = [];
    for (const [table, entry] of Object.entries(APPEND_ONLY)) {
      const trigger = byTable.get(table);
      if (!trigger) {
        missing.push(`${table}: no reject_mutation trigger at all — ${entry.why}`);
        continue;
      }
      for (const event of entry.events) {
        const covered = event === 'update' ? trigger.on_update : trigger.on_delete;
        if (!covered) missing.push(`${table}: ${event} is no longer refused — ${entry.why}`);
      }
    }
    expect(
      missing,
      `an append-only table stopped being append-only:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('finds nothing in the schema that is not on it', () => {
    // The other direction, and the reason the list is worth keeping: a new log
    // table guarded in a migration and never written down here would make this
    // file a stale description of the schema rather than a rule about it.
    const unlisted = triggers
      .map((row) => row.relname)
      .filter((table) => APPEND_ONLY[table] === undefined);
    expect(
      unlisted,
      'a table is guarded by reject_mutation and is not in APPEND_ONLY. Add it with what its ' +
        `record is for:\n  ${unlisted.join('\n  ')}`,
    ).toEqual([]);
  });

  it('is not empty, which is the way a catalogue test passes having read nothing', () => {
    expect(triggers.length).toBe(Object.keys(APPEND_ONLY).length);
    expect(triggers.length).toBeGreaterThan(10);
  });
});

describe('the refusal itself', () => {
  /*
   * One table, behaviourally, because the three checks above would all pass
   * unchanged if somebody replaced `reject_mutation`'s body with `return new`.
   * `audit_log` because it is the one whose edit would be most useful to
   * somebody and least visible to everybody.
   */
  it('refuses an update and a delete, in the words the table uses', async () => {
    await db.query(
      `insert into public.audit_log
         (organisation_id, actor_id, actor_role, action, entity_type, entity_id, summary)
       values ($1, $2, 'admin', 'account.plan_set', 'organisation', $1, 'Seeded for the append-only test.')`,
      [account.organisationId, account.userId],
    );

    await db.query('begin');
    const updated = await expectRefusal(
      db,
      `update public.audit_log set summary = 'Something else entirely' where organisation_id = $1`,
      [account.organisationId],
    );
    expect(updated, 'an audit entry was edited').toMatch(/append-only.*UPDATE is not permitted/i);

    const deleted = await expectRefusal(
      db,
      `delete from public.audit_log where organisation_id = $1`,
      [account.organisationId],
    );
    expect(deleted, 'an audit entry was deleted').toMatch(/append-only.*DELETE is not permitted/i);
    await db.query('rollback');
  });
});
