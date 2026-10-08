/**
 * Three of the nine restrictive policies could stop restricting and nothing
 * would say so.
 *
 * Measured, not noticed. `tools/policy-mutation.mjs restrictives` is a new
 * class in that tool: it opens every restrictive policy's `with check` at once,
 * which is the one shape of rule whose loss is invisible from reading — every
 * permissive policy stays in place, so every statement that used to work still
 * works, and the one that should not now does too.
 *
 * Opening all nine produced five failures, naming the review that stands in
 * front of a badge, suspending a live badge, inviting somebody, and redirecting
 * a live invitation. Narrowed to the three nothing had named, the suite came
 * back with only the schema gates:
 *
 *     badges_need_second_step_insert
 *     memberships_need_second_step_insert
 *     memberships_need_second_step_update
 *
 * Which is to say: issuing a badge, adding somebody to a workspace, and
 * changing somebody's role — three of the five actions
 * `20260923110000_second_step_at_the_action` was written for — could each have
 * lost their second factor silently.
 *
 * The two ownership policies from `20261008060000` also survived the mutation,
 * and that one is not a hole: `memberships_manage_admins` carries the same
 * condition inline, so the rule is held twice. What watches the restrictive
 * copy is `only-an-owner-grants-ownership.test.ts`'s catalogue query, which
 * fails the day a permissive policy appears that could defeat the inline one.
 * That is the thing the restrictive policy exists for, and it is tested.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { actingAs, connect, expectRefusal } from './setup/client.ts';
import {
  acceptBadgeLicence,
  approveAssessment,
  makeReviewer,
  seedAccount,
  seedAssessment,
  seedFinding,
  type SeededAccount,
} from './setup/seed.ts';

let db: Client;
let owner: SeededAccount;
let reviewer: SeededAccount;
let newcomer: SeededAccount;
let organisationId: string;

beforeAll(async () => {
  db = await connect();
  owner = await seedAccount(db, 'second-step-unwatched-owner');
  reviewer = await seedAccount(db, 'second-step-unwatched-reviewer');
  await makeReviewer(db, reviewer.userId);
  newcomer = await seedAccount(db, 'second-step-unwatched-newcomer');

  // A workspace with seats, because a personal one has exactly one and its
  // owner is in it — so any second membership trips the seat rule instead, and
  // this file would be measuring that.
  const { rows } = await db.query<{ id: string }>(
    `insert into public.organisations (name, slug, account_type, is_personal, created_by)
     values ('Second Step', $1, 'agency', false, $2) returning id`,
    [`second-step-${randomUUID().slice(0, 8)}`, owner.userId],
  );
  organisationId = rows[0]!.id;
  await db.query(
    `insert into public.subscriptions
       (organisation_id, plan, status, seats, current_period_start, current_period_end)
     values ($1, 'agency', 'active', 10, now(), now() + interval '30 days')`,
    [organisationId],
  );
  await db.query(
    `insert into public.memberships (organisation_id, user_id, role) values ($1, $2, 'owner')`,
    [organisationId, owner.userId],
  );
});

afterAll(async () => {
  await db?.end();
});

/** An assessment approved, eligible and licensed — everything but the badge. */
async function readyToIssue(): Promise<{
  appId: string;
  assessmentId: string;
  consentId: string;
}> {
  const { appId, assessmentId } = await seedAssessment(db, owner);
  await seedFinding(db, owner, assessmentId);
  await approveAssessment(db, owner, assessmentId, reviewer.userId, {
    certificationEligible: true,
  });
  const consentId = await acceptBadgeLicence(db, owner);
  return { appId, assessmentId, consentId };
}

const ISSUE_BADGE = `insert into public.badges (
   app_id, organisation_id, assessment_id, slug, public_id, rubric_version, score,
   assessed_at, certified_origin, payload, signature, signing_key_id,
   licence_consent_id, expires_at
 ) values ($1, $2, $3, $4, $5,
   (select rubric_version from public.assessments where id = $3),
   (select overall_score from public.assessments where id = $3),
   now(), 'https://app.example.test', '{}'::jsonb, 'sig', 'key-2026-01', $6,
   now() + interval '6 months')`;

describe('issuing a badge', () => {
  /*
   * The third policy turned out to guard a door that is shut for two other
   * reasons, which is why nothing watched it and why there is no second-step
   * case here to write.
   *
   * Measured: nothing in `apps/` inserts a badge. `apps/worker/src/badge.ts`
   * is the only writer, on the worker's own connection as the table's owner,
   * which holds `bypassrls` — so `badges_need_second_step_insert` has never
   * been consulted by anything.
   *
   * And it could not be. `assert_badge_is_earned` is an invoker-rights trigger
   * that reads the Badge Licence consent, and `consents_select_own` is
   * `user_id = auth.uid() or is_platform_admin()`. The licence is accepted by
   * the application's owner, so a reviewer issuing a badge cannot see the
   * consent, the trigger reads null, and the refusal is "Badge cannot issue
   * without an accepted Badge Licence for this organisation" — about a licence
   * that exists.
   *
   * So what is asserted is the truth of it: the path is closed to every caller
   * a browser can be, the reason is the licence read rather than the second
   * step, and the worker's path works. If somebody later wants a reviewer to
   * issue a badge from the console, all three of these have to change
   * together, and this is the file that will say so.
   */
  it('is not something any browser-reachable caller can do, licence and all', async () => {
    const { appId, assessmentId, consentId } = await readyToIssue();
    for (const aal of ['aal1', 'aal2'] as const) {
      await actingAs(db, { userId: reviewer.userId, aal }, async (client) => {
        const message = await expectRefusal(client, ISSUE_BADGE, [
          appId,
          owner.organisationId,
          assessmentId,
          `badge-${randomUUID().slice(0, 8)}`,
          `pub_${randomUUID().replace(/-/g, '')}`,
          consentId,
        ]);
        expect(message, `a reviewer at ${aal} issued a badge through the API`).toMatch(
          /without an accepted Badge Licence|row-level security/i,
        );
      });
    }
  });

  it('is something the worker can do, which is the only path there is', async () => {
    // The direction a guard fails in silence: refusing everybody, and being
    // found the day no badge can be issued at all. The worker's connection is
    // where that would show.
    const { appId, assessmentId, consentId } = await readyToIssue();
    const { rows } = await db.query<{ id: string }>(`${ISSUE_BADGE} returning id`, [
      appId,
      owner.organisationId,
      assessmentId,
      `badge-${randomUUID().slice(0, 8)}`,
      `pub_${randomUUID().replace(/-/g, '')}`,
      consentId,
    ]);
    expect(rows.length, 'the worker can no longer issue a badge').toBe(1);
  });
});

describe('adding somebody to a workspace', () => {
  it('is refused to an owner who answered no second factor', async () => {
    await actingAs(db, { userId: owner.userId, aal: 'aal1' }, async (client) => {
      const message = await expectRefusal(
        client,
        `insert into public.memberships (organisation_id, user_id, role) values ($1, $2, 'member')`,
        [organisationId, newcomer.userId],
      );
      expect(message, 'somebody was added to a workspace on a password alone').toMatch(
        /row-level security/i,
      );
    });
  });

  it('is allowed to the same owner who answered one', async () => {
    await actingAs(db, { userId: owner.userId, aal: 'aal2' }, async (client) => {
      const message = await expectRefusal(
        client,
        `insert into public.memberships (organisation_id, user_id, role) values ($1, $2, 'member')`,
        [organisationId, newcomer.userId],
      );
      expect(message, 'nobody can be added to a workspace at all').toBe('');
    });
  });
});

describe('changing somebody’s role', () => {
  it('is refused to an owner who answered no second factor', async () => {
    await db.query(
      `insert into public.memberships (organisation_id, user_id, role) values ($1, $2, 'member')
       on conflict (organisation_id, user_id) do update set role = 'member'`,
      [organisationId, newcomer.userId],
    );

    await actingAs(db, { userId: owner.userId, aal: 'aal1' }, async (client) => {
      const message = await expectRefusal(
        client,
        `update public.memberships set role = 'admin'
          where organisation_id = $1 and user_id = $2`,
        [organisationId, newcomer.userId],
      );
      expect(message, 'a role was changed on a password alone').toMatch(/row-level security/i);
    });

    const { rows } = await db.query<{ role: string }>(
      'select role from public.memberships where organisation_id = $1 and user_id = $2',
      [organisationId, newcomer.userId],
    );
    expect(rows[0]?.role, 'the change survived the refusal').toBe('member');
  });

  it('is allowed to the same owner who answered one', async () => {
    await actingAs(db, { userId: owner.userId, aal: 'aal2' }, async (client) => {
      const message = await expectRefusal(
        client,
        `update public.memberships set role = 'admin'
          where organisation_id = $1 and user_id = $2`,
        [organisationId, newcomer.userId],
      );
      expect(message, 'no role can be changed at all').toBe('');
    });
  });
});
