/**
 * What an operator may see and change, and what everyone else may not.
 *
 * These screens were built after an afternoon of setting plans and promoting a
 * reviewer by typing SQL into the Supabase console — twice against the wrong
 * organisation, because there was no way to see the answer without writing a
 * join for it. Moving that into the product means widening what a platform
 * administrator can read, so the widening is asserted here in both directions:
 * what it grants, and what it must not.
 *
 * The reviewer case is the one that matters most. A reviewer who can see a
 * customer's plan has a commercial signal sitting beside a scoring decision,
 * which is the single thing the independence policy exists to prevent.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { PLAN_TIERS, ENTITLEMENTS, entitlementFor } from '../packages/billing/src/entitlements.ts';
import { actingAs, connect, expectRefusal } from './setup/client.ts';
import { makeReviewer, seedAccount, seedApp, type SeededAccount } from './setup/seed.ts';

let db: Client;
let operator: SeededAccount;
let reviewer: SeededAccount;
let customer: SeededAccount;
let customerAppId: string;

const PAGE = join(import.meta.dirname, '..', 'apps', 'web', 'app', 'admin', 'accounts', 'page.tsx');
const ACTIONS = join(
  import.meta.dirname,
  '..',
  'apps',
  'web',
  'app',
  'admin',
  'accounts',
  'actions.ts',
);

beforeAll(async () => {
  db = await connect();

  operator = await seedAccount(db, 'operator');
  await db.query(`update public.users set platform_role = 'admin' where id = $1`, [
    operator.userId,
  ]);

  reviewer = await seedAccount(db, 'reviewer');
  await makeReviewer(db, reviewer.userId);

  customer = await seedAccount(db, 'customer');
  customerAppId = await seedApp(db, customer, 'Somebody Else App');
  await db.query(
    `insert into public.subscriptions (organisation_id, plan, status) values ($1, 'certified', 'active')`,
    [customer.organisationId],
  );
});

afterAll(async () => {
  await db.end();
});

describe('what a platform administrator can see', () => {
  it('reads an organisation they are not a member of', async () => {
    const rows = await actingAs(db, { userId: operator.userId }, async (client) => {
      const result = await client.query('select id from public.organisations where id = $1', [
        customer.organisationId,
      ]);
      return result.rows;
    });
    expect(rows).toHaveLength(1);
  });

  it('reads their applications, so nobody has to guess who owns what', async () => {
    const rows = await actingAs(db, { userId: operator.userId }, async (client) => {
      const result = await client.query('select id, name from public.apps where id = $1', [
        customerAppId,
      ]);
      return result.rows;
    });
    expect(rows).toHaveLength(1);
  });

  it('reads their plan', async () => {
    const rows = await actingAs(db, { userId: operator.userId }, async (client) => {
      const result = await client.query(
        'select plan from public.subscriptions where organisation_id = $1',
        [customer.organisationId],
      );
      return result.rows;
    });
    expect(rows[0]?.plan).toBe('certified');
  });
});

describe('what a reviewer cannot see', () => {
  it('reads the organisation itself, as it always has — the queue needs the name', async () => {
    // Recorded rather than asserted away: `is_reviewer()` has covered
    // organisations, memberships, users and applications since M1, because the
    // review queue cannot show an assessment without saying whose it is. The
    // first draft of this migration re-granted all four before the tests
    // pointed out they were already there.
    const rows = await actingAs(db, { userId: reviewer.userId }, async (client) => {
      const result = await client.query('select id from public.organisations where id = $1', [
        customer.organisationId,
      ]);
      return result.rows;
    });
    expect(rows).toHaveLength(1);
  });

  it('cannot read a customer plan, which would be a commercial signal beside a score', async () => {
    const rows = await actingAs(db, { userId: reviewer.userId }, async (client) => {
      const result = await client.query(
        'select plan from public.subscriptions where organisation_id = $1',
        [customer.organisationId],
      );
      return result.rows;
    });
    expect(rows).toHaveLength(0);
  });
});

describe('what a customer cannot do', () => {
  it('cannot put their own workspace on a better plan', async () => {
    const rows = await actingAs(db, { userId: customer.userId }, async (client) => {
      const result = await client.query(
        `update public.subscriptions set plan = 'organisation'
          where organisation_id = $1 returning plan`,
        [customer.organisationId],
      );
      return result.rows;
    });
    // Row-level security makes it a no-op rather than an error: there is no row
    // the customer may write, so nothing is updated.
    expect(rows).toHaveLength(0);
  });

  it('cannot write the platform role column at all', async () => {
    // Not refused by a policy — refused by the absence of a grant. `users`
    // gives `authenticated` exactly `update (full_name)` and
    // `update (alert_email_level)`, so there is no privilege to write this
    // column from any session. That second defence is why the admin screen
    // sets the role through a security-definer function instead of being handed
    // the column.
    const message = await actingAs(db, { userId: customer.userId }, (client) =>
      expectRefusal(client, `update public.users set platform_role = 'admin' where id = $1`, [
        customer.userId,
      ]),
    );
    expect(message).toMatch(/permission denied/i);
  });

  it('cannot call the function that sets it either', async () => {
    const message = await actingAs(db, { userId: customer.userId }, (client) =>
      expectRefusal(client, `select public.set_platform_role($1, 'admin')`, [customer.userId]),
    );
    expect(message).toMatch(/only a vibefycode administrator/i);
  });
});

describe('setting a platform role', () => {
  it('lets an administrator promote somebody', async () => {
    const role = await actingAs(db, { userId: operator.userId }, async (client) => {
      await client.query(`select public.set_platform_role($1, 'reviewer')`, [customer.userId]);
      const result = await client.query('select platform_role from public.users where id = $1', [
        customer.userId,
      ]);
      return result.rows[0]?.platform_role;
    });
    expect(role).toBe('reviewer');
  });

  it('refuses to leave the platform with no administrator', async () => {
    // Every suite shares one database, and others promote administrators of
    // their own — so "the last administrator" has to be arranged rather than
    // assumed. Passing in isolation and failing in the full run is exactly the
    // shape of a test that asserts on somebody else's fixtures.
    await db.query('begin');
    try {
      await db.query(
        `update public.users set platform_role = 'user'
          where platform_role = 'admin' and id <> $1`,
        [operator.userId],
      );
      await db.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({ sub: operator.userId, role: 'authenticated' }),
      ]);
      await db.query('set local role authenticated');
      const message = await expectRefusal(db, `select public.set_platform_role($1, 'user')`, [
        operator.userId,
      ]);
      expect(message).toMatch(/only administrator/i);
    } finally {
      await db.query('rollback');
    }
  });

  it('lets one step down once another exists', async () => {
    const role = await actingAs(db, { userId: operator.userId }, async (client) => {
      await client.query(`select public.set_platform_role($1, 'admin')`, [customer.userId]);
      await client.query(`select public.set_platform_role($1, 'user')`, [operator.userId]);
      const result = await client.query('select platform_role from public.users where id = $1', [
        operator.userId,
      ]);
      return result.rows[0]?.platform_role;
    });
    expect(role).toBe('user');
  });
});

describe('the plan picker', () => {
  it('offers every plan the entitlement table defines', () => {
    expect([...PLAN_TIERS].sort()).toEqual(Object.keys(ENTITLEMENTS).sort());
  });

  it('describes what each plan permits rather than only naming it', () => {
    // "one_off" means nothing to the person choosing it; "full depth, up to
    // $4.00, badge-eligible" means everything. The page builds that label from
    // the entitlement, so it cannot drift from what the engine enforces.
    const page = readFileSync(PAGE, 'utf8');
    expect(page).toContain('entitlementFor');
    expect(page).toContain('maxRunCostUsd');
    expect(page).toContain('badgeEligible');
    for (const plan of PLAN_TIERS) {
      expect(entitlementFor(plan).maxRunCostUsd).toBeGreaterThan(0);
    }
  });
});

describe('the operator actions', () => {
  const actions = readFileSync(ACTIONS, 'utf8');

  it('re-check the caller on the server, not only when the page renders', () => {
    // A form can be submitted without ever loading the page that carries it.
    expect(actions).toContain('requireAdmin');
    expect(actions.match(/await requireAdmin\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('refuse a plan that is not a plan', () => {
    expect(actions).toContain('isPlan');
    expect(actions).toContain('is not a plan');
  });

  it('write every change to the audit log', () => {
    expect(actions.match(/from\('audit_log'\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(actions).toContain('account.plan_set');
    expect(actions).toContain('account.platform_role_set');
  });

  it('set the role through the function rather than the column', () => {
    // The column grant does not exist and must not be created to make a form
    // work. If this ever becomes a table update, the second defence is gone.
    expect(actions).toContain("rpc('set_platform_role'");
    expect(actions).not.toMatch(/update\(\{\s*platform_role/);
  });
});
