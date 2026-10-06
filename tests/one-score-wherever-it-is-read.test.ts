/**
 * One score, wherever it is read.
 *
 * The product says this in its own words, on the report screen: "Your score is
 * the same number wherever you read it." It reads as a description of a
 * database. It was a promise about two columns, and nothing was keeping it.
 *
 * `assessments.overall_score` is what the owner's console and report show.
 * `badges.score` is what every public surface shows — the verification page the
 * mark links to, the badge image itself, the directory, a builder's profile.
 * It is written once, at issue, and never again.
 *
 * Two ways they came apart, and neither left a trace. At issue, because
 * `assert_badge_is_earned` checked the rubric version and not the number —
 * having said, of the rubric version, that a badge "must carry the rubric
 * version the assessment was scored against". And afterwards, because
 * `adjustAssessment` exists so a reviewer can correct a score and places no
 * restriction on the assessment's status.
 *
 * The second is the one that matters, in one direction. A mark still claiming
 * the higher figure after we decided it was wrong is the product over-claiming
 * on somebody else's website.
 *
 * Found by a fixture: `issueBadge` wrote a literal 82.5 against an assessment
 * approved at 82.4, and nothing had noticed for six weeks.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { connect } from './setup/client.ts';
import { seedBadgedApp } from './setup/seed.ts';

let db: Client;

beforeAll(async () => {
  db = await connect();
});

afterAll(async () => {
  await db.end();
});

/** What the console shows, and what a stranger shows up to. */
async function numbers(appId: string, assessmentId: string) {
  const assessment = await db.query<{ overall_score: string }>(
    `select overall_score from public.assessments where id = $1`,
    [assessmentId],
  );
  const published = await db.query<{ score: string }>(
    `select v.score
       from public.badge_verification v
       join public.badges b on b.slug = v.slug
      where b.app_id = $1 and b.status <> 'revoked'`,
    [appId],
  );
  return {
    report: Number(assessment.rows[0]!.overall_score),
    public: published.rows[0] ? Number(published.rows[0].score) : null,
  };
}

describe('the number on the mark', () => {
  it('is the number in the report, from the moment it is issued', async () => {
    const { appId, assessmentId } = await seedBadgedApp(db, 'one-score-issue');
    const seen = await numbers(appId, assessmentId);
    expect(seen.public).toBe(seen.report);
  });

  it('cannot be issued carrying a different one', async () => {
    const { appId, assessmentId } = await seedBadgedApp(db, 'one-score-refuse');
    // Everything this insert needs except the score is taken from the badge
    // that already exists, so the only thing under test is the number.
    const { rows } = await db.query<{
      organisation_id: string;
      overall_score: string;
      licence_consent_id: string;
    }>(
      `select a.organisation_id, a.overall_score, b.licence_consent_id
         from public.assessments a
         join public.badges b on b.assessment_id = a.id
        where a.id = $1`,
      [assessmentId],
    );
    const slug = `second-${randomUUID().slice(0, 8)}`;

    await expect(
      db.query(
        `insert into public.badges (
           app_id, organisation_id, assessment_id, slug, public_id, rubric_version, score,
           assessed_at, certified_origin, payload, signature, signing_key_id,
           licence_consent_id, expires_at
         ) values ($1, $2, $3, $4, $5,
           (select rubric_version from public.assessments where id = $3),
           $6, now(), 'https://app.example.test', '{}'::jsonb, 'sig', 'key-2026-01',
           $7, now() + interval '12 months')`,
        [
          appId,
          rows[0]!.organisation_id,
          assessmentId,
          slug,
          slug.replace(/-/g, '_') + '_publicid',
          Number(rows[0]!.overall_score) + 5,
          rows[0]!.licence_consent_id,
        ],
      ),
      // The figure the whole product is about, and the one field of the mark
      // that was free.
    ).rejects.toThrow(/must carry the score its assessment was given/i);
  });
});

describe('an adjustment after the badge was issued', () => {
  it('is refused, and says what to do instead', async () => {
    const { assessmentId } = await seedBadgedApp(db, 'one-score-adjust');
    await expect(
      db.query(`update public.assessments set overall_score = 61.0 where id = $1`, [assessmentId]),
    ).rejects.toThrow(/Revoke the badge, adjust, and issue again/i);
  });

  it('names how many marks are standing, because that is what is in the way', async () => {
    const { assessmentId } = await seedBadgedApp(db, 'one-score-count');
    await expect(
      db.query(`update public.assessments set overall_score = 61.0 where id = $1`, [assessmentId]),
    ).rejects.toThrow(/carries 1 badge\(s\)/i);
  });

  it('leaves everything else about the assessment adjustable', async () => {
    // The guard is on one column. A reviewer must still be able to work.
    const { assessmentId } = await seedBadgedApp(db, 'one-score-other');
    await db.query(`update public.assessments set reviewed_at = now() where id = $1`, [
      assessmentId,
    ]);
    const { rowCount } = await db.query(`select 1 from public.assessments where id = $1`, [
      assessmentId,
    ]);
    expect(rowCount).toBe(1);
  });

  it('is allowed once the mark has been revoked, which is the published process', async () => {
    const { appId, assessmentId } = await seedBadgedApp(db, 'one-score-revoked');
    await db.query(
      `update public.badges
          set status = 'revoked', revoked_at = now(),
              revocation_reason = 'Score corrected after review.'
        where assessment_id = $1`,
      [assessmentId],
    );

    await db.query(`update public.assessments set overall_score = 61.0 where id = $1`, [
      assessmentId,
    ]);

    const seen = await numbers(appId, assessmentId);
    expect(seen.report).toBe(61);
    // Nothing public claims anything any more, which is the honest state
    // between a correction and a reissue.
    expect(seen.public).toBeNull();
  });

  it('does not stand in the way of an assessment nobody has badged', async () => {
    const { rows } = await db.query<{ id: string }>(
      `select a.id from public.assessments a
        where not exists (select 1 from public.badges b where b.assessment_id = a.id)
          and a.overall_score is not null
        limit 1`,
    );
    if (!rows[0]) return;
    await db.query(`update public.assessments set overall_score = 55.5 where id = $1`, [
      rows[0].id,
    ]);
    const { rows: after } = await db.query<{ overall_score: string }>(
      `select overall_score from public.assessments where id = $1`,
      [rows[0].id],
    );
    expect(Number(after[0]!.overall_score)).toBe(55.5);
  });
});
