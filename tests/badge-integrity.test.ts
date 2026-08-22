/**
 * Badge integrity.
 *
 * Vibefy's asset is the credibility of the mark, not the testing. A badge that
 * can be issued without being earned, that never expires, or whose history can
 * be rewritten would end the business, so these are treated as security tests.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connect, expectRefusal } from './setup/client.ts';
import {
  acceptBadgeLicence,
  approveAssessment,
  issueBadge,
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
  owner = await seedAccount(db, 'badge-owner');
  reviewer = await seedAccount(db, 'badge-reviewer');
  await makeReviewer(db, reviewer.userId);
});

afterAll(async () => {
  await db?.end();
});

describe('a badge must be earned', () => {
  it('cannot issue against an assessment no human has approved', async () => {
    const { appId, assessmentId } = await seedAssessment(db, owner);
    const consentId = await acceptBadgeLicence(db, owner);
    await db.query('begin');
    await expect(issueBadge(db, owner, { appId, assessmentId, consentId })).rejects.toThrow(
      /not approved by a human reviewer/i,
    );
    await db.query('rollback');
  });

  it('cannot issue against an assessment that failed the certification gate', async () => {
    const { appId, assessmentId } = await seedAssessment(db, owner);
    await seedFinding(db, owner, assessmentId);
    await approveAssessment(db, owner, assessmentId, reviewer.userId, {
      certificationEligible: false,
    });
    const consentId = await acceptBadgeLicence(db, owner);
    await db.query('begin');
    await expect(issueBadge(db, owner, { appId, assessmentId, consentId })).rejects.toThrow(
      /did not meet the certification gate/i,
    );
    await db.query('rollback');
  });

  it('cannot issue without an accepted Badge Licence', async () => {
    const { appId, assessmentId } = await seedAssessment(db, owner);
    await seedFinding(db, owner, assessmentId);
    await approveAssessment(db, owner, assessmentId, reviewer.userId);
    const { rows } = await db.query<{ id: string }>(
      `insert into public.consents (user_id, organisation_id, document_type, document_version, document_sha256)
       values ($1, $2, 'terms_of_service', '1.0.0', repeat('a', 64)) returning id`,
      [owner.userId, owner.organisationId],
    );
    await db.query('begin');
    await expect(
      issueBadge(db, owner, { appId, assessmentId, consentId: rows[0]!.id }),
    ).rejects.toThrow(/without an accepted Badge Licence/i);
    await db.query('rollback');
  });

  it('issues when the assessment was approved, eligible and licensed', async () => {
    const { appId, assessmentId } = await seedAssessment(db, owner);
    await seedFinding(db, owner, assessmentId);
    await approveAssessment(db, owner, assessmentId, reviewer.userId);
    const consentId = await acceptBadgeLicence(db, owner);
    await expect(issueBadge(db, owner, { appId, assessmentId, consentId })).resolves.toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });
});

describe('a badge always expires', () => {
  it('refuses a validity period beyond twelve months', async () => {
    const { appId, assessmentId } = await seedAssessment(db, owner);
    await seedFinding(db, owner, assessmentId);
    await approveAssessment(db, owner, assessmentId, reviewer.userId);
    const consentId = await acceptBadgeLicence(db, owner);
    await db.query('begin');
    await expect(
      issueBadge(db, owner, { appId, assessmentId, consentId, expiresInMonths: 18 }),
    ).rejects.toThrow(/expiry_is_bounded/i);
    await db.query('rollback');
  });

  it('reads as expired the moment it passes its expiry, whatever the stored status says', async () => {
    const { appId, assessmentId } = await seedAssessment(db, owner);
    await seedFinding(db, owner, assessmentId);
    await approveAssessment(db, owner, assessmentId, reviewer.userId);
    const consentId = await acceptBadgeLicence(db, owner);
    const badgeId = await issueBadge(db, owner, { appId, assessmentId, consentId });

    // Simulate a scheduled expiry job that never ran.
    await db.query(
      `update public.badges set issued_at = now() - interval '12 months', expires_at = now() - interval '1 day' where id = $1`,
      [badgeId],
    );
    const { rows } = await db.query(
      `select public.badge_effective_status(b) as status from public.badges b where b.id = $1`,
      [badgeId],
    );
    expect(rows[0].status).toBe('expired');
  });
});

describe('badge history is evidence', () => {
  it('writes an append-only event for issuance and for every status change', async () => {
    const { appId, assessmentId } = await seedAssessment(db, owner);
    await seedFinding(db, owner, assessmentId);
    await approveAssessment(db, owner, assessmentId, reviewer.userId);
    const consentId = await acceptBadgeLicence(db, owner);
    const badgeId = await issueBadge(db, owner, { appId, assessmentId, consentId });

    await db.query(
      `update public.badges set status = 'revoked', revocation_reason = 'Material regression on re-assessment' where id = $1`,
      [badgeId],
    );

    const { rows } = await db.query<{ event_type: string }>(
      `select event_type from public.badge_events where badge_id = $1 order by occurred_at, id`,
      [badgeId],
    );
    expect(rows.map((r) => r.event_type)).toEqual(['issued', 'revoked']);

    await db.query('begin');
    const message = await expectRefusal(db, `delete from public.badge_events where badge_id = $1`, [
      badgeId,
    ]);
    expect(message).toMatch(/append-only/i);
    await db.query('rollback');
  });

  it('refuses revocation without a stated reason', async () => {
    const { appId, assessmentId } = await seedAssessment(db, owner);
    await seedFinding(db, owner, assessmentId);
    await approveAssessment(db, owner, assessmentId, reviewer.userId);
    const consentId = await acceptBadgeLicence(db, owner);
    const badgeId = await issueBadge(db, owner, { appId, assessmentId, consentId });

    await db.query('begin');
    const message = await expectRefusal(db, `update public.badges set status = 'revoked' where id = $1`, [
      badgeId,
    ]);
    expect(message).toMatch(/revoked_needs_reason/i);
    await db.query('rollback');
  });

  it('allows only one live badge per app', async () => {
    const { appId, assessmentId } = await seedAssessment(db, owner);
    await seedFinding(db, owner, assessmentId);
    await approveAssessment(db, owner, assessmentId, reviewer.userId);
    const consentId = await acceptBadgeLicence(db, owner);
    await issueBadge(db, owner, { appId, assessmentId, consentId });

    await db.query('begin');
    const message = await expectRefusal(
      db,
      `insert into public.badges (
         app_id, organisation_id, assessment_id, slug, public_id, rubric_version, score,
         assessed_at, certified_origin, payload, signature, signing_key_id, licence_consent_id, expires_at
       ) values ($1, $2, $3, 'duplicate-badge', 'duplicate_badge_publicid', '1.0.0', 90,
         now(), 'https://app.example.test', '{}'::jsonb, 'sig', 'key-2026-01', $4, now() + interval '6 months')`,
      [appId, owner.organisationId, assessmentId, consentId],
    );
    expect(message).toMatch(/badges_one_active_per_app/i);
    await db.query('rollback');
  });
});
