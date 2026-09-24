/**
 * "One bad assessment must not stop the others" — including a bad plan lookup.
 *
 * `sweepPendingReports` has a per-assessment attempts cap for exactly this. Its
 * own comment explains the failure it exists to prevent: an assessment that can
 * never render sits at the front of a twenty-row window ordered oldest-review-
 * first, takes a slot every sweep for ever, and twenty of those means nobody's
 * report is generated again. The `try` around `generateReport` carries the
 * comment "One bad assessment must not stop the others".
 *
 * `resolvePlan` was called on the line above that `try`.
 *
 * So anything the plan lookup threw — a statement timeout, a lost connection, a
 * subscription row the entitlement code does not recognise — propagated out of
 * the loop, out of `sweepPendingReports` past its `finally`, and took every
 * assessment behind it with it. Not once: every sweep, for ever, because nothing
 * counted the failure and nothing logged it. The counter that exists to stop
 * precisely this could not see it, being one line further down.
 *
 * The mid-loop abort is what makes it quiet. Rows ahead of the bad one in the
 * window had already been generated, so a sweep that "did some work and then
 * threw" looks, in the log, almost exactly like a sweep that finished — and
 * `order by a.reviewed_at` guarantees the bad row keeps its place at the front.
 *
 * Found by reading for what the guard did not cover rather than for what it did.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client, PoolClient } from 'pg';
import {
  LocalReportStorage,
  resetReportFailureCounts,
  sweepPendingReports,
} from '../apps/worker/src/report.ts';
import { connect } from './setup/client.ts';
import {
  approveAssessment,
  makeReviewer,
  seedAccount,
  seedAssessment,
  type SeededAccount,
} from './setup/seed.ts';

const SCOPE_STATEMENT =
  'This assessment is a point-in-time, scope-limited, AI-assisted and human-reviewed evaluation conducted against a published rubric version on a stated date. It is not a guarantee of any kind. Absence of a finding is not evidence of absence of a defect.';

let db: Client;
let storageRoot: string;
let storage: LocalReportStorage;
let reviewer: SeededAccount;
let doomed: SeededAccount;
let healthy: SeededAccount;
let doomedAssessment: string;
let healthyAssessment: string;

/**
 * An approved assessment with a publishable scope statement and a `reviewed_at`
 * old enough to sit at the front of the sweep window.
 *
 * The age matters: the defect is only visible when the failing row is reached
 * *before* the row that must survive it. Reached second, the survivor's report
 * was already written and the test would pass against the broken code.
 */
async function pendingReport(account: SeededAccount, ageDays: number): Promise<string> {
  const seeded = await seedAssessment(db, account);
  await db.query(
    `update public.assessments
        set scope_statement = $2, completed_at = now(),
            dimension_scores = $3::jsonb
      where id = $1`,
    [
      seeded.assessmentId,
      SCOPE_STATEMENT,
      JSON.stringify([{ dimension: 'security_posture', score: 82.5, weight: 0.3, band: 'Good' }]),
    ],
  );
  await approveAssessment(db, account, seeded.assessmentId, reviewer.userId);
  await db.query(
    `update public.assessments set reviewed_at = now() - ($2 || ' days')::interval where id = $1`,
    [seeded.assessmentId, String(ageDays)],
  );
  return seeded.assessmentId;
}

beforeAll(async () => {
  db = await connect();
  storageRoot = mkdtempSync(join(tmpdir(), 'vibefycode-plan-sweep-'));
  storage = new LocalReportStorage(storageRoot);

  reviewer = await seedAccount(db, 'plan-sweep-reviewer');
  await makeReviewer(db, reviewer.userId);
  doomed = await seedAccount(db, 'plan-sweep-doomed');
  healthy = await seedAccount(db, 'plan-sweep-healthy');

  // Ninety and eighty-nine days: both far enough back to lead the window
  // whatever else the shared test database is holding, and in this order.
  doomedAssessment = await pendingReport(doomed, 90);
  healthyAssessment = await pendingReport(healthy, 89);
});

afterAll(async () => {
  resetReportFailureCounts();
  rmSync(storageRoot, { recursive: true, force: true });
  await db?.end();
});

/**
 * The real connection, with the plan lookup for one organisation broken.
 *
 * Broken rather than mocked: `resolvePlan` reads `public.subscriptions`, and the
 * point is that a failure inside it — from any cause, at any depth — must not be
 * able to reach past the assessment it belongs to.
 */
function poolWithABrokenPlanLookup(organisationId: string) {
  const client = {
    async query(...args: unknown[]) {
      const [text, params] = args as [unknown, unknown[] | undefined];
      const sql = typeof text === 'string' ? text : '';
      if (sql.includes('from public.subscriptions') && params?.[0] === organisationId) {
        throw new Error('canceling statement due to statement timeout');
      }
      return (db.query as (...a: unknown[]) => Promise<unknown>)(...args);
    },
    release() {},
  };
  return { connect: async () => client as unknown as PoolClient };
}

async function hasReport(assessmentId: string): Promise<boolean> {
  const { rows } = await db.query<{ n: string }>(
    `select count(*)::text as n from public.reports
      where assessment_id = $1 and format = 'html'`,
    [assessmentId],
  );
  return rows[0]?.n !== '0';
}

describe('a plan lookup that throws', () => {
  it('does not take the assessments behind it down with it', async () => {
    resetReportFailureCounts();
    const logged: { message: string; detail?: Record<string, unknown> }[] = [];

    const generated = await sweepPendingReports(
      poolWithABrokenPlanLookup(doomed.organisationId),
      storage,
      (message, detail) => logged.push({ message, ...(detail ? { detail } : {}) }),
    );

    expect(generated).toBeGreaterThanOrEqual(1);
    expect(await hasReport(healthyAssessment)).toBe(true);
    expect(await hasReport(doomedAssessment)).toBe(false);
  });

  it('is counted against the assessment it belongs to, so the cap can see it', async () => {
    resetReportFailureCounts();
    const logged: { message: string; detail?: Record<string, unknown> }[] = [];

    await sweepPendingReports(
      poolWithABrokenPlanLookup(doomed.organisationId),
      storage,
      (message, detail) => logged.push({ message, ...(detail ? { detail } : {}) }),
    );

    const failure = logged.find(
      (entry) =>
        entry.message === 'report generation failed' &&
        entry.detail?.['assessmentId'] === doomedAssessment,
    );
    expect(failure).toBeDefined();
    expect(String(failure?.detail?.['error'])).toMatch(/statement timeout/);
    expect(failure?.detail?.['attempt']).toBe(1);
  });
});
