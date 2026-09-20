/**
 * Keeping reports in step with reviews, and with what was paid.
 *
 * Two behaviours are being checked: that an approved assessment eventually gets
 * a report without anyone having to enqueue one, and that upgrading from free to
 * paid gets the customer the full report without re-running the assessment —
 * same findings, same evidence, same score.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import {
  generateReport,
  LocalReportStorage,
  REPORT_RENDER_ATTEMPTS,
  regenerateForPlanChange,
  resetReportFailureCounts,
  sweepPendingReports,
} from '../apps/worker/src/report.ts';
import { connect } from './setup/client.ts';
import {
  approveAssessment,
  makeReviewer,
  seedAccount,
  seedAssessment,
  seedFinding,
  type SeededAccount,
} from './setup/seed.ts';

let db: Client;
let pool: Pool;
let owner: SeededAccount;
let reviewer: SeededAccount;
let storageRoot: string;
let storage: LocalReportStorage;
let assessmentId: string;
let appId: string;

/** Long enough to be publishable — the generator refuses anything shorter. */
const SCOPE_STATEMENT =
  'This assessment is a point-in-time, scope-limited, AI-assisted and human-reviewed evaluation conducted against a published rubric version on a stated date. It is not a guarantee of any kind. Absence of a finding is not evidence of absence of a defect.';

beforeAll(async () => {
  db = await connect();
  const dsn = new URL(process.env.VIBEFYCODE_TEST_DSN!);
  pool = new Pool({
    host: dsn.searchParams.get('host')!,
    database: dsn.pathname.slice(1),
    user: 'postgres',
  });
  storageRoot = mkdtempSync(join(tmpdir(), 'vibefycode-sweep-'));
  storage = new LocalReportStorage(storageRoot);

  owner = await seedAccount(db, 'sweep-owner');
  reviewer = await seedAccount(db, 'sweep-reviewer');
  await makeReviewer(db, reviewer.userId);

  const seeded = await seedAssessment(db, owner);
  assessmentId = seeded.assessmentId;
  appId = seeded.appId;

  await seedFinding(db, owner, assessmentId, {
    ruleId: 'SEC-04',
    severity: 'critical',
    dimension: 'security_posture',
  });
  await seedFinding(db, owner, assessmentId, { ruleId: 'SEC-02', severity: 'medium' });
  await seedFinding(db, owner, assessmentId, {
    ruleId: 'UX-02',
    severity: 'low',
    dimension: 'practicality_ux',
  });
  await seedFinding(db, owner, assessmentId, {
    ruleId: 'FI-05',
    severity: 'low',
    dimension: 'functional_integrity',
  });

  await db.query(
    `update public.assessments
        set overall_score = 41.5,
            scope_statement = $2,
            prompt_bundle_sha256 = repeat('a', 64),
            dimension_scores = $3,
            report_narrative = $4,
            completed_at = now()
      where id = $1`,
    [
      assessmentId,
      SCOPE_STATEMENT,
      JSON.stringify([
        { dimension: 'security_posture', score: 11, weight: 0.25, band: 'Not ready' },
        { dimension: 'functional_integrity', score: 90, weight: 0.25, band: 'Exemplary' },
      ]),
      JSON.stringify({
        headline: 'Fix the exposed key first.',
        summary: 'The shop works; the security posture does not.',
        strengths: ['Sign-up completes cleanly.'],
        prioritisedRemediation: [
          {
            order: 1,
            title: 'Rotate the key',
            why: 'Anyone can charge cards as you.',
            step: 'Roll it in the dashboard.',
          },
        ],
        notAssessed: ['The payment flow was not exercised.'],
      }),
    ],
  );

  await approveAssessment(db, owner, assessmentId, reviewer.userId, {
    certificationEligible: false,
  });
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await db?.end();
  if (storageRoot) rmSync(storageRoot, { recursive: true, force: true });
});

describe('the sweep', () => {
  it('generates the missing report without anyone enqueueing one', async () => {
    const generated = await sweepPendingReports(pool, storage);
    expect(generated).toBeGreaterThanOrEqual(1);

    const { rows } = await db.query(`select format from public.reports where assessment_id = $1`, [
      assessmentId,
    ]);
    expect(rows.map((row) => row.format)).toContain('html');
  }, 60_000);

  it('renders the free version for a customer who has not paid', async () => {
    const { rows } = await db.query(
      `select storage_path from public.reports where assessment_id = $1 and format = 'html'`,
      [assessmentId],
    );
    const html = readFileSync(join(storageRoot, rows[0].storage_path), 'utf8');
    expect(html).toMatch(/free tier/i);
    expect(html).toMatch(/1 further finding|further findings/i);
    expect(html).not.toMatch(/Roll it in the dashboard/);
  });

  it('does not generate the same report twice', async () => {
    const again = await sweepPendingReports(pool, storage);
    expect(again).toBe(0);
  }, 30_000);
});

describe('when the PDF will not print', () => {
  it('writes nothing at all, so the sweep comes back for it', async () => {
    // The sweep decides there is work to do by looking for an assessment with
    // no HTML report. Writing the HTML row and then failing to print satisfied
    // that test while leaving a paying customer without the format they paid
    // for — and because the sweep only ever asked about HTML, it never came
    // back. The PDF was not late; it was gone.
    const seeded = await seedAssessment(db, owner);
    await seedFinding(db, owner, seeded.assessmentId, { severity: 'low' });
    await db.query(
      `update public.assessments
          set overall_score = 70, scope_statement = $2, prompt_bundle_sha256 = repeat('b', 64),
              dimension_scores = '[]'::jsonb, completed_at = now()
        where id = $1`,
      [seeded.assessmentId, SCOPE_STATEMENT],
    );
    await approveAssessment(db, owner, seeded.assessmentId, reviewer.userId, {
      certificationEligible: false,
    });

    const client = await pool.connect();
    try {
      await expect(
        generateReport(client, storage, {
          assessmentId: seeded.assessmentId,
          tier: 'paid',
          formats: ['html', 'pdf'],
          printPdf: async () => {
            throw new Error('the printer fell over');
          },
        }),
      ).rejects.toThrow(/printer fell over/);
    } finally {
      client.release();
    }

    const { rows } = await db.query('select format from public.reports where assessment_id = $1', [
      seeded.assessmentId,
    ]);
    expect(rows, 'a half-written report is what makes the sweep stop looking').toEqual([]);
  }, 60_000);
});

describe('an assessment that can never be rendered', () => {
  it('stops taking a place in the window that everyone else is queued behind', async () => {
    // The window is twenty rows, ordered oldest-review-first, and a row leaves
    // it only by acquiring a report. One that never can — here, a scope
    // statement too short to publish — sits at the front of it for ever and
    // takes a slot every sweep. Twenty of those and nobody gets a report again,
    // while the log repeats the same errors and never says that part.
    resetReportFailureCounts();
    const doomed = await seedAssessment(db, owner);
    await seedFinding(db, owner, doomed.assessmentId, { severity: 'low' });
    await db.query(
      `update public.assessments
          set overall_score = 55, scope_statement = 'Too short to publish.',
              prompt_bundle_sha256 = repeat('c', 64), dimension_scores = '[]'::jsonb,
              completed_at = now(), reviewed_at = '2000-01-01T00:00:00Z'
        where id = $1`,
      [doomed.assessmentId],
    );
    await approveAssessment(db, owner, doomed.assessmentId, reviewer.userId, {
      certificationEligible: false,
    });
    // Backdated behind it, so it is the row that would be starved.
    await db.query(
      `update public.assessments set reviewed_at = '2000-01-01T00:00:00Z' where id = $1`,
      [doomed.assessmentId],
    );

    const said: { message: string; detail?: Record<string, unknown> }[] = [];
    const log = (message: string, detail?: Record<string, unknown>) =>
      said.push(detail === undefined ? { message } : { message, detail });

    for (let attempt = 1; attempt <= REPORT_RENDER_ATTEMPTS; attempt += 1) {
      await sweepPendingReports(pool, storage, log);
    }
    const failures = said.filter((line) => line.message === 'report generation failed');
    expect(failures.length).toBe(REPORT_RENDER_ATTEMPTS);
    expect(said.some((line) => line.message.startsWith('report generation given up on'))).toBe(
      true,
    );

    // And from now on it is not tried, and the sweep says why rather than
    // going quiet about it.
    said.length = 0;
    await sweepPendingReports(pool, storage, log);
    expect(said.some((line) => line.message === 'report generation failed')).toBe(false);
    const blocked = said.find((line) => line.message.startsWith('assessments the sweep can no'));
    expect(blocked?.detail?.blocked).toBe(1);

    resetReportFailureCounts();
  }, 120_000);
});

describe('upgrading after reading the free report', () => {
  it('gives the full report without re-running the assessment', async () => {
    const before = await db.query(
      `select count(*)::int as findings,
              (select overall_score from public.assessments where id = $1) as score
         from public.findings where assessment_id = $1`,
      [assessmentId],
    );

    await db.query(
      `insert into public.invoices
         (organisation_id, provider_invoice_id, amount_due_cents, amount_paid_cents, currency, status, app_id, plan, issued_at, paid_at)
       values ($1, 'in_upgrade', 7900, 7900, 'USD', 'paid', $2, 'one_off', now(), now())`,
      [owner.organisationId, appId],
    );

    const client = await pool.connect();
    try {
      await regenerateForPlanChange(client, storage, assessmentId);
    } finally {
      client.release();
    }

    const { rows } = await db.query(
      `select format, storage_path from public.reports where assessment_id = $1 order by format`,
      [assessmentId],
    );
    expect(rows.map((row) => row.format)).toEqual(['html', 'pdf']);

    const html = readFileSync(
      join(storageRoot, rows.find((row) => row.format === 'html')!.storage_path),
      'utf8',
    );
    expect(html).toContain('Roll it in the dashboard');
    expect(html).not.toMatch(/further finding/i);

    const pdf = readFileSync(
      join(storageRoot, rows.find((row) => row.format === 'pdf')!.storage_path),
    );
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

    const after = await db.query(
      `select count(*)::int as findings,
              (select overall_score from public.assessments where id = $1) as score
         from public.findings where assessment_id = $1`,
      [assessmentId],
    );
    expect(after.rows[0].findings, 'upgrading must not change the findings').toBe(
      before.rows[0].findings,
    );
    expect(after.rows[0].score, 'upgrading must not change the score').toBe(before.rows[0].score);
  }, 120_000);
});
