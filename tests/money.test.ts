/**
 * Money — one of the four mandatory test areas.
 *
 * M0 carries the commerce schema, not the Stripe integration, so what is
 * asserted here is what the schema itself must never allow: a refund larger
 * than the payment, two live subscriptions on one organisation, negative
 * amounts, and cost data leaking to anyone whose judgement it could colour.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  COST_CEILING_BY_DEPTH,
  costOfCall,
  DEFAULT_MODEL,
  priceFor,
  TRIAGE_MODEL,
} from '../packages/engine/src/runtime/cost.ts';
import { actingAs, connect, expectRefusal } from './setup/client.ts';
import { makeReviewer, seedAccount, seedAssessment, type SeededAccount } from './setup/seed.ts';

let db: Client;
let account: SeededAccount;
let reviewer: SeededAccount;

beforeAll(async () => {
  db = await connect();
  account = await seedAccount(db, 'billing');
  reviewer = await seedAccount(db, 'billing-reviewer');
  await makeReviewer(db, reviewer.userId);
});

afterAll(async () => {
  await db?.end();
});

describe('what a run costs us', () => {
  it('has a price on file for every model this code will actually call', async () => {
    // `priceFor` throws on an unpriced model — "an unpriced model is an
    // unmetered bill" — which is the right behaviour and arrives at the worst
    // possible time: partway through a run somebody has already paid for. The
    // two models the engine reaches for by name are checked here instead, where
    // it costs nothing.
    for (const model of [DEFAULT_MODEL, TRIAGE_MODEL]) {
      expect(() => priceFor(model), `no price on file for ${model}`).not.toThrow();
    }
  });

  it('prices a call from the published rates rather than a rounded guess', async () => {
    // A million input tokens on Opus 5 at $5, and a million output at $25.
    expect(costOfCall(DEFAULT_MODEL, { inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(
      5,
      6,
    );
    expect(costOfCall(DEFAULT_MODEL, { inputTokens: 0, outputTokens: 1_000_000 })).toBeCloseTo(
      25,
      6,
    );
    // A cache read is a tenth of the input rate, which is the whole reason to
    // bother caching; a number drifting here would make caching look pointless.
    expect(
      costOfCall(DEFAULT_MODEL, {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 1_000_000,
      }),
    ).toBeCloseTo(0.5, 6);
  });

  it('has a ceiling for every assessment depth, chosen rather than fallen back to', async () => {
    // The map is keyed by the depth union now, so a new depth without a ceiling
    // does not compile. This is the runtime half, and the reason it matters:
    // the old `?? 1` gave an unknown depth a dollar — between the cheapest
    // ceiling and the dearest, and chosen by nobody.
    for (const depth of ['limited', 'full', 'continuous'] as const) {
      expect(COST_CEILING_BY_DEPTH[depth], `no ceiling for ${depth}`).toBeGreaterThan(0);
    }
  });
});

describe('invoices', () => {
  it('refuses a refund larger than the amount paid', async () => {
    await db.query('begin');
    const message = await expectRefusal(
      db,
      `insert into public.invoices (organisation_id, amount_due_cents, amount_paid_cents, amount_refunded_cents, status)
       values ($1, 4900, 4900, 9800, 'refunded')`,
      [account.organisationId],
    );
    expect(message).toMatch(/refund_within_payment/i);
    await db.query('rollback');
  });

  it('refuses negative amounts', async () => {
    await db.query('begin');
    const message = await expectRefusal(
      db,
      `insert into public.invoices (organisation_id, amount_due_cents, status) values ($1, -100, 'open')`,
      [account.organisationId],
    );
    expect(message).toMatch(/amount_due_cents_check|violates check constraint/i);
    await db.query('rollback');
  });
});

describe('subscriptions', () => {
  it('allows only one live subscription per organisation', async () => {
    await db.query(
      `insert into public.subscriptions (organisation_id, plan, status) values ($1, 'certified', 'active')`,
      [account.organisationId],
    );
    await db.query('begin');
    const message = await expectRefusal(
      db,
      `insert into public.subscriptions (organisation_id, plan, status) values ($1, 'agency', 'active')`,
      [account.organisationId],
    );
    expect(message).toMatch(/subscriptions_one_live_per_org/i);
    await db.query('rollback');
  });
});

describe('cost records', () => {
  it('totals the components it is given', async () => {
    // Seeds its own assessment. It used to take `select id from assessments
    // limit 1`, which meant this passed only when some other file had happened
    // to run first and left one behind — and returned no rows at all, with a
    // confusing message about `undefined`, when it did not.
    const other = await seedAccount(db, 'cost');
    const { assessmentId } = await seedAssessment(db, other);
    const { rows } = await db.query<{ total_cost_usd: string }>(
      `insert into public.cost_records (assessment_id, organisation_id, model, input_tokens, output_tokens, ai_cost_usd, compute_cost_usd, third_party_cost_usd)
       values ($1, $2, 'claude', 1000, 500, 0.25, 0.10, 0.05)
       returning total_cost_usd`,
      [assessmentId, other.organisationId],
    );
    expect(Number(rows[0]!.total_cost_usd)).toBeCloseTo(0.4, 6);
  });

  it('is invisible to customers and to reviewers alike', async () => {
    for (const identity of [account, reviewer]) {
      await actingAs(db, { userId: identity.userId }, async (client) => {
        const { rows } = await client.query(`select * from public.cost_records`);
        expect(rows).toHaveLength(0);
      });
    }
  });
});
