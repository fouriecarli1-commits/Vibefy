/**
 * The score is the product. A customer could write their own.
 *
 * Measured on the test database as `authenticated`, with a real member's
 * access token and no web page involved — PostgREST and an insert:
 *
 *     SELF-SCORED: dbf93072-… status=awaiting_review score=100.00 cert=true
 *
 * and, on an engine-written assessment of theirs sitting in the queue at 39:
 *
 *     AFTER: score=99.00 status=awaiting_review
 *
 * `awaiting_review` is the status `/review` lists, and the approve action
 * checks nothing about the score, the findings or the stage records. PART 11
 * forbids any path by which a payment, plan, discount or marketing purchase
 * can influence a score; this was the customer writing the number directly.
 *
 * Both came from policies that read as "a workspace owns its own
 * assessments" — true of reading them — and that name no column, so both also
 * permitted the three the engine alone is entitled to write.
 *
 * What this file holds is the capability, not the two statements: a role
 * reachable through PostgREST may not write `overall_score` by any route, and
 * the routes the product does use must still work. The last two cases are the
 * reason the first ones are not enough — a migration that refused everything
 * would satisfy them and take the review queue with it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { actingAs, committingAs, connect, expectRefusal } from './setup/client.ts';
import { makeReviewer, seedAccount, seedAssessment, type SeededAccount } from './setup/seed.ts';

let db: Client;
let customer: SeededAccount;
let reviewer: SeededAccount;

beforeAll(async () => {
  db = await connect();
  customer = await seedAccount(db, 'self-score');
  reviewer = await seedAccount(db, 'self-score-reviewer');
  await makeReviewer(db, reviewer.userId);
});

afterAll(async () => {
  await db?.end();
});

describe('what a customer may write about their own assessment', () => {
  it('refuses an assessment the customer inserts for themselves', async () => {
    const { appId, authorisationId } = await seedAssessment(db, customer);
    // Through the role a browser gets, not the owning connection: the owner
    // must still be able to do this, and asking it on `db` would prove the
    // opposite of what this file is about.
    let message = '';
    await actingAs(db, { userId: customer.userId }, async (client) => {
      message = await expectRefusal(
        client,
        `insert into public.assessments
           (app_id, organisation_id, authorisation_id, status, rubric_version, depth,
            scope_statement, overall_score, dimension_scores, completed_at)
         values ($1, $2, $3, 'awaiting_review', '1.1.0', 'full', $4, 100, $5::jsonb, now())`,
        [
          appId,
          customer.organisationId,
          authorisationId,
          'This is the scope statement a customer wrote for themselves. '.repeat(4),
          JSON.stringify([
            { dimension: 'security_privacy', score: 100, weight: 0.3, band: 'Exemplary' },
          ]),
        ],
      );
    });
    // Either answer is the rule holding: no permissive policy, or no grant.
    expect(message, 'a customer inserted their own assessment').toMatch(
      /row-level security|permission denied/i,
    );
  });

  it('refuses a customer rewriting the score on an assessment of theirs', async () => {
    const { assessmentId } = await seedAssessment(db, customer);
    await db.query(
      `update public.assessments set status = 'awaiting_review', overall_score = 39 where id = $1`,
      [assessmentId],
    );

    await actingAs(db, { userId: customer.userId }, async (client) => {
      const message = await expectRefusal(
        client,
        `update public.assessments set overall_score = 99, gate_failures = '{}' where id = $1`,
        [assessmentId],
      );
      // An update that matches no row is not an error — RLS filters rather than
      // refuses — so a refusal message is the strong form and zero rows changed
      // is the weak one. Both are the rule; neither may be a score of 99.
      if (message === '') {
        const { rows } = await client.query<{ overall_score: string }>(
          'select overall_score from public.assessments where id = $1',
          [assessmentId],
        );
        expect(Number(rows[0]?.overall_score), 'the customer rewrote their score').toBe(39);
      }
    });

    const { rows } = await db.query<{ overall_score: string }>(
      'select overall_score from public.assessments where id = $1',
      [assessmentId],
    );
    expect(Number(rows[0]!.overall_score), 'the score did not survive the attempt').toBe(39);
  });

  it('names no role reachable through PostgREST that may write a score', async () => {
    // The catalogue form of the same rule, so a policy added next month is
    // covered. `anon`, `authenticated` and `service_role` are the three roles a
    // request can arrive as; the engine writes as the owner, which RLS and
    // these grants do not apply to.
    const { rows } = await db.query<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type
         from information_schema.table_privileges
        where table_schema = 'public' and table_name = 'assessments'
          and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
          and privilege_type in ('INSERT', 'UPDATE')`,
    );
    const writers = rows.map((row) => `${row.grantee}:${row.privilege_type}`);
    // UPDATE stays for the reviewer, whose policy is asserted below. INSERT
    // must belong to nobody: there is no caller for it outside the worker.
    expect(writers, 'a request-facing role may insert an assessment').not.toContain(
      'authenticated:INSERT',
    );
    expect(writers).not.toContain('anon:INSERT');
    expect(writers).not.toContain('anon:UPDATE');
  });
});

describe('what must still work', () => {
  it('lets a reviewer approve, which is the capability the old policy carried', async () => {
    const { assessmentId } = await seedAssessment(db, customer);
    await db.query(
      `update public.assessments set status = 'awaiting_review', overall_score = 72 where id = $1`,
      [assessmentId],
    );

    // The review row first, because `a_review_authorises_its_own_transition`
    // requires one — approving without a recorded human action is refused, and
    // that refusal is a separate rule this file must not be mistaken for.
    await committingAs(db, { userId: reviewer.userId }, async (client) => {
      await client.query(
        `insert into public.reviews (assessment_id, organisation_id, reviewer_id, action, reason)
         values ($1, $2, $3, 'approved', 'Read against the published rubric.')`,
        [assessmentId, customer.organisationId, reviewer.userId],
      );
      const { rows } = await client.query<{ status: string }>(
        `update public.assessments set status = 'approved', reviewed_at = now()
          where id = $1 returning status`,
        [assessmentId],
      );
      expect(rows.length, 'the reviewer could no longer approve anything').toBe(1);
      expect(rows[0]?.status).toBe('approved');
    });
  });

  it('lets the engine write an assessment, which is the only writer there is', async () => {
    // `seedAssessment` goes through the owning connection, exactly as
    // `apps/worker/src/persist.ts` does. If this breaks, the product stops.
    const { assessmentId } = await seedAssessment(db, customer);
    const { rows } = await db.query('select id from public.assessments where id = $1', [
      assessmentId,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('still lets a customer ask for one, which is their whole write path', async () => {
    const { appId } = await seedAssessment(db, customer);
    await committingAs(db, { userId: customer.userId }, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.assessment_requests
           (app_id, organisation_id, requested_by, depth, plan_at_request, max_run_cost_usd)
         values ($1, $2, $3, 'limited', 'free', 1.00) returning id`,
        [appId, customer.organisationId, customer.userId],
      );
      expect(rows.length, 'a customer can no longer request an assessment').toBe(1);
    });
  });
});
