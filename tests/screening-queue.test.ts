/**
 * The human check the application page promises.
 *
 * `screenIntake` refuses what its deterministic filter catches and sends
 * everything else to `needs_human_review`, which the console records as
 * `screening_status = 'pending'`. The application page then tells the customer,
 * in as many words, "A reviewer confirms every submission before an assessment
 * runs."
 *
 * Nothing did. `refused` was blocked in the console and the worker; `pending`
 * went straight past both, there was no screen a reviewer could work, and the
 * judgement pass is not wired up — so every application ever created sat in the
 * state that was supposed to require a person, and none of them got one.
 *
 * What is checked here is the whole of that promise: nothing runs against an
 * unscreened application, only a reviewer can change that, the decision has to
 * say why, and it cannot be taken quietly.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { NotAuthorisedError, runAssessmentJob } from '../apps/worker/src/index.ts';
import { actingAs, committingAs, connect, expectRefusal } from './setup/client.ts';
import {
  makeReviewer,
  seedAccount,
  seedApp,
  seedAuthorisation,
  type SeededAccount,
} from './setup/seed.ts';

let db: Client;
let pool: Pool;
let owner: SeededAccount;
let reviewer: SeededAccount;
let stranger: SeededAccount;

beforeAll(async () => {
  db = await connect();
  const dsn = new URL(process.env.VIBEFYCODE_TEST_DSN!);
  pool = new Pool({
    host: dsn.searchParams.get('host')!,
    database: dsn.pathname.slice(1),
    user: 'postgres',
  });
  owner = await seedAccount(db, 'screening-owner');
  stranger = await seedAccount(db, 'screening-stranger');
  reviewer = await seedAccount(db, 'screening-reviewer');
  await makeReviewer(db, reviewer.userId);
});

afterAll(async () => {
  await pool?.end();
  await db?.end();
});

/** An application as the console creates one: authorised to test, not yet screened. */
async function unscreened(): Promise<string> {
  const appId = await seedApp(db, owner, 'Kettle', { screening: 'pending' });
  await seedAuthorisation(db, owner, appId);
  return appId;
}

describe('an application nobody has screened', () => {
  it('is not assessed, even with a verified authorisation in place', async () => {
    // The authorisation gate and the screening gate answer different questions.
    // Proving you own the thing does not establish that we are willing to test
    // it, and this application passes the first and not the second.
    const appId = await unscreened();
    const { rows } = await db.query<{ ok: boolean }>(
      'select public.app_is_authorised_for_testing($1) as ok',
      [appId],
    );
    expect(rows[0]!.ok, 'the authorisation gate is open').toBe(true);

    await expect(
      runAssessmentJob({ appId, depth: 'limited', requestedBy: owner.userId }, { pool }),
    ).rejects.toThrow(NotAuthorisedError);
    await expect(
      runAssessmentJob({ appId, depth: 'limited', requestedBy: owner.userId }, { pool }),
    ).rejects.toThrow(/not been screened by a person/);
  });

  it('runs once a reviewer has cleared it', async () => {
    const appId = await unscreened();
    await committingAs(db, { userId: reviewer.userId }, async (client) => {
      await client.query('select public.record_screening_decision($1, $2, $3)', [
        appId,
        'cleared',
        'An ordinary shop front; nothing in the submission touches the policy.',
      ]);
    });

    // Not asserting a successful run — the fixture host does not resolve, so
    // what comes back is a run that failed on its own terms, which is a
    // different thing and a legitimate outcome. What is asserted is that the
    // screening gate is no longer the thing in the way.
    const outcome = await runAssessmentJob(
      { appId, depth: 'limited', requestedBy: owner.userId },
      { pool },
    ).catch((error: unknown) => error);
    expect(String(outcome)).not.toMatch(/not been screened by a person/);
  });
});

describe('who may take the decision', () => {
  it('refuses the customer who submitted it', async () => {
    // The one person with the strongest reason to clear it, and the one whose
    // own row-level access to the application is otherwise complete.
    const appId = await unscreened();
    const message = await actingAs(db, { userId: owner.userId }, (client) =>
      expectRefusal(client, 'select public.record_screening_decision($1, $2, $3)', [
        appId,
        'cleared',
        'I am quite sure my own application is fine, thank you.',
      ]),
    );
    expect(message).toMatch(/reviewer/i);

    const { rows } = await db.query<{ status: string }>(
      'select screening_status::text as status from public.apps where id = $1',
      [appId],
    );
    expect(rows[0]!.status).toBe('pending');
  });

  it('refuses a stranger', async () => {
    const appId = await unscreened();
    const message = await actingAs(db, { userId: stranger.userId }, (client) =>
      expectRefusal(client, 'select public.record_screening_decision($1, $2, $3)', [
        appId,
        'cleared',
        'Nothing to do with me, but it looks fine from here.',
      ]),
    );
    expect(message).toMatch(/reviewer/i);
  });
});

describe('what a decision has to carry', () => {
  it('will not record one without a reason', async () => {
    const appId = await unscreened();
    await expect(
      committingAs(db, { userId: reviewer.userId }, (client) =>
        client.query('select public.record_screening_decision($1, $2, $3)', [
          appId,
          'refused',
          'no',
        ]),
      ),
    ).rejects.toThrow(/say why/i);
  });

  it('will not record "pending" as a decision', async () => {
    // Pending is where a submission starts, not something anyone concludes.
    const appId = await unscreened();
    await expect(
      committingAs(db, { userId: reviewer.userId }, (client) =>
        client.query('select public.record_screening_decision($1, $2, $3)', [
          appId,
          'pending',
          'I would rather not say either way just now.',
        ]),
      ),
    ).rejects.toThrow(/cleared or refused/i);
  });

  it('writes its own audit line, with both sides of the change', async () => {
    const appId = await unscreened();
    await committingAs(db, { userId: reviewer.userId }, async (client) => {
      await client.query('select public.record_screening_decision($1, $2, $3)', [
        appId,
        'refused',
        'The description says the point is to capture other people’s logins.',
      ]);
    });

    const { rows } = await db.query<{
      action: string;
      actor_id: string;
      summary: string;
      before_state: { screening_status: string };
      after_state: { screening_status: string };
    }>(
      `select action, actor_id, summary, before_state, after_state
         from public.audit_log where entity_id = $1 and action like 'app.screening%'`,
      [appId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('app.screening_refused');
    expect(rows[0]!.actor_id).toBe(reviewer.userId);
    expect(rows[0]!.summary).toMatch(/capture other people/);
    expect(rows[0]!.before_state.screening_status).toBe('pending');
    expect(rows[0]!.after_state.screening_status).toBe('refused');
  });

  it('keeps refusing the application afterwards, on the refusal rather than the wait', async () => {
    const appId = await unscreened();
    await committingAs(db, { userId: reviewer.userId }, async (client) => {
      await client.query('select public.record_screening_decision($1, $2, $3)', [
        appId,
        'refused',
        'Impersonates a bank, by its own description.',
      ]);
    });
    await expect(
      runAssessmentJob({ appId, depth: 'limited', requestedBy: owner.userId }, { pool }),
    ).rejects.toThrow(/Acceptable Use Policy/);
  });
});
