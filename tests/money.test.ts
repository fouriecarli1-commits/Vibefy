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
import { actingAs, connect, expectRefusal } from './setup/client.ts';
import { makeReviewer, seedAccount, type SeededAccount } from './setup/seed.ts';

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
    const other = await seedAccount(db, 'cost');
    const { rows } = await db.query<{ total_cost_usd: string }>(
      `with a as (
         select id from public.assessments limit 1
       )
       insert into public.cost_records (assessment_id, organisation_id, model, input_tokens, output_tokens, ai_cost_usd, compute_cost_usd, third_party_cost_usd)
       select a.id, (select organisation_id from public.assessments where id = a.id), 'claude', 1000, 500, 0.25, 0.10, 0.05
       from a
       returning total_cost_usd`,
    );
    expect(Number(rows[0]!.total_cost_usd)).toBeCloseTo(0.4, 6);
    expect(other.userId).toBeTruthy();
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
