/**
 * The plan a page shows belongs to the workspace that page is about.
 *
 * `/console/billing` read two lists and picked from each independently:
 *
 *     const primary = memberships?.[0];
 *     const live = subscriptions?.find((row) => ['active','trialing'].includes(row.status));
 *
 * Neither query was ordered and neither pick was scoped to the other. Both lists
 * span every workspace the caller belongs to, because that is what row-level
 * security lets them read — so `primary` is an arbitrary workspace and `live` is
 * an arbitrary *active subscription*, and nothing makes them the same one.
 *
 * A consultant who belongs to a client's Agency workspace and has a free
 * personal one is shown their own workspace's name above the client's plan,
 * with the client's allowances beside it. `/console` had the same shape, without
 * even selecting `organisation_id` to scope by.
 *
 * **This is a display fault and not an entitlement bypass**, and the difference
 * is worth stating plainly rather than leaving to be discovered. What an account
 * may actually do is decided by `resolvePlan(client, { organisationId, appId })`
 * in the worker and in the server actions, which is scoped to one workspace and
 * always was. Nobody got a run they had not paid for. What they got was a
 * billing page that disagreed with itself, on the screen where somebody decides
 * whether to pay — which costs a sale or a support ticket rather than money.
 *
 * The workspace is chosen the same way `/console/privacy` now chooses it: the
 * personal one, asked for rather than sifted for, and deterministic when there
 * is no personal one rather than whatever the plan returned first.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connect } from './setup/client.ts';
import { seedAccount, type SeededAccount } from './setup/seed.ts';

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');
const billing = read('apps/web/app/console/billing/page.tsx');
const consolePage = read('apps/web/app/console/page.tsx');

let db: Client;
let consultant: SeededAccount;
let clientOrgId: string;

beforeAll(async () => {
  db = await connect();
  consultant = await seedAccount(db, 'plan-scope-consultant');

  const { rows } = await db.query<{ id: string }>(
    `insert into public.organisations (name, slug, account_type, is_personal, created_by)
     values ('A client', $1, 'agency', false, $2) returning id`,
    [`plan-scope-client-${Date.now().toString(36)}`, consultant.userId],
  );
  clientOrgId = rows[0]!.id;
  await db.query(
    `insert into public.memberships (organisation_id, user_id, role) values ($1, $2, 'member')`,
    [clientOrgId, consultant.userId],
  );
  // The client pays. The consultant's own workspace does not.
  await db.query(
    `insert into public.subscriptions
       (organisation_id, plan, status, provider, provider_customer_id, provider_subscription_id)
     values ($1, 'agency', 'active', 'stripe', $2, $3)`,
    [clientOrgId, `cus_${clientOrgId.slice(0, 8)}`, `sub_${clientOrgId.slice(0, 8)}`],
  );
});

afterAll(async () => {
  await db?.end();
});

describe('a consultant who belongs to a paying client', () => {
  it('has exactly one active subscription visible to them, and it is not their own', async () => {
    // The setup the fault needs, asserted rather than assumed: the rows really
    // do span two workspaces, so an unscoped pick really can cross.
    const { rows } = await db.query<{ organisation_id: string }>(
      `select s.organisation_id
         from public.subscriptions s
         join public.memberships m on m.organisation_id = s.organisation_id
        where m.user_id = $1 and s.status in ('active', 'trialing')`,
      [consultant.userId],
    );
    expect(rows.map((r) => r.organisation_id)).toEqual([clientOrgId]);
    expect(clientOrgId).not.toBe(consultant.organisationId);
  });

  it('is on the free plan in their own workspace', async () => {
    // What the page should say, read the way a scoped query reads it.
    const { rows } = await db.query<{ plan: string }>(
      `select plan from public.subscriptions
        where organisation_id = $1 and status in ('active', 'trialing')`,
      [consultant.organisationId],
    );
    expect(rows).toHaveLength(0);
  });
});
describe('the billing page', () => {
  /** The scoping has to sit inside the pick, not merely somewhere in the file. */
  const pickIn = (source: string) =>
    /const live = subscriptions\?\.find\(([\s\S]*?)\n  \);/.exec(source)?.[1] ?? '';

  it('scopes the subscription to the workspace it is showing', () => {
    const pick = pickIn(billing);
    expect(pick).toContain('organisation_id');
    expect(pick).toContain('organisationId');
  });

  it('prefers the personal workspace rather than whatever came back first', () => {
    // `?? memberships?.[0]` survives and is fine, because the query is ordered:
    // a deterministic last resort is not the same thing as an arbitrary pick.
    const pick = /const primary =([\s\S]*?)memberships\?\.\[0\];/.exec(billing)?.[1] ?? '';
    expect(pick).toContain('is_personal');
    expect(billing).toMatch(/from\('memberships'\)[\s\S]{0,260}\.order\(/);
  });
});

describe('the console front door', () => {
  it('selects the workspace on the subscription, so it can be scoped at all', () => {
    // It read `plan, status` only. There was nothing to scope by even in
    // principle — the column was not in the query.
    expect(consolePage).toMatch(/from\('subscriptions'\)[\s\S]{0,120}organisation_id/);
  });

  it('scopes the plan it shows to one workspace', () => {
    const pick =
      /const live = subscriptions\?\.find\(([\s\S]*?)\n  \);/.exec(consolePage)?.[1] ?? '';
    expect(pick).toContain('organisation_id');
    expect(pick).toContain('shownWorkspace');
  });
});
