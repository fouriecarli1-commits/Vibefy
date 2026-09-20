/**
 * The request whose worker never came back.
 *
 * The quietest failure in the system, and it had no mechanism at all. A worker
 * killed between claiming a request and finishing it — a deploy, an
 * out-of-memory kill, a container moved — left the row at `claimed` for ever.
 * Nothing retried it, nothing alerted on it, and the console went on showing
 * the customer "in progress" until somebody thought to ask.
 *
 * It was worse than one lost run. The re-assessment sweep skips any application
 * that already has a queued or claimed request, so one stranded row stopped
 * that application ever being re-checked again: its badge stayed live, drift
 * was never looked for, and the mark went on standing for a claim nobody was
 * testing any more.
 *
 * The margin is the safety argument and is tested as such. A claim is not held
 * by a lock once the claiming transaction commits, so reclaiming one whose
 * worker is still alive would run the assessment twice and charge for both.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { RECLAIM_AFTER_MINUTES, reclaimStaleRequests } from '../apps/worker/src/queue.ts';
import { SHUTDOWN_GRACE_MS } from '../apps/worker/src/main.ts';
import { DEFAULT_CEILING } from '../packages/engine/src/index.ts';
import { connect } from './setup/client.ts';
import {
  seedAccount,
  seedApp,
  seedAuthorisation,
  seedRubric,
  type SeededAccount,
} from './setup/seed.ts';

let db: Client;
let owner: SeededAccount;

/**
 * Every case runs inside a transaction that is rolled back.
 *
 * Not tidiness. `tests/queue.test.ts` claims *the oldest queued request* and
 * asserts it got its own, so a row left behind here in `queued` is a row that
 * file claims instead — and the failure lands over there, in a suite that
 * changed nothing, on whichever run the file order happened to go the wrong
 * way. It cost twelve failures once and passed on the three runs after it,
 * which is the worst way to find out.
 */
async function inRollback<T>(work: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    return await work();
  } finally {
    await db.query('rollback');
  }
}

/** A request in a given state, claimed a given number of minutes ago. */
async function seedRequest(options: {
  status: string;
  claimedMinutesAgo?: number | null;
  attempts?: number;
}): Promise<string> {
  const appId = await seedApp(db, owner, 'Stranded');
  await seedAuthorisation(db, owner, appId);
  const { rows } = await db.query<{ id: string }>(
    `insert into public.assessment_requests
       (app_id, organisation_id, requested_by, depth, status, plan_at_request,
        max_run_cost_usd, attempts, claimed_at)
     values ($1, $2, $3, 'limited', $4::public.request_status, 'free', 4.00, $5,
             case when $6::int is null then null else now() - make_interval(mins => $6::int) end)
     returning id`,
    [
      appId,
      owner.organisationId,
      owner.userId,
      options.status,
      options.attempts ?? 1,
      options.claimedMinutesAgo ?? null,
    ],
  );
  return rows[0]!.id;
}

async function stateOf(id: string) {
  const { rows } = await db.query<{ status: string; last_error: string | null; attempts: number }>(
    'select status, last_error, attempts from public.assessment_requests where id = $1',
    [id],
  );
  return rows[0]!;
}

beforeAll(async () => {
  db = await connect();
  owner = await seedAccount(db, 'stranded-owner');
  await seedRubric(db);
});

afterAll(async () => {
  await db?.end();
});

describe('what gets reclaimed', () => {
  it('requeues a claim older than the margin', async () => {
    await inRollback(async () => {
      const id = await seedRequest({ status: 'claimed', claimedMinutesAgo: 120, attempts: 1 });
      const result = await reclaimStaleRequests(db as never);
      expect(result.requeued).toBeGreaterThanOrEqual(1);

      const after = await stateOf(id);
      expect(after.status).toBe('queued');
      expect(after.last_error).toMatch(/stopped without finishing/i);
    });
  });

  it('says why, so the row is not a mystery to whoever finds it', async () => {
    await inRollback(async () => {
      const id = await seedRequest({ status: 'claimed', claimedMinutesAgo: 120, attempts: 1 });
      await reclaimStaleRequests(db as never);
      expect((await stateOf(id)).last_error).toMatch(/Requeued after 90 minutes/);
    });
  });

  it('gives up on one that has used its attempts, rather than cycling', async () => {
    await inRollback(async () => {
      // A worker that dies on every attempt would otherwise requeue for ever,
      // and a row that can never move is indistinguishable from one that is
      // about to.
      const id = await seedRequest({ status: 'claimed', claimedMinutesAgo: 200, attempts: 3 });
      const result = await reclaimStaleRequests(db as never);
      expect(result.abandoned).toBeGreaterThanOrEqual(1);

      const after = await stateOf(id);
      expect(after.status).toBe('failed');
      expect(after.last_error).toMatch(/no attempts left/i);
      expect(after.last_error).toMatch(/Nothing was charged/i);
    });
  });
});

describe('what is left alone', () => {
  it('does not touch a claim that could still be running', async () => {
    await inRollback(async () => {
      // The whole safety argument. A claim is not held by a lock once the
      // claiming transaction commits, so reclaiming one whose worker is alive
      // runs the assessment twice and charges for both.
      const id = await seedRequest({ status: 'claimed', claimedMinutesAgo: 20, attempts: 1 });
      await reclaimStaleRequests(db as never);
      expect((await stateOf(id)).status).toBe('claimed');
    });
  });

  it('leaves the margin comfortably above the longest a run may take', () => {
    // If a run could outlast the margin, the margin is a way of running things
    // twice rather than a way of recovering them.
    const longestRunMinutes = DEFAULT_CEILING.maxDurationSeconds / 60;
    expect(RECLAIM_AFTER_MINUTES).toBeGreaterThanOrEqual(longestRunMinutes * 2);
  });

  // `refused` is left out: the schema will not accept one without a refusal
  // reason, which is a different rule doing its job and not this one's business.
  it.each(['queued', 'completed', 'failed', 'cancelled'])(
    'does not touch a %s request',
    async (status) => {
      await inRollback(async () => {
        const id = await seedRequest({ status, claimedMinutesAgo: 500, attempts: 1 });
        await reclaimStaleRequests(db as never);
        expect((await stateOf(id)).status).toBe(status);
      });
    },
  );

  it('does not touch a claim with no claimed_at at all', async () => {
    await inRollback(async () => {
      // Not a state the queue produces, and not one to guess about: a null is
      // not older than anything, and treating it as stale would be inventing a
      // fact about a row we do not understand.
      const id = await seedRequest({ status: 'claimed', claimedMinutesAgo: null });
      await reclaimStaleRequests(db as never);
      expect((await stateOf(id)).status).toBe('claimed');
    });
  });
});

describe('the worker runs it', () => {
  it('is on the monitoring beat, under the same guard as the rest', () => {
    const main = readFileSync(join(process.cwd(), 'apps/worker/src/main.ts'), 'utf8');
    expect(main).toContain('reclaimStaleRequests');
    expect(main).toMatch(/once\('reclaim'/);
  });
});

describe('the worker does not run two of the same sweep at once', () => {
  /*
   * `setInterval` does not wait for the last tick to finish, and the monitoring
   * beat pings every customer's application — so on a slow morning a second
   * sweep starts while the first is still going.
   *
   * Every sweep is idempotent, which is not the same thing as safe to run twice
   * at once: two runs can both read a row as un-acted-on before either writes,
   * and then both act. That is a second re-assessment somebody pays for.
   */
  const main = readFileSync(join(process.cwd(), 'apps/worker/src/main.ts'), 'utf8');

  it('puts every sweep behind the same guard', () => {
    // A sweep called directly is one that can overlap, and it would be the one
    // nobody thought about.
    const direct = [...main.matchAll(/^\s*void sweep\w+\(/gm)].map((match) => match[0].trim());
    expect(direct, `Sweeps not behind the guard: ${direct.join(', ')}`).toEqual([]);
    expect((main.match(/once\('/g) ?? []).length).toBeGreaterThanOrEqual(13);
  });

  it('skips rather than queues, and says it skipped', () => {
    // A backlog of sweeps waiting their turn is a way of falling further
    // behind. The next tick picks it up.
    expect(main).toMatch(/sweep still running, skipping this tick/);
  });

  it('still logs a sweep that throws, under its own name', () => {
    expect(main).toMatch(/\$\{name\} sweep failed/);
  });
});

describe('shutting down does not end the pool under a running query', () => {
  const main = readFileSync(join(process.cwd(), 'apps/worker/src/main.ts'), 'utf8');

  it('waits for what is in flight, up to a bounded grace', () => {
    // It used to set a flag and close the pool in the same breath, which turned
    // a tidy shutdown into a half-written assessment.
    expect(main).toMatch(/Promise\.race\(\[\s*loopFinished/);
    expect(main).toContain('SHUTDOWN_GRACE_MS');
  });

  it('keeps the grace in seconds, not minutes', () => {
    // A platform gives about thirty seconds before it kills the process, and an
    // assessment may still have twenty-nine minutes to run. Waiting for one
    // means being killed mid-write anyway, having blocked the shutdown for
    // nothing — what does not finish is recovered by the reclaim sweep.
    expect(SHUTDOWN_GRACE_MS).toBeLessThanOrEqual(30_000);
    expect(SHUTDOWN_GRACE_MS).toBeGreaterThan(0);
  });
});
