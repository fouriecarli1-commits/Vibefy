/**
 * Human-in-the-loop certification, and "no finding without evidence".
 *
 * AI generates the assessment; a human must approve before anything is
 * certified. And a finding the engine could not evidence is withheld rather
 * than published — a false accusation against a customer's app is a legal and
 * reputational event, not a rounding error.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connect, expectRefusal } from './setup/client.ts';
import {
  makeReviewer,
  seedAccount,
  seedAssessment,
  seedFinding,
  type SeededAccount,
} from './setup/seed.ts';

let db: Client;
let owner: SeededAccount;
let reviewer: SeededAccount;

beforeAll(async () => {
  db = await connect();
  owner = await seedAccount(db, 'review-owner');
  reviewer = await seedAccount(db, 'review-reviewer');
  await makeReviewer(db, reviewer.userId);
});

afterAll(async () => {
  await db?.end();
});

describe('no finding without evidence', () => {
  it('refuses to send an assessment to review while a published finding has no evidence', async () => {
    const { assessmentId } = await seedAssessment(db, owner);
    await seedFinding(db, owner, assessmentId, { withEvidence: false });
    await db.query('begin');
    const message = await expectRefusal(
      db,
      `update public.assessments set status = 'awaiting_review' where id = $1`,
      [assessmentId],
    );
    expect(message).toMatch(/have no evidence/i);
    await db.query('rollback');
  });

  it('allows it once the finding is withheld with a stated reason', async () => {
    const { assessmentId } = await seedAssessment(db, owner);
    const findingId = await seedFinding(db, owner, assessmentId, { withEvidence: false });
    await db.query(
      `update public.findings set is_published = false, withheld_reason = $2 where id = $1`,
      [findingId, 'Model asserted this but produced no reproducible evidence.'],
    );
    await expect(
      db.query(`update public.assessments set status = 'awaiting_review' where id = $1`, [
        assessmentId,
      ]),
    ).resolves.toBeDefined();
  });

  it('refuses to withhold a finding without a reason', async () => {
    const { assessmentId } = await seedAssessment(db, owner);
    const findingId = await seedFinding(db, owner, assessmentId);
    await db.query('begin');
    const message = await expectRefusal(
      db,
      `update public.findings set is_published = false where id = $1`,
      [findingId],
    );
    expect(message).toMatch(/withheld_needs_reason/i);
    await db.query('rollback');
  });
});

describe('AI never certifies alone', () => {
  it('refuses to approve an assessment with no recorded human review', async () => {
    const { assessmentId } = await seedAssessment(db, owner);
    await seedFinding(db, owner, assessmentId);
    await db.query(`update public.assessments set status = 'awaiting_review' where id = $1`, [
      assessmentId,
    ]);
    await db.query('begin');
    const message = await expectRefusal(
      db,
      `update public.assessments set status = 'approved' where id = $1`,
      [assessmentId],
    );
    expect(message).toMatch(/without a recorded human review/i);
    await db.query('rollback');
  });

  it('refuses to skip the review queue entirely', async () => {
    const { assessmentId } = await seedAssessment(db, owner);
    await db.query('begin');
    const message = await expectRefusal(
      db,
      `update public.assessments set status = 'approved' where id = $1`,
      [assessmentId],
    );
    expect(message).toMatch(/must pass through awaiting_review/i);
    await db.query('rollback');
  });

  it('refuses a score override that carries no written reason', async () => {
    const { assessmentId } = await seedAssessment(db, owner);
    await db.query('begin');
    const message = await expectRefusal(
      db,
      `insert into public.reviews (assessment_id, organisation_id, reviewer_id, action)
       values ($1, $2, $3, 'adjusted')`,
      [assessmentId, owner.organisationId, reviewer.userId],
    );
    expect(message).toMatch(/override_needs_reason/i);
    await db.query('rollback');
  });

  it('keeps review actions immutable once written', async () => {
    const { assessmentId } = await seedAssessment(db, owner);
    const { rows } = await db.query<{ id: string }>(
      `insert into public.reviews (assessment_id, organisation_id, reviewer_id, action, reason)
       values ($1, $2, $3, 'adjusted', 'Downgraded severity after re-reading the trace.') returning id`,
      [assessmentId, owner.organisationId, reviewer.userId],
    );
    await db.query('begin');
    const message = await expectRefusal(
      db,
      `update public.reviews set reason = 'Changed' where id = $1`,
      [rows[0]!.id],
    );
    expect(message).toMatch(/append-only/i);
    await db.query('rollback');
  });

  it('lets only a reviewer record a review action', async () => {
    const { assessmentId } = await seedAssessment(db, owner);
    await db.query('begin');
    await db.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({ sub: owner.userId, role: 'authenticated' }),
    ]);
    await db.query('set local role authenticated');
    const message = await expectRefusal(
      db,
      `insert into public.reviews (assessment_id, organisation_id, reviewer_id, action, reason)
       values ($1, $2, $3, 'approved', 'Self-approved.')`,
      [assessmentId, owner.organisationId, owner.userId],
    );
    expect(message).toMatch(/row-level security/i);
    await db.query('rollback');
  });
});

describe('the certification gate is a gate, not arithmetic', () => {
  it('refuses certification eligibility while a critical security finding stands', async () => {
    const { assessmentId } = await seedAssessment(db, owner);
    await seedFinding(db, owner, assessmentId, {
      dimension: 'security_posture',
      severity: 'critical',
      ruleId: 'SEC-04',
    });
    await db.query('begin');
    const message = await expectRefusal(
      db,
      `update public.assessments set certification_eligible = true where id = $1`,
      [assessmentId],
    );
    expect(message).toMatch(/critical security or privacy finding/i);
    await db.query('rollback');
  });

  it('applies the same gate to critical privacy findings', async () => {
    const { assessmentId } = await seedAssessment(db, owner);
    await seedFinding(db, owner, assessmentId, {
      dimension: 'data_privacy_practice',
      severity: 'critical',
      ruleId: 'PRI-04',
    });
    await db.query('begin');
    const message = await expectRefusal(
      db,
      `update public.assessments set certification_eligible = true where id = $1`,
      [assessmentId],
    );
    expect(message).toMatch(/critical security or privacy finding/i);
    await db.query('rollback');
  });
});
