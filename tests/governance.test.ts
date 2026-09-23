/**
 * The promises the schema recorded and nothing carried out.
 *
 * Every one of these was already written down before this milestone: a spend
 * ceiling in the pricing config, a `retention_until` on every evidence artefact,
 * a `due_at` on every data-subject request. Recording an intention is not
 * keeping a promise, and this file is what turns the three into behaviour that
 * can be checked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import {
  CEILINGS,
  canTransition,
  daysRemaining,
  deletionRecordFor,
  dueDateFor,
  dueForDeletion,
  evaluateSpend,
  isOverdue,
  kindCopy,
  refusalIsAnswerable,
  RESPONSE_DAYS,
  RETENTION_SCHEDULE,
  ruleFor,
  spendWindows,
  type RetainedRecord,
} from '../packages/governance/src/index.ts';
import {
  spendingIsPaused,
  sweepGovernanceDeadlines,
  sweepRetention,
  sweepSpendCap,
  resetSpendNotices,
} from '../apps/worker/src/governance.ts';
import {
  announceSpendPause,
  processNextRequest,
  resetSpendPauseNotice,
} from '../apps/worker/src/index.ts';
import { actingAs, connect, expectRefusal } from './setup/client.ts';
import { memoryStorage } from './setup/artefacts.ts';
import {
  makeReviewer,
  seedAccount,
  seedApp,
  seedAssessment,
  sha256,
  type SeededAccount,
} from './setup/seed.ts';

let db: Client;
let pool: Pool;
let owner: SeededAccount;
let admin: SeededAccount;

beforeAll(async () => {
  db = await connect();
  const dsn = new URL(process.env.VIBEFYCODE_TEST_DSN!);
  pool = new Pool({
    host: dsn.searchParams.get('host')!,
    database: dsn.pathname.slice(1),
    user: 'postgres',
  });
  owner = await seedAccount(db, 'governance-owner');
  admin = await seedAccount(db, 'governance-admin');
  await db.query(`update public.users set platform_role = 'admin' where id = $1`, [admin.userId]);
});

afterAll(async () => {
  await pool?.end();
  await db?.end();
});

beforeEach(async () => {
  await db.query('delete from public.spend_pauses');
});

describe('the spend ceiling', () => {
  it('reads its numbers from the pricing config, not from code', () => {
    expect(CEILINGS.globalDailyUsd).toBeGreaterThan(0);
    expect(CEILINGS.freeTierWeeklyAlertUsd).toBeGreaterThan(0);
  });

  it('pauses at the ceiling and warns at four fifths', () => {
    const quiet = evaluateSpend({ todayUsd: 10, freeTierThisWeekUsd: 0, alreadyPaused: false });
    expect(quiet).toEqual([]);

    const warning = evaluateSpend({
      todayUsd: CEILINGS.globalDailyUsd * 0.85,
      freeTierThisWeekUsd: 0,
      alreadyPaused: false,
    });
    expect(warning.map((action) => action.kind)).toEqual(['alert']);

    const stop = evaluateSpend({
      todayUsd: CEILINGS.globalDailyUsd,
      freeTierThisWeekUsd: 0,
      alreadyPaused: false,
    });
    expect(stop.map((action) => action.kind)).toEqual(['pause']);
  });

  it('does not pause twice', () => {
    expect(
      evaluateSpend({
        todayUsd: CEILINGS.globalDailyUsd * 3,
        freeTierThisWeekUsd: 0,
        alreadyPaused: true,
      }).map((action) => action.kind),
    ).toEqual([]);
  });

  it('alerts on the free tier rather than stopping it', () => {
    // Stopping the free tier silently would look, to a prospective customer,
    // exactly like a broken product.
    const actions = evaluateSpend({
      todayUsd: 1,
      freeTierThisWeekUsd: CEILINGS.freeTierWeeklyAlertUsd + 1,
      alreadyPaused: false,
    });
    expect(actions.map((action) => action.kind)).toEqual(['alert']);
    expect(actions[0]!.reason).toMatch(/keep running/);
  });

  it('uses one definition of today and this week', () => {
    const { dayStart, weekStart } = spendWindows(new Date('2026-08-22T13:45:00Z'));
    expect(dayStart.toISOString()).toBe('2026-08-22T00:00:00.000Z');
    expect(weekStart.toISOString()).toBe('2026-08-15T00:00:00.000Z');
  });

  it('writes the pause to the database, so restarting the worker does not lift it', async () => {
    await db.query(
      `insert into public.spend_pauses (reason, observed_usd, ceiling_usd)
       values ('Test pause, recorded so the worker stops claiming work.', 999, 200)`,
    );
    const client = await pool.connect();
    try {
      expect(await spendingIsPaused(client)).toBe(true);
    } finally {
      client.release();
    }
  });

  it('allows only one live pause, however many workers cross the line at once', async () => {
    const insert = () =>
      db.query(
        `insert into public.spend_pauses (reason, observed_usd, ceiling_usd)
         values ('Two workers crossed the ceiling in the same second.', 210, 200)`,
      );
    await insert();
    await expect(insert()).rejects.toThrow(/spend_pauses_one_live/);
  });

  it('refuses to lift a pause without a written reason', async () => {
    await db.query(
      `insert into public.spend_pauses (reason, observed_usd, ceiling_usd)
       values ('A pause that somebody will want to lift in a hurry.', 210, 200)`,
    );
    await expect(
      db.query(`update public.spend_pauses set lifted_at = now() where lifted_at is null`),
    ).rejects.toThrow(/spend_lift_needs_reason/);
  });

  it('stops the worker claiming any work while a pause is live', async () => {
    // The whole point. A ceiling that only reports is not a ceiling.
    const account = await seedAccount(db, 'paused-worker');
    const appId = await seedApp(db, account, 'Kettle');
    await db.query(
      `insert into public.assessment_requests (app_id, organisation_id, depth, plan_at_request, max_run_cost_usd)
       values ($1, $2, 'limited', 'free', 0.5)`,
      [appId, account.organisationId],
    );
    await db.query(
      `insert into public.spend_pauses (reason, observed_usd, ceiling_usd)
       values ('Paused for the purposes of this test, deliberately.', 999, 200)`,
    );

    expect(await processNextRequest(pool, () => undefined)).toBe(false);

    const { rows } = await db.query<{ status: string }>(
      'select status::text as status from public.assessment_requests where app_id = $1',
      [appId],
    );
    // Still queued, not failed. A pause defers work; it does not lose it.
    expect(rows[0]!.status).toBe('queued');
  });

  it('reports the observed numbers on the sweep', async () => {
    const result = await sweepSpendCap(pool, () => undefined);
    expect(result.todayUsd).toBeGreaterThanOrEqual(0);
    expect(result.freeTierThisWeekUsd).toBeGreaterThanOrEqual(0);
  });

  it('announces the pause and the lift, not the state, every five seconds', () => {
    // The claim check runs every five seconds, so a line per poll was seventeen
    // thousand identical sentences a day — and the lift, which is the one line
    // somebody is waiting for, would have arrived looking exactly like them.
    //
    // Driven directly rather than through `processNextRequest`, because seeing
    // the lift means running that unpaused, which claims the oldest queued
    // request in the database. The first version of this test did exactly that
    // and stole `journey.test.ts`'s request out from under it — twelve failures
    // in a file that had not changed.
    resetSpendPauseNotice();
    const said: string[] = [];
    const log = (message: string) => said.push(message);

    announceSpendPause(true, log);
    announceSpendPause(true, log);
    announceSpendPause(true, log);
    expect(said.filter((line) => line.startsWith('spending paused'))).toHaveLength(1);

    announceSpendPause(false, log);
    announceSpendPause(false, log);
    expect(
      said.filter((line) => line.startsWith('spending resumed')),
      'and the lift is said exactly once too',
    ).toHaveLength(1);

    // And a pause that comes back is a new event, not a repeat of the old one.
    announceSpendPause(true, log);
    expect(said.filter((line) => line.startsWith('spending paused'))).toHaveLength(2);
    resetSpendPauseNotice();
  });

  it('says it through the worker, not only in the helper', async () => {
    // The wiring, checked once. Only ever called while a pause is live, so this
    // cannot claim anything: `processNextRequest` returns before it tries.
    resetSpendPauseNotice();
    await db.query(
      `insert into public.spend_pauses (reason, observed_usd, ceiling_usd)
       values ('Paused so this test can watch what the worker says about it.', 999, 200)`,
    );
    const said: string[] = [];
    expect(await processNextRequest(pool, (message) => said.push(message))).toBe(false);
    expect(said.filter((line) => line.startsWith('spending paused'))).toHaveLength(1);
    resetSpendPauseNotice();
  });

  it('says a standing spend condition once a day, not every five minutes', async () => {
    // Free-tier spend past its weekly budget is a state that lasts the rest of
    // the week, not an event. Logged unconditionally by a sweep that runs every
    // five minutes, it was a few hundred identical sentences — and the next
    // thing worth reading would have arrived indistinguishable from all of
    // them. The count still reports it every time; the sentence does not.
    resetSpendNotices();
    const seeded = await seedAssessment(db, owner);
    // Dated five days back, so it counts against the rolling week and not
    // against today — a record inside today's window would push the daily
    // total about and could pause the platform under every other test here.
    await db.query(
      `insert into public.cost_records
         (assessment_id, organisation_id, model, ai_cost_usd, purpose, recorded_at)
       values ($1, $2, 'test', $3, 'assessment', now() - interval '5 days')`,
      [seeded.assessmentId, owner.organisationId, CEILINGS.freeTierWeeklyAlertUsd + 20],
    );

    const said: { message: string; trigger?: unknown }[] = [];
    const log = (message: string, detail?: Record<string, unknown>) =>
      said.push({ message, trigger: detail?.trigger });
    const freeTierLines = () =>
      said.filter((line) => line.message === 'spend alert' && line.trigger === 'free_tier_weekly');

    const now = new Date();
    const first = await sweepSpendCap(pool, log, now);
    expect(first.alerts).toBeGreaterThan(0);
    expect(freeTierLines()).toHaveLength(1);

    const second = await sweepSpendCap(pool, log, now);
    expect(second.alerts, 'the condition has not gone away').toBeGreaterThan(0);
    expect(freeTierLines(), 'and it is not said twice in one day').toHaveLength(1);

    // Tomorrow it is said again: a budget still overrun a day later is worth
    // hearing about a second time.
    await sweepSpendCap(pool, log, new Date(now.getTime() + 86_400_000));
    expect(freeTierLines()).toHaveLength(2);
    resetSpendNotices();
  });

  it('keeps the pause out of every customer’s sight', async () => {
    await db.query(
      `insert into public.spend_pauses (reason, observed_usd, ceiling_usd)
       values ('A pause naming our own numbers, which are not a customer''s business.', 210, 200)`,
    );
    const asCustomer = await actingAs(db, { userId: owner.userId }, async (client) => {
      const { rows } = await client.query('select id from public.spend_pauses');
      return rows.length;
    });
    expect(asCustomer).toBe(0);

    const asAdmin = await actingAs(db, { userId: admin.userId }, async (client) => {
      const { rows } = await client.query('select id from public.spend_pauses');
      return rows.length;
    });
    expect(asAdmin).toBeGreaterThan(0);
  });
});

describe('retention', () => {
  it('publishes the figures the engine actually enforces', async () => {
    /*
     * Two tables about the same thing, in two packages, with nothing joining
     * them.
     *
     * `RETENTION_SCHEDULE` in `@vibefycode/governance` is rendered to customers
     * on `/console/privacy`, rationale and all — so `evidence: 90 days` and the
     * sentence about screenshots being held for thirty are a published promise.
     * What is enforced is `RETENTION_DAYS` in `@vibefycode/engine`, per evidence
     * kind, which is what `stamp` puts in `retention_until` and what the sweep
     * deletes on.
     *
     * Today they agree: the engine's longest kind is ninety and its shortest is
     * thirty. Nothing makes them keep agreeing, and the direction that hurts is
     * quiet — raise one engine kind to a hundred and eighty and the notice
     * understates how long we keep somebody's screenshots, in the document they
     * were given to rely on.
     *
     * The governance package deliberately does not import the engine; a test
     * can, and this is the seam where they are held together.
     */
    const { RETENTION_DAYS } = await import('../packages/engine/src/runtime/evidence.ts');
    const enforced = Object.values(RETENTION_DAYS);
    const published = RETENTION_SCHEDULE.find((rule) => rule.dataClass === 'evidence');
    expect(published).toBeDefined();

    // The headline figure is the longest we ever keep an artefact. A customer
    // reading "90 days" is entitled to have nothing outlive it.
    expect(published!.days).toBe(Math.max(...enforced));

    // And the shortest, which the rationale names out loud because screenshots
    // are the ones that can incidentally capture a real person.
    expect(Math.min(...enforced)).toBe(30);
    expect(published!.rationale).toContain('30 days');
  });

  it('publishes a rationale for every data class, written for a customer', () => {
    for (const rule of RETENTION_SCHEDULE) {
      expect(rule.days).toBeGreaterThan(0);
      expect(rule.rationale.length).toBeGreaterThan(40);
    }
    expect(ruleFor('evidence').days).toBeLessThan(ruleFor('cost_record').days);
  });

  it('deletes strictly past the deadline, not on it', () => {
    const at = (iso: string): RetainedRecord => ({
      id: iso,
      dataClass: 'evidence',
      retentionUntil: new Date(iso),
    });
    const now = new Date('2026-08-22T00:00:00Z');
    expect(dueForDeletion([at('2026-08-22T00:00:00Z')], now)).toEqual([]);
    expect(dueForDeletion([at('2026-08-21T23:59:59Z')], now)).toHaveLength(1);
  });

  it('keeps the hash and not the artefact', () => {
    const record = deletionRecordFor({
      id: 'e1',
      dataClass: 'evidence',
      retentionUntil: new Date('2026-01-01'),
      sha256: 'a'.repeat(64),
      organisationId: 'o1',
    });
    expect(record.sha256).toBe('a'.repeat(64));
    expect(Object.keys(record)).not.toContain('storagePath');
    expect(Object.keys(record)).not.toContain('content');
  });

  it('actually deletes expired evidence and records that it did', async () => {
    const seeded = await seedAssessment(db, owner);
    const { rows } = await db.query<{ id: string }>(
      `insert into public.evidence (assessment_id, organisation_id, kind, storage_path, sha256, retention_until)
       values ($1, $2, 'screenshot', 'evidence/old.png', $3, now() - interval '1 day')
       returning id`,
      [seeded.assessmentId, owner.organisationId, sha256('old-evidence')],
    );
    const evidenceId = rows[0]!.id;

    const result = await sweepRetention(pool, () => undefined);
    expect(result.evidenceDeleted).toBeGreaterThanOrEqual(1);

    const remaining = await db.query('select id from public.evidence where id = $1', [evidenceId]);
    expect(remaining.rowCount).toBe(0);

    const deletion = await db.query<{ sha256: string; data_class: string }>(
      'select sha256, data_class from public.retention_deletions where entity_id = $1',
      [evidenceId],
    );
    expect(deletion.rows[0]!.data_class).toBe('evidence');
    expect(deletion.rows[0]!.sha256).toBe(sha256('old-evidence'));
  });

  it('deletes the artefact as well as the row that accounted for it', async () => {
    // The sweep wrote a deletion record, removed a row, and left the file on
    // disk for ever — a retention policy that deletes the paperwork. It could
    // not have done otherwise: nothing had written the file in the first place.
    const seeded = await seedAssessment(db, owner);
    const { rows } = await db.query<{ id: string }>(
      `insert into public.evidence (assessment_id, organisation_id, kind, storage_path, sha256, retention_until)
       values ($1, $2, 'screenshot', 'evidence/expired.png', $3, now() - interval '1 day')
       returning id`,
      [seeded.assessmentId, owner.organisationId, sha256('expired-evidence')],
    );
    const storage = memoryStorage();
    await storage.put('evidence/expired.png', Buffer.from('a screenshot'));
    await storage.put('evidence/current.png', Buffer.from('another screenshot'));

    await sweepRetention(pool, () => undefined, new Date(), 500, storage);

    expect(await storage.get('evidence/expired.png')).toBeNull();
    // And only that one: a sweep that took everything with it would be worse
    // than one that took nothing.
    expect(await storage.get('evidence/current.png')).not.toBeNull();
    const remaining = await db.query('select id from public.evidence where id = $1', [rows[0]!.id]);
    expect(remaining.rowCount).toBe(0);
  });

  it('leaves evidence that is still within its retention period', async () => {
    const seeded = await seedAssessment(db, owner);
    const { rows } = await db.query<{ id: string }>(
      `insert into public.evidence (assessment_id, organisation_id, kind, storage_path, sha256, retention_until)
       values ($1, $2, 'http_exchange', 'evidence/new.json', $3, now() + interval '30 days')
       returning id`,
      [seeded.assessmentId, owner.organisationId, sha256('new-evidence')],
    );
    await sweepRetention(pool, () => undefined);
    const remaining = await db.query('select id from public.evidence where id = $1', [rows[0]!.id]);
    expect(remaining.rowCount).toBe(1);
  });

  it('refuses to edit a deletion record', async () => {
    await expect(
      db.query(
        `update public.retention_deletions set data_class = 'alert' where data_class = 'evidence'`,
      ),
    ).rejects.toThrow(/append-only/i);
  });

  it('shows a customer their own deletions and nobody else’s', async () => {
    const stranger = await seedAccount(db, 'governance-stranger');
    const visible = await actingAs(db, { userId: stranger.userId }, async (client) => {
      const { rows } = await client.query(
        'select id from public.retention_deletions where organisation_id = $1',
        [owner.organisationId],
      );
      return rows.length;
    });
    expect(visible).toBe(0);
  });
});

describe('data-subject requests', () => {
  it('describes what each right actually gets you', () => {
    for (const type of ['access', 'correction', 'deletion', 'portability', 'objection'] as const) {
      expect(kindCopy(type).promise.length).toBeGreaterThan(60);
    }
    // The deletion promise has to be honest about what is kept, or it is not a
    // promise, it is a marketing sentence.
    expect(kindCopy('deletion').promise).toMatch(/retained|kept/i);
  });

  it('gets a deadline from the database, not from whoever wrote the form', async () => {
    const { rows } = await db.query<{ due_at: string; created_at: string }>(
      `insert into public.data_requests (user_id, organisation_id, request_type)
       values ($1, $2, 'access') returning due_at, created_at`,
      [owner.userId, owner.organisationId],
    );
    const due = new Date(rows[0]!.due_at);
    const created = new Date(rows[0]!.created_at);
    expect(Math.round((due.getTime() - created.getTime()) / 86_400_000)).toBe(RESPONSE_DAYS);
  });

  it('computes the same deadline in code as the database sets', () => {
    const created = new Date('2026-08-22T00:00:00Z');
    expect(dueDateFor(created).toISOString()).toBe('2026-09-21T00:00:00.000Z');
    expect(daysRemaining(dueDateFor(created), created)).toBe(RESPONSE_DAYS);
  });

  it('stops counting a request as overdue once it is answered', () => {
    const past = new Date('2020-01-01');
    expect(isOverdue(past, 'in_progress')).toBe(true);
    expect(isOverdue(past, 'completed')).toBe(false);
    expect(isOverdue(past, 'refused')).toBe(false);
  });

  it('will not let a completed request be reopened', () => {
    // A deadline that can be restarted is the same as no deadline.
    expect(canTransition('received', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'completed')).toBe(true);
    expect(canTransition('completed', 'in_progress')).toBe(false);
    expect(canTransition('refused', 'received')).toBe(false);
  });

  it('requires a lawful basis to refuse, in code and in the database', async () => {
    expect(refusalIsAnswerable(null)).toBe(false);
    expect(refusalIsAnswerable('no')).toBe(false);
    expect(refusalIsAnswerable('Manifestly unfounded under Article 12(5)(b); reasons sent.')).toBe(
      true,
    );

    const { rows } = await db.query<{ id: string }>(
      `insert into public.data_requests (user_id, organisation_id, request_type)
       values ($1, $2, 'objection') returning id`,
      [owner.userId, owner.organisationId],
    );
    await expect(
      db.query(`update public.data_requests set status = 'refused' where id = $1`, [rows[0]!.id]),
    ).rejects.toThrow(/refusal_needs_basis/);
  });

  it('is private to the person who made it', async () => {
    const stranger = await seedAccount(db, 'governance-nosy');
    const { rows } = await db.query<{ id: string }>(
      `insert into public.data_requests (user_id, organisation_id, request_type, details)
       values ($1, $2, 'access', 'Please send me everything you hold.') returning id`,
      [owner.userId, owner.organisationId],
    );
    const visible = await actingAs(db, { userId: stranger.userId }, async (client) => {
      const { rows: seen } = await client.query(
        'select id from public.data_requests where id = $1',
        [rows[0]!.id],
      );
      return seen.length;
    });
    expect(visible).toBe(0);
  });

  it('notices a deadline we are about to miss', async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.data_requests (user_id, organisation_id, request_type, due_at)
       values ($1, $2, 'access', now() - interval '1 day') returning id`,
      [owner.userId, owner.organisationId],
    );
    const result = await sweepGovernanceDeadlines(pool, () => undefined);
    expect(result.overdueRequests).toBeGreaterThanOrEqual(1);
    expect(rows).toHaveLength(1);
  });
});

describe('appeals', () => {
  let reviewer: SeededAccount;

  beforeAll(async () => {
    reviewer = await seedAccount(db, 'governance-reviewer');
    await makeReviewer(db, reviewer.userId);
  });

  it('gets a fourteen-day deadline from the database', async () => {
    const seeded = await seedAssessment(db, owner);
    const { rows } = await db.query<{ due_at: string; created_at: string }>(
      `insert into public.appeals (assessment_id, organisation_id, submitted_by, grounds)
       values ($1, $2, $3, 'The finding describes a route that requires authentication we provide.')
       returning due_at, created_at`,
      [seeded.assessmentId, owner.organisationId, owner.userId],
    );
    const days = Math.round(
      (new Date(rows[0]!.due_at).getTime() - new Date(rows[0]!.created_at).getTime()) / 86_400_000,
    );
    expect(days).toBe(14);
  });

  it('requires written reasons for every outcome, including a rejection', async () => {
    const seeded = await seedAssessment(db, owner);
    const { rows } = await db.query<{ id: string }>(
      `insert into public.appeals (assessment_id, organisation_id, submitted_by, grounds)
       values ($1, $2, $3, 'We disagree with the severity assigned to the third finding.')
       returning id`,
      [seeded.assessmentId, owner.organisationId, owner.userId],
    );
    await expect(
      db.query(`update public.appeals set status = 'rejected' where id = $1`, [rows[0]!.id]),
    ).rejects.toThrow(/resolution_needs_text/);
  });

  it('is visible to the workspace that raised it, and not to anyone else', async () => {
    const stranger = await seedAccount(db, 'governance-outsider');
    const seeded = await seedAssessment(db, owner);
    await db.query(
      `insert into public.appeals (assessment_id, organisation_id, submitted_by, grounds)
       values ($1, $2, $3, 'The scope statement does not match what we authorised.')`,
      [seeded.assessmentId, owner.organisationId, owner.userId],
    );
    const visible = await actingAs(db, { userId: stranger.userId }, async (client) => {
      const { rows } = await client.query(
        'select id from public.appeals where organisation_id = $1',
        [owner.organisationId],
      );
      return rows.length;
    });
    expect(visible).toBe(0);
  });

  it('cannot be resolved by the customer who raised it', async () => {
    const seeded = await seedAssessment(db, owner);
    const { rows } = await db.query<{ id: string }>(
      `insert into public.appeals (assessment_id, organisation_id, submitted_by, grounds)
       values ($1, $2, $3, 'We would like this finding removed from the published report.')
       returning id`,
      [seeded.assessmentId, owner.organisationId, owner.userId],
    );
    const message = await actingAs(db, { userId: owner.userId }, (client) =>
      expectRefusal(
        client,
        `update public.appeals set status = 'upheld', resolution = 'We agree with ourselves entirely.' where id = $1`,
        [rows[0]!.id],
      ),
    );
    expect(message === '' || /policy|permission/i.test(message)).toBe(true);
    const after = await db.query<{ status: string }>(
      'select status::text as status from public.appeals where id = $1',
      [rows[0]!.id],
    );
    expect(after.rows[0]!.status).toBe('open');
  });
});
