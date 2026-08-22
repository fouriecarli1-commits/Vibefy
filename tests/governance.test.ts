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
} from '../apps/worker/src/governance.ts';
import { processNextRequest } from '../apps/worker/src/index.ts';
import { actingAs, connect, expectRefusal } from './setup/client.ts';
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
  const dsn = new URL(process.env.VIBEFY_TEST_DSN!);
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
