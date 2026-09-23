/**
 * Creating a shared workspace, which had never once worked.
 *
 * The second instance of the shape that killed invitation acceptance, found by
 * going looking for it rather than by waiting for it. Here the mechanism is
 * invisible in the policy, which is why it survived:
 *
 *   · `organisations_insert_own` permits the insert. `created_by = auth.uid()`
 *     is exactly what the action set, and the insert on its own succeeds.
 *   · The action needed the new id, so it wrote `.insert({...}).select('id')` —
 *     which PostgREST sends as `insert ... returning id`.
 *   · `returning` is a read, checked against `organisations_select_members`,
 *     which asks `is_org_member(id)`. At that instant the creator holds no
 *     membership in the organisation being created; the membership was the next
 *     statement.
 *
 * So the whole shared-workspace tier was unreachable from a form that is wired
 * into `/console/workspace` today.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { actingAs, connect } from './setup/client.ts';
import { seedAccount, type SeededAccount } from './setup/seed.ts';

let db: Client;
let user: SeededAccount;

beforeAll(async () => {
  db = await connect();
  user = await seedAccount(db, 'workspace-maker');
});

afterAll(async () => {
  await db?.end();
});

const create = async (
  name: string,
  slug: string,
  type: 'agency' | 'organisation' | 'individual' = 'agency',
  aal: 'aal1' | 'aal2' = 'aal1',
  userId: string = user.userId,
) => {
  try {
    await db.query('begin');
    await db.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({ sub: userId, role: 'authenticated', aal }),
    ]);
    await db.query('set local role authenticated');
    const { rows } = await db.query<{ create_workspace: string }>(
      'select public.create_workspace($1, $2, $3::public.account_type)',
      [name, slug, type],
    );
    const id = rows[0]!.create_workspace;
    await db.query('reset role');
    const membership = await db.query<{ role: string }>(
      `select role::text from public.memberships where organisation_id = $1 and user_id = $2`,
      [id, userId],
    );
    return { ok: true as const, id, role: membership.rows[0]?.role ?? null };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : String(error) };
  } finally {
    await db.query('rollback');
  }
};

describe('the way the old code failed', () => {
  it('an insert ... returning on organisations still cannot succeed', async () => {
    /*
     * The defect itself, held in place rather than fixed by loosening the read.
     * If somebody ever makes this pass by widening
     * `organisations_select_members`, every organisation becomes readable by
     * whoever set `created_by` — on the one table that decides what everything
     * else is scoped to.
     */
    const outcome = await actingAs(db, { userId: user.userId, aal: 'aal2' }, async (client) => {
      try {
        await client.query(
          `insert into public.organisations (name, slug, account_type, is_personal, created_by)
           values ('Direct', 'direct-probe-1', 'agency', false, $1) returning id`,
          [user.userId],
        );
        return 'allowed';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    expect(outcome).toMatch(/row-level security/i);
  });

  it('left nothing behind when it failed, which is why no slug was burned', async () => {
    // Checked rather than assumed: `insert ... returning` fails as one
    // statement, so the row is never written.
    const slug = 'nothing-left-behind-probe';
    await db.query('begin');
    await db.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({ sub: user.userId, role: 'authenticated', aal: 'aal2' }),
    ]);
    await db.query('set local role authenticated');
    try {
      await db.query(
        `insert into public.organisations (name, slug, account_type, is_personal, created_by)
         values ('Gone', $1, 'agency', false, $2) returning id`,
        [slug, user.userId],
      );
    } catch {
      // expected
    }
    await db.query('rollback');
    const { rows } = await db.query(`select 1 from public.organisations where slug = $1`, [slug]);
    expect(rows).toHaveLength(0);
  });
});

describe('the workspace that now gets created', () => {
  it('exists, with its creator as owner, in one transaction', async () => {
    const result = await create('Kettle Agency', 'kettle-agency-a');
    expect(result.ok).toBe(true);
    expect(result.ok && result.role).toBe('owner');
  });

  it('needs no authenticator app, because it grants nobody else anything', async () => {
    // The other side of the restrictive policies: granting somebody access to a
    // customer's findings needs a second step; creating a workspace where you
    // are the only member does not.
    expect((await create('Solo Agency', 'solo-agency-a', 'agency', 'aal1')).ok).toBe(true);
  });

  it('is visible to its creator afterwards, which is the whole point', async () => {
    await db.query('begin');
    await db.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({ sub: user.userId, role: 'authenticated', aal: 'aal1' }),
    ]);
    await db.query('set local role authenticated');
    const { rows } = await db.query<{ create_workspace: string }>(
      'select public.create_workspace($1, $2, $3::public.account_type)',
      ['Visible Agency', 'visible-agency-a', 'agency'],
    );
    const seen = await db.query(`select id from public.organisations where id = $1`, [
      rows[0]!.create_workspace,
    ]);
    await db.query('rollback');
    expect(seen.rows).toHaveLength(1);
  });

  it('never leaves an organisation with no members', async () => {
    // An organisation nobody is a member of is invisible to every policy in
    // this schema: it cannot be seen, changed or deleted by anybody.
    const { rows } = await db.query<{ count: string }>(
      `select count(*) as count from public.organisations o
        where not exists (select 1 from public.memberships m where m.organisation_id = o.id)`,
    );
    expect(Number(rows[0]!.count)).toBe(0);
  });
});

describe('what it refuses', () => {
  it('refuses a personal workspace, which the sign-up trigger makes', async () => {
    const result = await create('Sneaky', 'sneaky-a', 'individual');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/agency or an organisation/);
  });

  it('refuses a name too short to be one', async () => {
    const result = await create('K', 'k-a');
    expect(!result.ok && result.message).toMatch(/Give the workspace a name/);
  });

  it('refuses a caller with no session', async () => {
    try {
      await db.query('begin');
      await db.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({ sub: null, role: 'authenticated', aal: 'aal2' }),
      ]);
      await db.query('set local role authenticated');
      await db.query('select public.create_workspace($1, $2, $3::public.account_type)', [
        'Nobody',
        'nobody-a',
        'agency',
      ]);
      expect.unreachable('a caller with no session was allowed to create a workspace');
    } catch (error) {
      expect(error instanceof Error ? error.message : String(error)).toMatch(/signed out/);
    } finally {
      await db.query('rollback');
    }
  });
});

describe('two workspaces with the same name', () => {
  it('gets the second one a suffix rather than an error', async () => {
    /*
     * The slug is unique across every customer of this product, so a name being
     * taken by a stranger is our problem to solve rather than theirs to work
     * around. Resolved here because here is where the constraint is.
     */
    await db.query('begin');
    await db.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({ sub: user.userId, role: 'authenticated', aal: 'aal1' }),
    ]);
    await db.query('set local role authenticated');
    const first = await db.query<{ create_workspace: string }>(
      'select public.create_workspace($1, $2, $3::public.account_type)',
      ['Twice', 'twice-collide', 'agency'],
    );
    const second = await db.query<{ create_workspace: string }>(
      'select public.create_workspace($1, $2, $3::public.account_type)',
      ['Twice', 'twice-collide', 'agency'],
    );
    await db.query('reset role');
    const { rows } = await db.query<{ slug: string }>(
      `select slug from public.organisations where id = any($1::uuid[]) order by slug`,
      [[first.rows[0]!.create_workspace, second.rows[0]!.create_workspace]],
    );
    await db.query('rollback');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.slug).not.toBe(rows[1]!.slug);
    expect(rows.some((row) => row.slug === 'twice-collide')).toBe(true);
  });
});

describe('the action', () => {
  it('goes through the function and derives the slug in one place', () => {
    const source = readFileSync(
      join(process.cwd(), 'apps/web/app/console/workspace/actions.ts'),
      'utf8',
    );
    const fn = source.slice(
      source.indexOf('export async function createWorkspace('),
      source.indexOf('export async function inviteMember('),
    );
    expect(fn).toContain("supabase.rpc('create_workspace'");
    expect(fn).toContain('slugify(name)');
    // Two slug implementations is one of them drifting. The derivation stays in
    // TypeScript; only collision resolution is in SQL.
    expect(fn).not.toMatch(/\.from\('organisations'\)/);
    expect(fn).not.toMatch(/\.from\('memberships'\)/);
  });
});
