/**
 * An admin could promote themselves to owner.
 *
 * Measured in a workspace with an owner and an admin, as the admin:
 *
 *     update public.memberships set role = 'owner' where … ;
 *     SELF PROMOTION ALLOWED: owner
 *     UPDATE 1
 *
 * `memberships_manage_admins` has the right rule and has had it all along —
 * `role <> 'owner' or has_org_role(organisation_id, ARRAY['owner'])`. Permissive
 * policies are ORed, and this table carries two more that check only
 * `has_org_role(organisation_id, ARRAY['owner','admin'])`, so the guard has
 * never applied to anything.
 *
 * `20260923110000_second_step_at_the_action` wrote that trap down, in those
 * words, about this table. It was written about a second factor; the sentence
 * was equally true of the ownership guard a few lines above it.
 *
 * So this file holds two things: the rule, and the shape of mistake. The second
 * one is a catalogue query, because a guard in a permissive policy beside a
 * weaker permissive policy is not a guard anywhere, not only here.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { actingAs, committingAs, connect, expectRefusal } from './setup/client.ts';
import { seedAccount, type SeededAccount } from './setup/seed.ts';

let db: Client;
let owner: SeededAccount;
let admin: SeededAccount;
let outsider: SeededAccount;
let organisationId: string;

/**
 * A workspace with an owner, an admin and room for both.
 *
 * A personal workspace has one seat and its owner is in it, so a second
 * membership trips the seat rule — a different rule with its own test.
 */
async function workspaceWithAnAdmin(): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.organisations (name, slug, account_type, is_personal, created_by)
     values ('Ownership', $1, 'agency', false, $2) returning id`,
    [`ownership-${randomUUID().slice(0, 8)}`, owner.userId],
  );
  const id = rows[0]!.id;
  await db.query(
    `insert into public.subscriptions
       (organisation_id, plan, status, seats, current_period_start, current_period_end)
     values ($1, 'agency', 'active', 10, now(), now() + interval '30 days')`,
    [id],
  );
  await db.query(
    `insert into public.memberships (organisation_id, user_id, role) values ($1, $2, 'owner')`,
    [id, owner.userId],
  );
  await db.query(
    `insert into public.memberships (organisation_id, user_id, role) values ($1, $2, 'admin')`,
    [id, admin.userId],
  );
  return id;
}

beforeAll(async () => {
  db = await connect();
  owner = await seedAccount(db, 'ownership-owner');
  admin = await seedAccount(db, 'ownership-admin');
  outsider = await seedAccount(db, 'ownership-outsider');
  organisationId = await workspaceWithAnAdmin();
});

afterAll(async () => {
  await db?.end();
});

describe('who may create an owner', () => {
  it('refuses an admin promoting themselves', async () => {
    await actingAs(db, { userId: admin.userId }, async (client) => {
      const message = await expectRefusal(
        client,
        `update public.memberships set role = 'owner'
          where organisation_id = $1 and user_id = $2`,
        [organisationId, admin.userId],
      );
      expect(message, 'an admin promoted themselves to owner').toMatch(/row-level security/i);
    });

    const { rows } = await db.query<{ role: string }>(
      'select role from public.memberships where organisation_id = $1 and user_id = $2',
      [organisationId, admin.userId],
    );
    expect(rows[0]?.role, 'the promotion survived the refusal').toBe('admin');
  });

  it('refuses an admin adding somebody else as owner', async () => {
    await actingAs(db, { userId: admin.userId }, async (client) => {
      const message = await expectRefusal(
        client,
        `insert into public.memberships (organisation_id, user_id, role) values ($1, $2, 'owner')`,
        [organisationId, outsider.userId],
      );
      expect(message, 'an admin created an owner').toMatch(/row-level security/i);
    });
  });

  it('lets an owner do both, which is what the rule says', async () => {
    await committingAs(db, { userId: owner.userId }, async (client) => {
      const { rows } = await client.query<{ role: string }>(
        `insert into public.memberships (organisation_id, user_id, role) values ($1, $2, 'owner')
         returning role`,
        [organisationId, outsider.userId],
      );
      expect(rows[0]?.role, 'an owner can no longer appoint another owner').toBe('owner');
    });

    await committingAs(db, { userId: owner.userId }, async (client) => {
      const { rows } = await client.query<{ role: string }>(
        `update public.memberships set role = 'member'
          where organisation_id = $1 and user_id = $2 returning role`,
        [organisationId, outsider.userId],
      );
      expect(rows[0]?.role, 'an owner can no longer change a role').toBe('member');
    });
  });

  it('leaves an admin the roles that were always theirs to give', async () => {
    await committingAs(db, { userId: admin.userId }, async (client) => {
      const { rows } = await client.query<{ role: string }>(
        `update public.memberships set role = 'admin'
          where organisation_id = $1 and user_id = $2 returning role`,
        [organisationId, outsider.userId],
      );
      expect(rows[0]?.role, 'an admin can no longer promote a member').toBe('admin');
    });
  });
});

describe('the shape of the mistake, not only this instance', () => {
  /**
   * Overlaps that are two genuinely different grants rather than one guard and
   * one hole, each with the reason. Anything else is a finding.
   */
  const REVIEWED_OVERLAPS: readonly string[] = [
    // Leaving a workspace yourself and removing somebody else are different
    // acts, and neither is a weakened form of the other.
    'memberships delete memberships_delete_admin_or_self VS memberships_manage_admins',
  ];

  it('has no table where one permissive write policy is weaker than another', async () => {
    const { rows } = await db.query<{ tbl: string; cmd: string; pair: string }>(`
      with p as (
        select c.relname as tbl,
               case pol.polcmd when 'a' then 'insert' when 'w' then 'update'
                               when 'd' then 'delete' when 'r' then 'select' else 'all' end as cmd,
               pol.polname,
               coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid),
                        pg_get_expr(pol.polqual, pol.polrelid), '-') as expr
          from pg_policy pol join pg_class c on c.oid = pol.polrelid
         where pol.polpermissive
           and coalesce((select string_agg(r.rolname, ',') from pg_roles r
                          where r.oid = any(pol.polroles)), 'PUBLIC') ~ 'authenticated|anon|PUBLIC'
      )
      select a.tbl, a.cmd, a.polname || ' VS ' || b.polname as pair
        from p a join p b
          on a.tbl = b.tbl and a.polname < b.polname
         and (a.cmd = b.cmd or a.cmd = 'all' or b.cmd = 'all')
         and a.cmd in ('insert', 'update', 'delete', 'all')
         and b.cmd in ('insert', 'update', 'delete', 'all')
         and a.expr <> b.expr
       order by a.tbl, a.cmd, pair
    `);

    const found = rows.map((row) => `${row.tbl} ${row.cmd} ${row.pair}`);

    /*
     * The one reviewed overlap is this query's positive control.
     *
     * Everything below passes by finding nothing, and the query is eight joins
     * and a role-name regex over the catalogue — plenty to stop matching
     * quietly. If `memberships` no longer shows up as a pair, the query has
     * broken rather than the schema having improved, and a sweep that finds
     * nothing because it is looking in the wrong place reads exactly like a
     * schema with nothing wrong with it.
     */
    const control = REVIEWED_OVERLAPS.filter((entry) => !found.includes(entry));
    expect(
      control,
      `Reviewed overlaps the query no longer finds:\n  ${control.join('\n  ')}\n` +
        'Either the policies changed and the entry is stale, or the query has stopped working.',
    ).toEqual([]);

    const unreviewed = found.filter((entry) => !REVIEWED_OVERLAPS.includes(entry));

    expect(
      unreviewed,
      'two permissive write policies on one table differ, so the stricter one is ORed away. ' +
        'Either make the condition restrictive, or add the pair to REVIEWED_OVERLAPS with the ' +
        'reason it is two grants rather than one guard:\n  ' +
        unreviewed.join('\n  '),
    ).toEqual([]);
  });
});
