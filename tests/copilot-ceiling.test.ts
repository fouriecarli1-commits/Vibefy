/**
 * The assistant's ceiling, measured rather than declared.
 *
 * A limit is only a limit if something can count what has been spent against
 * it. `cost_records` could say how much and for whom and never what for, so a
 * ceiling on the assistant was a number in a comment — there was no query that
 * could tell one of its rows from an assessment's.
 *
 * Two things are held here. The ledger can now separate them, which is what
 * makes the ceiling enforceable; and the cost-per-run figure the business is
 * steered by stops counting answered questions as more expensive assessments.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  COPILOT_CEILING_USD,
  COPILOT_CEILING_WINDOW_MINUTES,
} from '../packages/copilot/src/index.ts';
import { connect } from './setup/client.ts';
import { seedAccount, type SeededAccount } from './setup/seed.ts';

let db: Client;
let account: SeededAccount;

/** One row in the ledger, at a chosen age and purpose. */
async function spend(
  organisationId: string,
  purpose: 'assessment' | 'assistant',
  aiCostUsd: number,
  minutesAgo = 0,
): Promise<void> {
  await db.query(
    `insert into public.cost_records
       (assessment_id, organisation_id, model, input_tokens, output_tokens,
        cache_read_tokens, ai_cost_usd, purpose, recorded_at)
     values (null, $1, 'test-model', 100, 50, 0, $2, $3, now() - ($4 || ' minutes')::interval)`,
    [organisationId, aiCostUsd.toFixed(6), purpose, String(minutesAgo)],
  );
}

beforeAll(async () => {
  db = await connect();
});

afterAll(async () => {
  await db.end();
});

beforeEach(async () => {
  account = await seedAccount(db, 'copilot-ceiling');
});

describe('what the assistant has spent', () => {
  it('counts the assistant’s own rows and not the assessment’s', async () => {
    await spend(account.organisationId, 'assistant', 0.4);
    await spend(account.organisationId, 'assessment', 9);

    const { rows } = await db.query<{ spend: string }>(
      `select public.assistant_spend_since($1, now() - interval '1 hour') as spend`,
      [account.organisationId],
    );
    expect(Number(rows[0]!.spend)).toBeCloseTo(0.4, 6);
  });

  it('forgets spend older than the window, which is what makes it reset', async () => {
    // The sentence a customer sees says the limit resets within the hour. This
    // is the only thing that makes that sentence true.
    await spend(account.organisationId, 'assistant', 5, COPILOT_CEILING_WINDOW_MINUTES + 10);
    await spend(account.organisationId, 'assistant', 0.25, 1);

    const { rows } = await db.query<{ spend: string }>(
      `select public.assistant_spend_since($1, now() - ($2 || ' minutes')::interval) as spend`,
      [account.organisationId, String(COPILOT_CEILING_WINDOW_MINUTES)],
    );
    expect(Number(rows[0]!.spend)).toBeCloseTo(0.25, 6);
  });

  it('is one workspace’s spend, not everybody’s', async () => {
    const other = await seedAccount(db, 'copilot-ceiling-other');
    await spend(other.organisationId, 'assistant', COPILOT_CEILING_USD * 4);

    const { rows } = await db.query<{ spend: string }>(
      `select public.assistant_spend_since($1, now() - interval '1 hour') as spend`,
      [account.organisationId],
    );
    expect(Number(rows[0]!.spend)).toBe(0);
  });
});

describe('what the ledger says the money bought', () => {
  it('defaults to the assessment, so every row written before now stayed true', async () => {
    await db.query(
      `insert into public.cost_records
         (assessment_id, organisation_id, model, input_tokens, output_tokens, cache_read_tokens, ai_cost_usd)
       values (null, $1, 'test-model', 10, 5, 0, 0.01)`,
      [account.organisationId],
    );
    const { rows } = await db.query<{ purpose: string }>(
      `select purpose::text as purpose from public.cost_records
        where organisation_id = $1 order by recorded_at desc limit 1`,
      [account.organisationId],
    );
    expect(rows[0]!.purpose).toBe('assessment');
  });

  it('refuses a purpose nobody agreed on', async () => {
    // A purpose that could be any string is a purpose that will be three
    // spellings by Christmas, and a ceiling that silently stops matching.
    await expect(
      db.query(
        `insert into public.cost_records
           (assessment_id, organisation_id, model, input_tokens, output_tokens, cache_read_tokens, ai_cost_usd, purpose)
         values (null, $1, 'test-model', 10, 5, 0, 0.01, 'chat')`,
        [account.organisationId],
      ),
    ).rejects.toThrow();
  });

  it('reports the two separately, so cost-per-run stops counting conversations', async () => {
    await spend(account.organisationId, 'assessment', 2);
    await spend(account.organisationId, 'assistant', 0.5);

    const { rows } = await db.query<{
      assessment_cost_usd: string;
      assistant_cost_usd: string;
      total_cost_usd: string;
    }>(
      `select sum(assessment_cost_usd)::text as assessment_cost_usd,
              sum(assistant_cost_usd)::text  as assistant_cost_usd,
              sum(total_cost_usd)::text      as total_cost_usd
         from public.daily_spend`,
    );
    const row = rows[0]!;
    // The total still includes both — the assistant's spend is real money and
    // still counts against the cap. It is simply no longer averaged into what
    // an assessment costs.
    expect(Number(row.assessment_cost_usd)).toBeGreaterThanOrEqual(2);
    expect(Number(row.assistant_cost_usd)).toBeGreaterThanOrEqual(0.5);
    expect(Number(row.total_cost_usd)).toBeCloseTo(
      Number(row.assessment_cost_usd) + Number(row.assistant_cost_usd),
      6,
    );
  });
});
