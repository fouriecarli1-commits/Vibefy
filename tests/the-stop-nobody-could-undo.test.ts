/**
 * The half of the spend cap that was never built.
 *
 * `sweepSpendCap` writes a `spend_pauses` row when the day crosses the global
 * ceiling, and the worker claims no new work while one is live. The table has
 * carried the other half since the first migration — `lifted_at`, `lifted_by`,
 * `lift_reason`, with a constraint requiring a reason of real length — and
 * nothing ever wrote them. Its own comment says "lifting one requires a written
 * reason and is kept".
 *
 * The grant on that table is `select`, so not even an administrator could clear
 * a pause from the console. A platform that stops itself and cannot be started
 * again from inside the product is a platform whose outage ends when somebody
 * who knows SQL is awake — and this product's founder says plainly that she
 * does not know where a SQL statement should begin.
 *
 * The automatic half stays automatic and the lift stays deliberate, which is
 * the way round `spend.ts` argues for: an alert a human must act on while
 * spending continues is how a capped system produces an uncapped bill.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import {
  SHORTEST_LIFT_REASON,
  liftLivePause,
  whyALiftIsRefused,
} from '../apps/web/lib/spend-pause.ts';
import { connect } from './setup/client.ts';
import { seedAccount, type SeededAccount } from './setup/seed.ts';
import { commentsBlanked } from './setup/source.ts';

let db: Client;
let admin: SeededAccount;

beforeAll(async () => {
  db = await connect();
  admin = await seedAccount(db, 'spend-lift');
});

afterAll(async () => {
  await db?.end();
});

beforeEach(async () => {
  // One pause can be live at a time, by a unique index. Each case starts from
  // nothing live.
  await db.query('delete from public.spend_pauses');
});

async function pause(): Promise<void> {
  await db.query(
    `insert into public.spend_pauses (reason, observed_usd, ceiling_usd)
     values ('Global spend today reached the daily ceiling.', 101, 100)`,
  );
}

const paused = async () =>
  (await db.query<{ paused: boolean }>('select public.spending_is_paused() as paused')).rows[0]!
    .paused;

describe('lifting the stop', () => {
  it('starts the platform again, and keeps who said so and why', async () => {
    await pause();
    expect(await paused(), 'the fixture did not pause anything').toBe(true);

    const { lifted } = await liftLivePause(db, {
      userId: admin.userId,
      reason: 'Ceiling raised for the launch week, agreed beforehand.',
    });
    expect(lifted).toBe(1);
    expect(await paused(), 'the worker would still refuse to claim anything').toBe(false);

    const { rows } = await db.query<{
      lifted_by: string;
      lift_reason: string;
      lifted_at: string | null;
    }>('select lifted_by, lift_reason, lifted_at from public.spend_pauses');
    expect(rows[0]!.lifted_by).toBe(admin.userId);
    expect(rows[0]!.lift_reason).toMatch(/launch week/);
    expect(rows[0]!.lifted_at).not.toBeNull();
  });

  it('keeps the row rather than deleting it', async () => {
    // The record is the point. A pause that is lifted by being removed leaves
    // nobody able to say the platform ever stopped.
    await pause();
    await liftLivePause(db, {
      userId: admin.userId,
      reason: 'Checked the figures; they are ours.',
    });
    const { rows } = await db.query<{ n: number }>(
      'select count(*)::int as n from public.spend_pauses',
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('refuses a reason too short to be read later', async () => {
    await pause();
    await expect(liftLivePause(db, { userId: admin.userId, reason: 'ok' })).rejects.toThrow(
      /at least/i,
    );
    expect(await paused(), 'a refused lift lifted it anyway').toBe(true);
  });

  it('refuses an empty reason before the database has to', async () => {
    /*
     * `spend_lift_needs_reason` would refuse it too, and what Postgres says
     * about a violated check constraint is not a sentence to put in front of
     * somebody who has just stopped an outage.
     */
    expect(whyALiftIsRefused('')).toMatch(/say why/i);
    expect(whyALiftIsRefused('  ')).toMatch(/say why/i);
    expect(whyALiftIsRefused('x'.repeat(SHORTEST_LIFT_REASON - 1))).toMatch(/at least/);
    expect(whyALiftIsRefused('x'.repeat(SHORTEST_LIFT_REASON))).toBeNull();
  });

  it('says nothing was live rather than claiming a lift', async () => {
    // Somebody else may have lifted it, or the sweep may have found the day's
    // spend back under the ceiling. Reporting a lift for that is a lie in the
    // direction that stops anybody looking.
    const { lifted } = await liftLivePause(db, {
      userId: admin.userId,
      reason: 'Nothing was paused when this ran.',
    });
    expect(lifted).toBe(0);
  });

  it('is aimed at the live pause, not at an id somebody held', async () => {
    // A lift aimed at an id could be aimed at a pause already lifted, and
    // report success for doing nothing. The condition is the same one
    // `spending_is_paused()` reads.
    const lib = commentsBlanked(readFileSync('apps/web/lib/spend-pause.ts', 'utf8'));
    expect(lib).toMatch(/where lifted_at is null/);
    expect(lib).not.toMatch(/where id = /);
  });
});

describe('who may press it', () => {
  const action = commentsBlanked(readFileSync('apps/web/app/admin/health/actions.ts', 'utf8'));

  it('refuses anybody who is not signed in', () => {
    expect(action).toMatch(/You are signed out/);
  });

  it('calls the write by name, or the two checks below prove nothing', () => {
    // Both of them measure what comes before the write. A rename would make
    // the slice empty and the assertions vacuous.
    expect(action).toContain('await writeAsService(');
  });

  it('refuses anybody who is not an administrator', () => {
    expect(action).toMatch(/platform_role !== 'admin'/);
    const beforeWrite = action.slice(0, action.indexOf('await writeAsService('));
    expect(beforeWrite, 'the write happens before the role is read').toMatch(/platform_role/);
  });

  it('asks for the second step, like the review actions do', () => {
    // This one restarts spending across the whole platform.
    expect(action).toMatch(/sessionPassedSecondStep\(\)/);
    const beforeWrite = action.slice(0, action.indexOf('await writeAsService('));
    expect(beforeWrite).toMatch(/sessionPassedSecondStep/);
  });

  it('takes who lifted it from the session, never from the form', () => {
    expect(action).toMatch(/userId: user\.id/);
    const fields = action.match(/formData\.get\('([^']+)'\)/g) ?? [];
    expect(fields, 'the form may carry the reason and nothing else').toEqual([
      "formData.get('reason')",
    ]);
  });

  it('leaves the statement on the page, so a refusal is not a dead end', () => {
    // The button needs a second step and a service-role connection. Neither is
    // guaranteed at three in the morning, and the platform is stopped.
    const page = commentsBlanked(readFileSync('apps/web/app/admin/health/page.tsx', 'utf8'));
    expect(page).toMatch(/update public\.spend_pauses set lifted_at = now\(\)/);
    expect(page).toMatch(/<LiftPauseForm \/>/);
  });
});
