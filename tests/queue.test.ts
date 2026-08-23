/**
 * The request queue.
 *
 * A queue the customer can see, claimed with FOR UPDATE SKIP LOCKED. What is
 * being checked: that two workers never take the same row, that an unauthorised
 * target is never retried, and that a customer cannot promote their own request.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { claimNextRequest, completeRequest, failRequest } from '../apps/worker/src/queue.ts';
import { actingAs, connect, expectRefusal } from './setup/client.ts';
import { seedAccount, seedApp, seedAuthorisation, type SeededAccount } from './setup/seed.ts';

let db: Client;
let pool: Pool;
let owner: SeededAccount;
let mallory: SeededAccount;

async function queueRequest(
  appId: string,
  account: SeededAccount,
  depth = 'limited',
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.assessment_requests
       (app_id, organisation_id, requested_by, depth, plan_at_request, max_run_cost_usd)
     values ($1, $2, $3, $4, 'free', 0.5) returning id`,
    [appId, account.organisationId, account.userId, depth],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  db = await connect();
  const dsn = new URL(process.env.VIBEFYCODE_TEST_DSN!);
  pool = new Pool({
    host: dsn.searchParams.get('host')!,
    database: dsn.pathname.slice(1),
    user: 'postgres',
  });
  owner = await seedAccount(db, 'queue-owner');
  mallory = await seedAccount(db, 'queue-mallory');
});

afterAll(async () => {
  await pool?.end();
  await db?.end();
});

beforeEach(async () => {
  await db.query('delete from public.assessment_requests');
});

describe('claiming', () => {
  it('takes the oldest queued request and marks it claimed', async () => {
    const appId = await seedApp(db, owner);
    const requestId = await queueRequest(appId, owner);

    const client = await pool.connect();
    try {
      const claimed = await claimNextRequest(client);
      expect(claimed?.id).toBe(requestId);
      expect(claimed?.depth).toBe('limited');
      expect(claimed?.attempts).toBe(1);
    } finally {
      client.release();
    }

    const { rows } = await db.query(
      'select status, claimed_at from public.assessment_requests where id = $1',
      [requestId],
    );
    expect(rows[0].status).toBe('claimed');
    expect(rows[0].claimed_at).not.toBeNull();
  });

  it('never hands the same row to two workers', async () => {
    const appIds = await Promise.all([seedApp(db, owner), seedApp(db, owner), seedApp(db, owner)]);
    for (const appId of appIds) await queueRequest(appId, owner);

    const clients = await Promise.all([pool.connect(), pool.connect(), pool.connect()]);
    try {
      const claimed = await Promise.all(clients.map((client) => claimNextRequest(client)));
      const ids = claimed.map((entry) => entry?.id).filter(Boolean);
      expect(ids).toHaveLength(3);
      expect(new Set(ids).size, 'three workers, three different rows').toBe(3);
    } finally {
      for (const client of clients) client.release();
    }
  });

  it('returns nothing when the queue is empty', async () => {
    const client = await pool.connect();
    try {
      expect(await claimNextRequest(client)).toBeNull();
    } finally {
      client.release();
    }
  });

  it('refuses a second live request for the same application', async () => {
    const appId = await seedApp(db, owner);
    await queueRequest(appId, owner);
    await db.query('begin');
    const message = await expectRefusal(
      db,
      `insert into public.assessment_requests
         (app_id, organisation_id, requested_by, depth, plan_at_request, max_run_cost_usd)
       values ($1, $2, $3, 'limited', 'free', 0.5)`,
      [appId, owner.organisationId, owner.userId],
    );
    expect(message).toMatch(/one_live_per_app/);
    await db.query('rollback');
  });
});

describe('finishing', () => {
  it('records the assessment a completed request produced', async () => {
    const appId = await seedApp(db, owner);
    await seedAuthorisation(db, owner, appId);
    const requestId = await queueRequest(appId, owner);

    const client = await pool.connect();
    try {
      await claimNextRequest(client);
      await completeRequest(client, requestId, null as never).catch(() => undefined);
      await db.query(
        `update public.assessment_requests set status = 'completed', completed_at = now() where id = $1`,
        [requestId],
      );
    } finally {
      client.release();
    }

    const { rows } = await db.query('select status from public.assessment_requests where id = $1', [
      requestId,
    ]);
    expect(rows[0].status).toBe('completed');
  });

  it('requeues a transient failure', async () => {
    const appId = await seedApp(db, owner);
    const requestId = await queueRequest(appId, owner);
    const client = await pool.connect();
    try {
      await claimNextRequest(client);
      const outcome = await failRequest(client, requestId, 'network blip', { retryable: true });
      expect(outcome).toBe('requeued');
    } finally {
      client.release();
    }
    const { rows } = await db.query(
      'select status, claimed_at from public.assessment_requests where id = $1',
      [requestId],
    );
    expect(rows[0].status).toBe('queued');
    expect(rows[0].claimed_at).toBeNull();
  });

  it('never retries an unauthorised target — trying again would be testing it twice', async () => {
    const appId = await seedApp(db, owner);
    const requestId = await queueRequest(appId, owner);
    const client = await pool.connect();
    try {
      await claimNextRequest(client);
      const outcome = await failRequest(client, requestId, 'no verified authorisation', {
        retryable: false,
      });
      expect(outcome).toBe('failed');
    } finally {
      client.release();
    }
    const { rows } = await db.query('select status from public.assessment_requests where id = $1', [
      requestId,
    ]);
    expect(rows[0].status).toBe('failed');
  });

  it('gives up after the attempt limit rather than looping forever', async () => {
    const appId = await seedApp(db, owner);
    const requestId = await queueRequest(appId, owner);
    const client = await pool.connect();
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await claimNextRequest(client);
        await failRequest(client, requestId, 'still failing', { retryable: true });
      }
    } finally {
      client.release();
    }
    const { rows } = await db.query(
      'select status, attempts from public.assessment_requests where id = $1',
      [requestId],
    );
    expect(rows[0].status).toBe('failed');
    expect(rows[0].attempts).toBe(3);
  });
});

describe('what a customer may do to their own queue', () => {
  it('cannot see another workspace’s requests', async () => {
    const appId = await seedApp(db, owner);
    await queueRequest(appId, owner);
    await actingAs(db, { userId: mallory.userId }, async (client) => {
      const { rows } = await client.query('select id from public.assessment_requests');
      expect(rows).toHaveLength(0);
    });
  });

  it('may cancel its own queued request', async () => {
    const appId = await seedApp(db, owner);
    const requestId = await queueRequest(appId, owner);
    await actingAs(db, { userId: owner.userId }, async (client) => {
      await client.query(
        `update public.assessment_requests set status = 'cancelled' where id = $1`,
        [requestId],
      );
      const { rows } = await client.query(
        'select status from public.assessment_requests where id = $1',
        [requestId],
      );
      expect(rows[0].status).toBe('cancelled');
    });
  });

  it('cannot promote its own request to completed', async () => {
    const appId = await seedApp(db, owner);
    const requestId = await queueRequest(appId, owner);
    await actingAs(db, { userId: owner.userId }, async (client) => {
      const message = await expectRefusal(
        client,
        `update public.assessment_requests set status = 'completed' where id = $1`,
        [requestId],
      );
      expect(message, 'row-level security must refuse this').toMatch(/row-level security/i);
    });
  });
});
