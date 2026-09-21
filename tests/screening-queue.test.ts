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
import {
  NotAuthorisedError,
  runAssessmentJob,
  sweepIntakeScreening,
  type ScreeningModelFactory,
} from '../apps/worker/src/index.ts';
import { ModelClient, type ModelTransport } from '../packages/engine/src/index.ts';
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

/**
 * The same, with enough written at intake for the judgement pass to reach.
 *
 * `deterministicScreen` answers `needs_human_review` on its own when the
 * description is too short to judge, and never consults the model — which is
 * right, and means a test about the model pass that skips this is testing the
 * short-circuit instead and passing for the wrong reason.
 */
async function described(text: string): Promise<string> {
  const appId = await unscreened();
  await db.query('update public.apps set description = $2 where id = $1', [appId, text]);
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

describe('the automated pass', () => {
  /**
   * A model that gives the same answer every time, and never reaches a network.
   *
   * Not `ScriptedTransport`, which holds a fixed list of steps: the sweep reads
   * every pending application in the database, including the ones other tests
   * in this file left behind, so a transport with one step answers the first
   * and throws for the rest. That made an earlier version of these tests pass
   * for the wrong reason — the application under test was never the one the
   * single step went to.
   */
  function scripted(verdict: Record<string, unknown>): ScreeningModelFactory {
    const transport: ModelTransport = {
      name: 'always-says',
      async send() {
        return {
          content: [{ type: 'text', text: JSON.stringify(verdict), citations: [] }],
          stopReason: 'end_turn',
          usage: { inputTokens: 900, outputTokens: 120 },
          parsed: verdict,
        };
      },
    };
    return (meter) => new ModelClient(transport, meter);
  }

  it('takes a benign submission out of the reviewer queue', async () => {
    const appId = await described(
      'A shop that sells kettles. Customers browse, add to a basket and pay by card.',
    );

    const outcome = await sweepIntakeScreening(
      pool,
      scripted({
        verdict: 'cleared',
        category: null,
        confidence: 'high',
        quotedBasis: 'A shop that sells kettles.',
        reasoning: 'An ordinary retail site; nothing in the submission touches the policy.',
      }),
      undefined,
      50,
    );
    expect(outcome.cleared).toBeGreaterThanOrEqual(1);

    const { rows } = await db.query<{ status: string; notes: string }>(
      'select screening_status::text as status, screening_notes as notes from public.apps where id = $1',
      [appId],
    );
    expect(rows[0]!.status).toBe('cleared');
    expect(rows[0]!.notes).toMatch(/Automatic screen/);
  });

  it('cannot refuse anybody, however sure it is', async () => {
    // The asymmetry is the whole design. A wrongly refused customer is a real
    // harm; a wrongly queued one waits an hour. So the pass may shorten the
    // queue and may never end a business, and what enforces that is that
    // `record_automated_screening` takes no verdict at all.
    const appId = await described(
      'A landing page that looks like a bank sign-in so we can study how people behave.',
    );
    const outcome = await sweepIntakeScreening(
      pool,
      scripted({
        verdict: 'refused',
        category: 'phishing_or_credential_harvesting',
        confidence: 'high',
        quotedBasis: 'capture their logins',
        reasoning: 'The stated purpose is credential harvesting.',
      }),
      undefined,
      50,
    );
    expect(outcome.cleared).toBe(0);
    expect(outcome.leftForAPerson).toBeGreaterThanOrEqual(1);

    const { rows } = await db.query<{ status: string; notes: string }>(
      'select screening_status::text as status, screening_notes as notes from public.apps where id = $1',
      [appId],
    );
    expect(rows[0]!.status, 'a machine may not refuse a customer').toBe('pending');
    // And the reviewer opens the queue already knowing what it thought.
    expect(rows[0]!.notes).toMatch(/credential harvesting/);
    expect(rows[0]!.notes).toMatch(/capture their logins/);
  });

  it('will not overturn a decision a reviewer already took', async () => {
    const appId = await unscreened();
    await committingAs(db, { userId: reviewer.userId }, async (client) => {
      await client.query('select public.record_screening_decision($1, $2, $3)', [
        appId,
        'refused',
        'Impersonates a payment provider, by its own description.',
      ]);
    });

    const { rows } = await db.query<{ record: boolean }>(
      'select public.record_automated_screening($1, $2) as record',
      [appId, 'On reflection this looks perfectly ordinary to me.'],
    );
    expect(rows[0]!.record, 'refused to act, rather than acting wrongly').toBe(false);

    const after = await db.query<{ status: string }>(
      'select screening_status::text as status from public.apps where id = $1',
      [appId],
    );
    expect(after.rows[0]!.status).toBe('refused');
  });

  it('writes down what it spent, because the daily cap reads the ledger', async () => {
    const spender = await seedAccount(db, 'screening-spender');
    const appId = await seedApp(db, spender, 'Kettle', { screening: 'pending' });
    await db.query('update public.apps set description = $2 where id = $1', [
      appId,
      'A shop that sells kettles, with a basket and a card payment step.',
    ]);
    await sweepIntakeScreening(
      pool,
      scripted({
        verdict: 'cleared',
        category: null,
        confidence: 'medium',
        quotedBasis: 'a kettle shop',
        reasoning: 'Nothing here touches the policy.',
      }),
      undefined,
      50,
    );

    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.cost_records
        where organisation_id = $1 and assessment_id is null and purpose = 'assessment'`,
      [spender.organisationId],
    );
    expect(
      rows[0]!.n,
      'screening happens before there is an assessment to bill it to',
    ).toBeGreaterThan(0);
    expect(appId).toBeTruthy();
  });

  it('does nothing at all when this process holds no key', async () => {
    const appId = await unscreened();
    const outcome = await sweepIntakeScreening(pool, null, undefined, 50);
    expect(outcome).toEqual({ considered: 0, cleared: 0, leftForAPerson: 0 });

    const { rows } = await db.query<{ status: string }>(
      'select screening_status::text as status from public.apps where id = $1',
      [appId],
    );
    expect(rows[0]!.status, 'every submission waits for a person, which is safe').toBe('pending');
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
