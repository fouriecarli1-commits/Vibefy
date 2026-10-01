/**
 * The statutory clock, said once a day rather than every five minutes.
 *
 * `sweepGovernanceDeadlines` logs a line per overdue data-subject request and
 * per overdue appeal, unconditionally, and it rides the five-minute monitoring
 * beat. A request that goes overdue and stays overdue — which is what overdue
 * means, since it stays that way until a person handles it — produced **288
 * identical lines a day**, for ever.
 *
 * This file already decided this question, for spend, and wrote down why:
 *
 *     Logging them unconditionally meant the same sentence a few hundred times
 *     over, which is not a louder warning than one sentence; it is a quieter
 *     one, because the line that matters next is now buried under it.
 *
 * That reasoning was applied to `spend alert` and not to the two lines beneath
 * it, which is the worse omission of the two. Spend has a dashboard somebody
 * looking at spend is already on. An overdue POPIA or GDPR request has a
 * statutory deadline, no second surface, and this log is how an operator finds
 * out — so it is precisely the line that must not be buried, and it was the one
 * doing the burying.
 *
 * Keyed by the row's own id and by UTC day, not by the sweep: each overdue thing
 * is named once a day, every day it stays overdue, because the clock keeps
 * running and silence after one mention would be the opposite defect. The
 * counts in the returned result are unchanged and still every pass — those are
 * what callers and tests read, and a count is not a sentence somebody has to
 * re-read.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { sweepGovernanceDeadlines, resetDeadlineNotices } from '../apps/worker/src/governance.ts';
import { Pool } from 'pg';
import { connect } from './setup/client.ts';
import { seedAccount, type SeededAccount } from './setup/seed.ts';

let db: Client;
let pool: Pool;
let account: SeededAccount;

const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  db = await connect();
  const dsn = new URL(process.env.VIBEFYCODE_TEST_DSN!);
  pool = new Pool({
    host: dsn.searchParams.get('host')!,
    database: dsn.pathname.slice(1),
    user: 'postgres',
  });
  account = await seedAccount(db, 'overdue-clock');

  // One request, already past its deadline. `set_request_deadline` fills
  // `due_at` on insert, so it is written explicitly here.
  await db.query(
    `insert into public.data_requests (user_id, organisation_id, request_type, due_at)
     values ($1, $2, 'access', now() - interval '3 days')`,
    [account.userId, account.organisationId],
  );
});

afterAll(async () => {
  resetDeadlineNotices();
  await pool?.end();
  await db?.end();
});

function linesFrom(runs: { message: string }[][]): string[] {
  return runs.flat().map((entry) => entry.message);
}

async function sweep(now: Date): Promise<{ message: string }[]> {
  const said: { message: string }[] = [];
  await sweepGovernanceDeadlines(pool, (message) => said.push({ message }), now);
  return said;
}

describe('an overdue request that stays overdue', () => {
  it('is named once, not on every pass', async () => {
    resetDeadlineNotices();
    const noon = new Date('2026-10-01T12:00:00.000Z');

    const first = await sweep(noon);
    const second = await sweep(new Date(noon.getTime() + 5 * 60_000));
    const third = await sweep(new Date(noon.getTime() + 10 * 60_000));

    expect(first.filter((e) => /overdue/i.test(e.message))).not.toHaveLength(0);
    expect(linesFrom([second, third]).filter((m) => /overdue/i.test(m))).toEqual([]);
  });

  it('is named again the next day, because the clock is still running', async () => {
    // The opposite defect, and the one a naive fix produces: said once ever, so
    // a deadline nobody acted on goes quiet and looks handled.
    resetDeadlineNotices();
    const today = new Date('2026-10-01T12:00:00.000Z');

    await sweep(today);
    const tomorrow = await sweep(new Date(today.getTime() + DAY));

    expect(tomorrow.filter((e) => /overdue/i.test(e.message))).not.toHaveLength(0);
  });

  it('still counts every pass, because a count is not a sentence', async () => {
    resetDeadlineNotices();
    const noon = new Date('2026-10-01T12:00:00.000Z');

    const first = await sweepGovernanceDeadlines(pool, () => undefined, noon);
    const second = await sweepGovernanceDeadlines(
      pool,
      () => undefined,
      new Date(noon.getTime() + 5 * 60_000),
    );

    expect(first.overdueRequests).toBeGreaterThanOrEqual(1);
    expect(second.overdueRequests).toBe(first.overdueRequests);
  });
});
