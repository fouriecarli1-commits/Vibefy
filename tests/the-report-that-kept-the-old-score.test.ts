/**
 * The stored report, after a reviewer changes the score it states.
 *
 * `/review/[id]` offers three things: approve, reject, and adjust the overall
 * score with a written reason. The third is the one the Appeals & Corrections
 * Policy leans on — "upheld (finding withdrawn or amended, score recomputed)" —
 * and it writes a new `overall_score` and a new `reviewed_at` to an assessment
 * that, by then, usually already has a report.
 *
 * `sweepPendingReports` asked one question: is there an HTML report for this
 * assessment? There was. So nothing regenerated, and the two surfaces parted
 * company:
 *
 *   · `/console/reports/[id]` renders from the assessment at request time, and
 *     showed the corrected score;
 *   · the PDF download serves the stored bytes, deliberately — "if the console
 *     re-rendered it on every request, two copies of the same report could
 *     differ, and the one the customer showed an investor would be the one
 *     nobody could reproduce" — and went on stating the old one.
 *
 * Freezing the bytes is right. It is only honest while the facts behind them
 * cannot change, and an adjustment is the path that changes them. The sweep now
 * asks whether the report is older than the review, so the frozen copy is the
 * current one.
 *
 * Why the sweep rather than a delete in the console action: the sweep is the
 * self-healing half of this design, and a condition there covers any path that
 * revises an assessment, including ones nobody has written yet. The policy
 * promises a withdrawn finding too, and nothing in the shipped tree can
 * withhold one — `docs/OPEN_ITEMS.md` carries that, because it is a feature and
 * not mine to add.
 *
 * The public number was already dealt with, and differently.
 * `20261006200000_one_score_wherever_it_is_read.sql` refuses an adjustment
 * while a badge is live — a signed attestation rewritten under its own
 * signature would mean nothing — so the sequence is revoke, adjust, issue
 * again. What was left is this: an assessment carrying no badge, and the
 * window inside that sequence.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { LocalReportStorage, sweepPendingReports } from '../apps/worker/src/report.ts';
import { connect } from './setup/client.ts';
import {
  approveAssessment,
  makeReviewer,
  seedAccount,
  seedAssessment,
  seedFinding,
  type SeededAccount,
} from './setup/seed.ts';

const SCOPE_STATEMENT =
  'This assessment is a point-in-time, scope-limited, AI-assisted and human-reviewed evaluation conducted against a published rubric version on a stated date. It is not a guarantee of any kind. Absence of a finding is not evidence of absence of a defect.';

let db: Client;
let pool: Pool;
let owner: SeededAccount;
let reviewer: SeededAccount;
let storageRoot: string;
let storage: LocalReportStorage;
let assessmentId: string;

const storedReport = async () => {
  const { rows } = await db.query<{ storage_path: string; generated_at: string }>(
    `select storage_path, generated_at from public.reports
      where assessment_id = $1 and format = 'html'`,
    [assessmentId],
  );
  const row = rows[0];
  if (!row) throw new Error('No stored HTML report');
  return { ...row, html: readFileSync(join(storageRoot, row.storage_path), 'utf8') };
};

beforeAll(async () => {
  db = await connect();
  const dsn = new URL(process.env.VIBEFYCODE_TEST_DSN!);
  pool = new Pool({
    host: dsn.searchParams.get('host')!,
    database: dsn.pathname.slice(1),
    user: 'postgres',
  });
  storageRoot = mkdtempSync(join(tmpdir(), 'vibefycode-stale-'));
  storage = new LocalReportStorage(storageRoot);

  owner = await seedAccount(db, 'stale-report-owner');
  reviewer = await seedAccount(db, 'stale-report-reviewer');
  await makeReviewer(db, reviewer.userId);

  const seeded = await seedAssessment(db, owner);
  assessmentId = seeded.assessmentId;
  await seedFinding(db, owner, assessmentId, { ruleId: 'SEC-02', severity: 'medium' });
  await db.query(
    `update public.assessments
        set overall_score = 41.5, scope_statement = $2,
            prompt_bundle_sha256 = repeat('c', 64), dimension_scores = '[]'::jsonb,
            completed_at = now()
      where id = $1`,
    [assessmentId, SCOPE_STATEMENT],
  );
  await approveAssessment(db, owner, assessmentId, reviewer.userId, {
    certificationEligible: false,
    score: 41.5,
  });
  await sweepPendingReports(pool, storage);
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await db?.end();
  if (storageRoot) rmSync(storageRoot, { recursive: true, force: true });
});

describe('a report that is already current', () => {
  it('states the approved score, and is not generated again', async () => {
    const before = await storedReport();
    expect(before.html).toContain('41.5');

    // The positive control for every case below: a sweep that regenerated
    // everything on every pass would also "fix" a stale report, and would be
    // wrong for a different reason.
    expect(await sweepPendingReports(pool, storage)).toBe(0);
    const after = await storedReport();
    expect(after.generated_at).toEqual(before.generated_at);
  }, 60_000);
});

describe('a report the reviewer has overtaken', () => {
  it('is regenerated, and states the adjusted score', async () => {
    const before = await storedReport();

    // What `adjustAssessment` writes: a review row with both scores, the new
    // overall, and a fresh `reviewed_at`. Written here directly because the
    // action itself runs through a Supabase client and a signed-in reviewer;
    // what the sweep can see is the two columns.
    await db.query(
      `insert into public.reviews
         (assessment_id, organisation_id, reviewer_id, action, reason, previous_scores, new_scores)
       values ($1, $2, $3, 'adjusted', $4, $5, $6)`,
      [
        assessmentId,
        owner.organisationId,
        reviewer.userId,
        'The customer appealed the severity of SEC-02 and was right about it.',
        JSON.stringify({ overall: 41.5, dimensions: [] }),
        JSON.stringify({ overall: 63.25, dimensions: [] }),
      ],
    );
    await db.query(
      `update public.assessments set overall_score = 63.25, reviewed_at = now() where id = $1`,
      [assessmentId],
    );

    expect(await sweepPendingReports(pool, storage)).toBeGreaterThanOrEqual(1);

    const after = await storedReport();
    expect(after.html).toContain('63.25');
    expect(after.html).not.toContain('41.5');
    expect(new Date(after.generated_at).getTime()).toBeGreaterThan(
      new Date(before.generated_at).getTime(),
    );
  }, 60_000);

  it('is left alone once it has caught up', async () => {
    expect(await sweepPendingReports(pool, storage)).toBe(0);
  }, 60_000);
});
