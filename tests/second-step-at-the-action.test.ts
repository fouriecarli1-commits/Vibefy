/**
 * A second step, required where it is load-bearing.
 *
 * Anré's decision: enforce it server-side at the action, not at every sign-in.
 * Requiring an authenticator app of a solo builder trying a free assessment
 * costs us the customer and buys them nothing. The actions guarded here are the
 * ones where somebody else's reputation or somebody else's findings are at
 * stake — the review that stands in front of every badge, and the two ways a
 * human who is not the customer comes to read a customer's findings.
 *
 * The enforcement is in the database rather than in a server action. Every one
 * of these writes goes through PostgREST with the anon key and a user's access
 * token, so a rule that lives only in `apps/web` is a rule that can be skipped
 * by not using `apps/web`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { actingAs, connect } from './setup/client.ts';
import { makeReviewer, seedAccount, type SeededAccount } from './setup/seed.ts';

let db: Client;
let reviewer: SeededAccount;
let owner: SeededAccount;

beforeAll(async () => {
  db = await connect();
  reviewer = await seedAccount(db, 'second-step-reviewer');
  await makeReviewer(db, reviewer.userId);
  owner = await seedAccount(db, 'second-step-owner');
  await db.query(
    `insert into public.subscriptions (organisation_id, plan, status, seats, current_period_start, current_period_end)
     values ($1, 'agency', 'active', 5, now(), now() + interval '30 days')`,
    [owner.organisationId],
  );
});

afterAll(async () => {
  await db?.end();
});

describe('what the token has to say', () => {
  it.each([
    ['aal2', true],
    ['aal1', false],
  ] as const)('reads %s as %s', async (aal, expected) => {
    const passed = await actingAs(db, { userId: owner.userId, aal }, async (client) => {
      const { rows } = await client.query<{ ok: boolean }>(
        'select public.session_passed_second_step() as ok',
      );
      return rows[0]!.ok;
    });
    expect(passed).toBe(expected);
  });

  it('reads a missing claim as false rather than as a pass', async () => {
    /*
     * The failure this whole file guards against, in one line: an answer we
     * could not read counting as a good one. A token with no `aal` has proved
     * nothing about a second factor.
     */
    await db.query('begin');
    await db.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({ sub: owner.userId, role: 'authenticated' }),
    ]);
    await db.query('set local role authenticated');
    const { rows } = await db.query<{ ok: boolean }>(
      'select public.session_passed_second_step() as ok',
    );
    await db.query('rollback');
    expect(rows[0]!.ok).toBe(false);
  });
});

describe('the policies are restrictive, which is the whole mechanism', () => {
  it('ANDs rather than ORs, so another policy cannot undo them', async () => {
    /*
     * `public.memberships` already carries two permissive policies that let an
     * admin insert — one from the foundations migration and one from the
     * workspaces migration. Permissive policies are ORed, so a condition added
     * to either of them would have achieved nothing while looking exactly like
     * a control. This asserts the property that makes these different, and it
     * holds for a permissive policy somebody adds next year without reading the
     * migration comment.
     */
    const { rows } = await db.query<{ policyname: string; permissive: string }>(
      `select policyname, permissive from pg_policies
        where schemaname = 'public' and policyname like '%need_second_step%'
        order by policyname`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(7);
    for (const row of rows) expect(row.permissive).toBe('RESTRICTIVE');
  });

  it('covers every write that grants access or moves a badge', async () => {
    const { rows } = await db.query<{ tablename: string; cmd: string }>(
      `select tablename, cmd from pg_policies
        where schemaname = 'public' and policyname like '%need_second_step%'`,
    );
    const covered = new Set(rows.map((row) => `${row.tablename}:${row.cmd}`));
    expect(covered).toContain('reviews:INSERT');
    expect(covered).toContain('badges:INSERT');
    expect(covered).toContain('badges:UPDATE');
    expect(covered).toContain('invitations:INSERT');
    expect(covered).toContain('invitations:UPDATE');
    expect(covered).toContain('memberships:INSERT');
    expect(covered).toContain('memberships:UPDATE');
  });

  it('restricts no read, so nobody is locked out of the way to enrol', async () => {
    // A reviewer at aal1 must be able to sign in, see the queue and reach the
    // page where they enrol. Restricting select would be an outage rather than
    // a control.
    const cmds = await db.query<{ cmd: string }>(
      `select cmd from pg_policies
        where schemaname = 'public' and policyname like '%need_second_step%'`,
    );
    expect(cmds.rows.map((row) => row.cmd)).not.toContain('SELECT');
    expect(cmds.rows.map((row) => row.cmd)).not.toContain('ALL');
  });
});

describe('a reviewer without a second step', () => {
  const insertReview = async (aal: 'aal1' | 'aal2') =>
    actingAs(db, { userId: reviewer.userId, aal }, async (client) => {
      try {
        await client.query(
          `insert into public.reviews (assessment_id, organisation_id, reviewer_id, action)
           values (gen_random_uuid(), $1, $2, 'approved')`,
          [owner.organisationId, reviewer.userId],
        );
        return 'allowed';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });

  it('cannot write the review that stands in front of every badge', async () => {
    expect(await insertReview('aal1')).toMatch(/row-level security/i);
  });

  it('can still read the queue, so they can get to the enrolment page', async () => {
    const readable = await actingAs(
      db,
      { userId: reviewer.userId, aal: 'aal1' },
      async (client) => {
        const { rows } = await client.query('select 1 from public.assessments limit 1');
        return Array.isArray(rows);
      },
    );
    expect(readable).toBe(true);
  });

  it('is refused for the assurance level and not for being a reviewer', async () => {
    // At aal2 the same statement gets past the second-step policy and is
    // stopped by something else entirely — a foreign key to an assessment that
    // does not exist. That is the proof that aal1 was refused by this policy
    // rather than by the permissive one underneath it.
    expect(await insertReview('aal2')).toMatch(/foreign key|violates foreign key/i);
  });
});

describe('an owner without a second step', () => {
  it('cannot invite somebody into a customer’s findings', async () => {
    const outcome = await actingAs(db, { userId: owner.userId, aal: 'aal1' }, async (client) => {
      try {
        await client.query(
          `insert into public.invitations (organisation_id, email, role, token_sha256, invited_by, expires_at)
             values ($1, 'nobody@example.test', 'member', $2, $3, now() + interval '7 days')`,
          [owner.organisationId, 'b'.repeat(64), owner.userId],
        );
        return 'allowed';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    expect(outcome).toMatch(/row-level security/i);
  });

  it('can with one', async () => {
    const outcome = await actingAs(db, { userId: owner.userId, aal: 'aal2' }, async (client) => {
      await client.query(
        `insert into public.invitations (organisation_id, email, role, token_sha256, invited_by, expires_at)
           values ($1, 'somebody@example.test', 'member', $2, $3, now() + interval '7 days')`,
        [owner.organisationId, 'c'.repeat(64), owner.userId],
      );
      return 'allowed';
    });
    expect(outcome).toBe('allowed');
  });

  it('may still leave a workspace without one', async () => {
    // Removing yourself grants nobody anything. Requiring a second step to
    // leave is friction with nothing on the other side of it.
    const cmds = await db.query<{ cmd: string }>(
      `select cmd from pg_policies
        where schemaname = 'public' and tablename = 'memberships'
          and policyname like '%need_second_step%'`,
    );
    expect(cmds.rows.map((row) => row.cmd)).not.toContain('DELETE');
  });
});

describe('the sentence a person reads', () => {
  it('is the same in the database as in the TypeScript', () => {
    // Two places that describe one link must not describe it two ways.
    const sql = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260923120000_accept_invitation.sql'),
      'utf8',
    );
    const ts = readFileSync(join(process.cwd(), 'packages/workspace/src/invitations.ts'), 'utf8');
    for (const sentence of [
      'That invitation link is not valid.',
      'That invitation has already been used.',
      'That invitation was withdrawn.',
    ]) {
      expect(sql).toContain(sentence);
      expect(ts).toContain(sentence);
    }
  });
});

describe('what is deliberately left open', () => {
  it('lets an admin withdraw an invitation without a second step', async () => {
    /*
     * Withdrawing reduces access, and it is what an admin does the moment they
     * realise they invited the wrong person. A control standing between
     * somebody and undoing their own mistake is working against the thing it
     * is for.
     */
    const { rows } = await db.query<{ id: string }>(
      `insert into public.invitations (organisation_id, email, role, token_sha256, invited_by, expires_at)
       values ($1, 'withdraw@example.test', 'member', $2, $3, now() + interval '7 days')
       returning id`,
      [owner.organisationId, 'd'.repeat(64), owner.userId],
    );
    const id = rows[0]!.id;

    const revoked = await actingAs(db, { userId: owner.userId, aal: 'aal1' }, async (client) => {
      try {
        await client.query(
          `update public.invitations set revoked_at = now(), revoked_by = $2 where id = $1`,
          [id, owner.userId],
        );
        return 'allowed';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    expect(revoked).toBe('allowed');
  });

  it('still refuses redirecting a live invitation to another address', async () => {
    // The threat the update restriction is for: a stolen password becomes a
    // second account by changing the address on an invitation that is already
    // out. Setting `revoked_at` is the only way past it, and a revoked
    // invitation is dead.
    const { rows } = await db.query<{ id: string }>(
      `insert into public.invitations (organisation_id, email, role, token_sha256, invited_by, expires_at)
       values ($1, 'intended@example.test', 'member', $2, $3, now() + interval '7 days')
       returning id`,
      [owner.organisationId, 'e'.repeat(64), owner.userId],
    );
    const outcome = await actingAs(db, { userId: owner.userId, aal: 'aal1' }, async (client) => {
      try {
        await client.query(`update public.invitations set email = $2 where id = $1`, [
          rows[0]!.id,
          'attacker@example.test',
        ]);
        return 'allowed';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    expect(outcome).toMatch(/row-level security/i);
  });
});

describe('the sentence the action gives instead of a Postgres error', () => {
  it('says what to do, at the chokepoint rather than in each action', () => {
    // In `reviewerContext` and `reviewerClient`, so a fourth review action
    // added later gets it without anybody remembering — the same reason the
    // role check lives there.
    for (const path of ['apps/web/app/review/actions.ts', 'apps/web/app/review/badge-actions.ts']) {
      const source = readFileSync(join(process.cwd(), path), 'utf8');
      expect(source).toContain('sessionPassedSecondStep()');
      expect(source).toContain('SECOND_STEP_REQUIRED');
    }
    const copy = readFileSync(join(process.cwd(), 'apps/web/lib/second-step-server.ts'), 'utf8');
    expect(copy).toMatch(/Sign-in security/);
    // One rule, not a second reading of it written out again: two copies of
    // "what counts as having answered" is how one of them comes to accept aal1.
    expect(copy).toContain('decideSecondStep(');
  });

  it('does not guard accepting an invitation, which is the other side of it', () => {
    const actions = readFileSync(
      join(process.cwd(), 'apps/web/app/console/workspace/actions.ts'),
      'utf8',
    );
    const accept = actions.slice(
      actions.indexOf('export async function acceptInvitation('),
      actions.indexOf('export async function changeRole('),
    );
    expect(accept).not.toContain('sessionPassedSecondStep');
    expect(accept).toContain("supabase.rpc('accept_invitation'");
  });
});
