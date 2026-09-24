/**
 * A review row authorises the transition it actually describes.
 *
 * `public.assert_human_review` is Gate 3, and it is the gate the public
 * verification page states as fact: "A person read the result before anything
 * was issued... the database refuses to record one without a named reviewer."
 * Every badge this product will ever put on somebody's website stands behind it.
 *
 * What it checked was weaker than what it claimed:
 *
 *     if not exists (
 *       select 1 from public.reviews r
 *       where r.assessment_id = new.id
 *         and r.created_at >= now() - interval '1 hour'
 *     )
 *
 * Any review row, of any action, by any reviewer, within the hour. The row's
 * own `action` column — the column that records what the human decided — was
 * never read. So the gate was satisfied by a review that said the opposite of
 * the transition it was admitting:
 *
 *   · A row saying `rejected` authorised `status = 'approved'`. The assessment
 *     then carried an approval whose only recorded human decision was a
 *     rejection, with the reviewer's written reason for rejecting it attached.
 *   · A row saying `adjusted` did the same. `adjustAssessment` in
 *     `apps/web/app/review/actions.ts` writes one on every score correction and
 *     then updates only `overall_score`, leaving the assessment in
 *     `awaiting_review` — so every adjustment minted a live approval token that
 *     stayed valid for an hour.
 *
 * Neither needs malice to happen. The two server actions each write the review
 * row and then update the assessment in two separate statements, with no
 * transaction around them, so a refused update leaves a committed review row
 * behind; `reviews` is append-only, so it cannot be withdrawn. The hour-long
 * window then made that orphan an authorisation for whichever transition came
 * next.
 *
 * The fix reads the column that was already there. The window and the
 * `awaiting_review` precondition are unchanged — they were not the defect.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connect } from './setup/client.ts';
import { makeReviewer, seedAccount, seedAssessment, type SeededAccount } from './setup/seed.ts';

let db: Client;
let owner: SeededAccount;
let reviewer: SeededAccount;
let other: SeededAccount;

beforeAll(async () => {
  db = await connect();
  owner = await seedAccount(db, 'gate3-owner');
  reviewer = await seedAccount(db, 'gate3-reviewer');
  other = await seedAccount(db, 'gate3-other-reviewer');
  await makeReviewer(db, reviewer.userId);
  await makeReviewer(db, other.userId);
});

afterAll(async () => {
  await db?.end();
});

/** An assessment sitting exactly where a reviewer finds one. */
async function awaitingReview(): Promise<string> {
  const seeded = await seedAssessment(db, owner);
  await db.query(
    `update public.assessments
        set status = 'awaiting_review', overall_score = 82.5, completed_at = now(),
            dimension_scores = $2::jsonb
      where id = $1`,
    [
      seeded.assessmentId,
      JSON.stringify([{ dimension: 'security_posture', score: 82.5, weight: 0.3, band: 'Good' }]),
    ],
  );
  return seeded.assessmentId;
}

/** A review row of a given action, written the way the server action writes it. */
async function recordReview(
  assessmentId: string,
  action: 'approved' | 'adjusted' | 'rejected',
  reviewerId: string = reviewer.userId,
): Promise<void> {
  await db.query(
    `insert into public.reviews (assessment_id, organisation_id, reviewer_id, action, reason)
     values ($1, $2, $3, $4, 'Findings and evidence read against the published rubric.')`,
    [assessmentId, owner.organisationId, reviewerId, action],
  );
}

async function moveTo(assessmentId: string, status: 'approved' | 'rejected'): Promise<void> {
  await db.query(`update public.assessments set status = $2, reviewed_at = now() where id = $1`, [
    assessmentId,
    status,
  ]);
}

describe('a review that says the opposite of the transition', () => {
  it('does not authorise an approval on the strength of a rejection', async () => {
    const assessmentId = await awaitingReview();
    await recordReview(assessmentId, 'rejected');

    await expect(moveTo(assessmentId, 'approved')).rejects.toThrow(/human review/i);
  });

  it('does not authorise an approval on the strength of an adjustment', async () => {
    // The one that happened on its own. Every score correction wrote one of
    // these and left the assessment awaiting review.
    const assessmentId = await awaitingReview();
    await recordReview(assessmentId, 'adjusted');

    await expect(moveTo(assessmentId, 'approved')).rejects.toThrow(/human review/i);
  });

  it('does not authorise a rejection on the strength of an approval', async () => {
    const assessmentId = await awaitingReview();
    await recordReview(assessmentId, 'approved');

    await expect(moveTo(assessmentId, 'rejected')).rejects.toThrow(/human review/i);
  });

  it('names the action it wanted, so a reviewer can tell what is missing', async () => {
    const assessmentId = await awaitingReview();
    await recordReview(assessmentId, 'adjusted');

    await expect(moveTo(assessmentId, 'approved')).rejects.toThrow(/approved/);
  });
});

describe('the review that does describe the transition', () => {
  it('still authorises an approval', async () => {
    // A gate that refuses the people it is supposed to admit is the same outage
    // as one that admits the people it is supposed to refuse, arriving from the
    // other direction.
    const assessmentId = await awaitingReview();
    await recordReview(assessmentId, 'approved');
    await moveTo(assessmentId, 'approved');

    const { rows } = await db.query<{ status: string }>(
      'select status from public.assessments where id = $1',
      [assessmentId],
    );
    expect(rows[0]?.status).toBe('approved');
  });

  it('still authorises a rejection', async () => {
    const assessmentId = await awaitingReview();
    await recordReview(assessmentId, 'rejected');
    await moveTo(assessmentId, 'rejected');

    const { rows } = await db.query<{ status: string }>(
      'select status from public.assessments where id = $1',
      [assessmentId],
    );
    expect(rows[0]?.status).toBe('rejected');
  });

  it('is not required to come from the reviewer running the update', async () => {
    // Deliberately unchanged. The trigger sees `auth.uid()` only when the update
    // arrives through PostgREST, and an operator correcting a stuck row on the
    // owning connection has no `auth.uid()` at all — so requiring the two to
    // match would refuse the one path that exists to unstick anything. Who
    // decided is recorded in the row; that it was the same person who pressed
    // the button is a separate question, and it is in docs/OPEN_ITEMS.md.
    const assessmentId = await awaitingReview();
    await recordReview(assessmentId, 'approved', other.userId);
    await moveTo(assessmentId, 'approved');

    const { rows } = await db.query<{ status: string }>(
      'select status from public.assessments where id = $1',
      [assessmentId],
    );
    expect(rows[0]?.status).toBe('approved');
  });

  it('is still required to be recent', async () => {
    // The hour is an existing decision and this is what holds it.
    const assessmentId = await awaitingReview();
    // Written stale rather than aged, because `reviews` is append-only and an
    // UPDATE to `created_at` is refused — which is itself the reason the orphan
    // row in the header cannot simply be withdrawn.
    await db.query(
      `insert into public.reviews
         (assessment_id, organisation_id, reviewer_id, action, reason, created_at)
       values ($1, $2, $3, 'approved', 'Read against the published rubric.', now() - interval '2 hours')`,
      [assessmentId, owner.organisationId, reviewer.userId],
    );

    await expect(moveTo(assessmentId, 'approved')).rejects.toThrow(/human review/i);
  });
});
