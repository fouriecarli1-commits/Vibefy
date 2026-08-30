/**
 * Money spent by a run that never became an assessment.
 *
 * The daily spend cap reads `cost_records`, and `cost_records.assessment_id`
 * used to be mandatory — so the ledger could only see spend from runs that
 * persisted successfully. The failure mode that spends the most is a run that
 * finishes, costs real money, and then cannot be written down; that was
 * precisely the one the cap was blind to. It reported zero while the same
 * assessment was paid for three times over.
 *
 * These tests hold the fix in place: the cost lands, the global cap sees it,
 * and the free-tier budget sees it too rather than losing it to a join.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { recordUnattributedCost } from '../apps/worker/src/persist.ts';
import { connect } from './setup/client.ts';
import { seedAccount, type SeededAccount } from './setup/seed.ts';

let db: Client;
let account: SeededAccount;

const STAGES = {
  functional_exploration: {
    model: 'test-model',
    stage: 'functional_exploration',
    inputTokens: 1200,
    outputTokens: 340,
    cacheReadTokens: 0,
    aiCostUsd: 0.31,
    computeSeconds: 42.5,
    computeCostUsd: 0.02,
    storageBytes: 0,
    thirdPartyCalls: 0,
    thirdPartyCostUsd: 0,
  },
  adversarial_practicality: {
    model: 'test-model',
    stage: 'adversarial_practicality',
    inputTokens: 900,
    outputTokens: 210,
    cacheReadTokens: 0,
    aiCostUsd: 0.2,
    computeSeconds: 18,
    computeCostUsd: 0.0,
    storageBytes: 0,
    thirdPartyCalls: 0,
    thirdPartyCostUsd: 0,
  },
} as const;

/** What the incident actually cost, to the cent that matters. */
const TOTAL_USD = 0.53;

beforeAll(async () => {
  db = await connect();
});

afterAll(async () => {
  await db.end();
});

beforeEach(async () => {
  await db.query('delete from public.cost_records where assessment_id is null');
  account = await seedAccount(db, 'unattributed');
});

describe('recording spend with no assessment to attach it to', () => {
  it('writes one row per stage, with no assessment', async () => {
    const written = await recordUnattributedCost(db, {
      organisationId: account.organisationId,
      costByStage: STAGES,
    });
    expect(written).toBe(2);

    const { rows } = await db.query<{ n: string; total: string }>(
      `select count(*)::text as n, coalesce(sum(total_cost_usd), 0)::text as total
         from public.cost_records
        where assessment_id is null and organisation_id = $1`,
      [account.organisationId],
    );
    expect(Number(rows[0]!.n)).toBe(2);
    expect(Number(rows[0]!.total)).toBeCloseTo(TOTAL_USD, 2);
  });

  it('keeps the organisation even though the assessment is gone', async () => {
    // Unattributable spend is still someone's spend. `organisation_id` stays
    // mandatory precisely so this cannot become anonymous.
    await expect(
      db.query(
        `insert into public.cost_records (assessment_id, organisation_id, ai_cost_usd)
         values (null, null, 0.1)`,
      ),
    ).rejects.toThrow();
  });

  it('is visible to the global daily spend cap', async () => {
    const before = await db.query<{ spend: string }>('select public.spend_since($1) as spend', [
      new Date(Date.now() - 60_000).toISOString(),
    ]);
    await recordUnattributedCost(db, {
      organisationId: account.organisationId,
      costByStage: STAGES,
    });
    const after = await db.query<{ spend: string }>('select public.spend_since($1) as spend', [
      new Date(Date.now() - 60_000).toISOString(),
    ]);

    expect(Number(after.rows[0]!.spend) - Number(before.rows[0]!.spend)).toBeCloseTo(TOTAL_USD, 2);
  });

  it('is visible to the free-tier budget, which used to join it away', async () => {
    // The regression this guards: `free_tier_spend_since` reached the
    // organisation through the assessment. With no assessment, an inner join
    // silently dropped exactly the rows that matter.
    const since = new Date(Date.now() - 60_000).toISOString();
    const before = await db.query<{ spend: string }>(
      'select public.free_tier_spend_since($1) as spend',
      [since],
    );
    await recordUnattributedCost(db, {
      organisationId: account.organisationId,
      costByStage: STAGES,
    });
    const after = await db.query<{ spend: string }>(
      'select public.free_tier_spend_since($1) as spend',
      [since],
    );

    expect(Number(after.rows[0]!.spend) - Number(before.rows[0]!.spend)).toBeCloseTo(TOTAL_USD, 2);
  });

  it('does not appear as an assessment in the per-assessment view', async () => {
    await recordUnattributedCost(db, {
      organisationId: account.organisationId,
      costByStage: STAGES,
    });
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.assessment_cost where organisation_id = $1`,
      [account.organisationId],
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });
});
