/**
 * A reviewer approving an assessment as a reviewer, not as the database owner.
 *
 * Every existing test of this path — the four-act journey, the human-review
 * suite, the remediation wall — writes the review row on the owning connection,
 * which bypasses row-level security entirely. That is the right shape for what
 * those tests are about (the triggers, the immutability, the gates), and it
 * means the one thing none of them can tell us is whether a real reviewer,
 * arriving through PostgREST with an access token, can actually do it.
 *
 * Worth closing on its own, and worth closing now: a restrictive policy
 * requiring a second step has just been put in front of this exact insert, and
 * the approval is the gate on every badge this product will ever issue. A
 * policy that refuses the people it is supposed to admit is the same outage as
 * one that admits the people it is supposed to refuse, arriving from the other
 * direction.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { Client } from 'pg';
import { committingAs, connect } from './setup/client.ts';
import { makeReviewer, seedAccount, seedAssessment, type SeededAccount } from './setup/seed.ts';

let db: Client;
let reviewer: SeededAccount;
let owner: SeededAccount;

beforeAll(async () => {
  db = await connect();
  owner = await seedAccount(db, 'rls-review-owner');
  reviewer = await seedAccount(db, 'rls-review-reviewer');
  await makeReviewer(db, reviewer.userId);
});

afterAll(async () => {
  await db?.end();
});

/** An assessment sitting where a reviewer finds one: scored and awaiting review. */
async function awaitingReview(score = 82.5) {
  const seeded = await seedAssessment(db, owner);
  await db.query(
    `update public.assessments
        set status = 'awaiting_review', overall_score = $2, completed_at = now(),
            dimension_scores = $3::jsonb
      where id = $1`,
    [
      seeded.assessmentId,
      score,
      JSON.stringify([{ dimension: 'security_posture', score, weight: 0.3, band: 'Good' }]),
    ],
  );
  return seeded;
}

describe('the approval, done through row-level security', () => {
  it('a reviewer at the higher assurance level can complete it', async () => {
    const { assessmentId } = await awaitingReview();

    const outcome = await committingAs(
      db,
      { userId: reviewer.userId, aal: 'aal2' },
      async (client) => {
        await client.query(
          `insert into public.reviews (assessment_id, organisation_id, reviewer_id, action, reason)
           values ($1, $2, $3, 'approved', 'Findings and evidence checked against the rubric.')`,
          [assessmentId, owner.organisationId, reviewer.userId],
        );
        await client.query(
          `update public.assessments
              set status = 'approved', certification_eligible = true, reviewed_at = now()
            where id = $1`,
          [assessmentId],
        );
        return 'done';
      },
    );
    expect(outcome).toBe('done');

    const { rows } = await db.query<{ status: string; certification_eligible: boolean }>(
      `select status::text, certification_eligible from public.assessments where id = $1`,
      [assessmentId],
    );
    expect(rows[0]!.status).toBe('approved');
    expect(rows[0]!.certification_eligible).toBe(true);
  });

  it('is refused at the lower one, and the assessment does not move', async () => {
    const { assessmentId } = await awaitingReview();

    await expect(
      committingAs(db, { userId: reviewer.userId, aal: 'aal1' }, async (client) => {
        await client.query(
          `insert into public.reviews (assessment_id, organisation_id, reviewer_id, action, reason)
           values ($1, $2, $3, 'approved', 'Findings and evidence checked against the rubric.')`,
          [assessmentId, owner.organisationId, reviewer.userId],
        );
      }),
    ).rejects.toThrow(/row-level security/i);

    // The point of asserting this separately: a refusal that still moved the
    // assessment would be worse than no refusal, because the queue would show
    // the work as done.
    const { rows } = await db.query<{ status: string }>(
      `select status::text from public.assessments where id = $1`,
      [assessmentId],
    );
    expect(rows[0]!.status).toBe('awaiting_review');
  });

  it('is refused for somebody who is not a reviewer, whatever their assurance level', async () => {
    const { assessmentId } = await awaitingReview();
    await expect(
      committingAs(db, { userId: owner.userId, aal: 'aal2' }, async (client) => {
        await client.query(
          `insert into public.reviews (assessment_id, organisation_id, reviewer_id, action, reason)
           values ($1, $2, $3, 'approved', 'I would like a badge please.')`,
          [assessmentId, owner.organisationId, owner.userId],
        );
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it('cannot be written in somebody else’s name', async () => {
    // `reviews_insert_reviewers` also asks `reviewer_id = auth.uid()`. A review
    // is evidence about who looked, and evidence somebody else can sign is not
    // evidence.
    const { assessmentId } = await awaitingReview();
    const second = await seedAccount(db, 'rls-review-other');
    await makeReviewer(db, second.userId);
    await expect(
      committingAs(db, { userId: reviewer.userId, aal: 'aal2' }, async (client) => {
        await client.query(
          `insert into public.reviews (assessment_id, organisation_id, reviewer_id, action, reason)
           values ($1, $2, $3, 'approved', 'Findings and evidence checked against the rubric.')`,
          [assessmentId, owner.organisationId, second.userId],
        );
      }),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('suspending a live badge, through row-level security', () => {
  it('a reviewer at the higher level can, and at the lower one cannot', async () => {
    const { assessmentId, appId } = await awaitingReview();
    await committingAs(db, { userId: reviewer.userId, aal: 'aal2' }, async (client) => {
      await client.query(
        `insert into public.reviews (assessment_id, organisation_id, reviewer_id, action, reason)
         values ($1, $2, $3, 'approved', 'Findings and evidence checked against the rubric.')`,
        [assessmentId, owner.organisationId, reviewer.userId],
      );
      await client.query(
        `update public.assessments
            set status = 'approved', certification_eligible = true, reviewed_at = now()
          where id = $1`,
        [assessmentId],
      );
    });

    // Issued the way the worker issues one: on the owning connection, with the
    // service role, which is where issuance actually happens.
    const consent = await db.query<{ id: string }>(
      `insert into public.consents (user_id, organisation_id, document_type, document_version, document_sha256, action)
       values ($1, $2, 'badge_licence', '1.0.0', $3, 'accepted') returning id`,
      [owner.userId, owner.organisationId, 'f'.repeat(64)],
    );
    const badge = await db.query<{ id: string }>(
      `insert into public.badges
         (app_id, organisation_id, assessment_id, slug, public_id, status, rubric_version, score,
          assessed_at, certified_origin, payload, signature, signing_key_id, licence_consent_id,
          issued_at, expires_at)
       values ($1, $2, $3, $4, $5, 'active', '1.0.0', 82.5, now(), 'https://rls.example',
               '{}'::jsonb, 'sig', 'kid', $6, now(), now() + interval '3 months')
       returning id`,
      [
        appId,
        owner.organisationId,
        assessmentId,
        `rls-badge-${Math.random().toString(36).slice(2, 8)}`,
        // 16 to 64 of [A-Za-z0-9_-], which is what the column's check asks for.
        randomBytes(16).toString('base64url'),
        consent.rows[0]!.id,
      ],
    );
    const badgeId = badge.rows[0]!.id;

    await expect(
      committingAs(db, { userId: reviewer.userId, aal: 'aal1' }, async (client) => {
        await client.query(
          `update public.badges
              set status = 'suspended', suspended_at = now(),
                  suspension_reason = 'A re-assessment found a serious new problem.'
            where id = $1`,
          [badgeId],
        );
      }),
    ).rejects.toThrow(/row-level security/i);

    const done = await committingAs(
      db,
      { userId: reviewer.userId, aal: 'aal2' },
      async (client) => {
        const { rowCount } = await client.query(
          `update public.badges
              set status = 'suspended', suspended_at = now(),
                  suspension_reason = 'A re-assessment found a serious new problem.'
            where id = $1`,
          [badgeId],
        );
        return rowCount;
      },
    );
    expect(done).toBe(1);
  });
});
