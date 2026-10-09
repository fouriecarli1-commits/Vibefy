/**
 * An approved assessment with no report, and nothing saying why.
 *
 * `sweepPendingReports` tries each pending assessment three times and then
 * stops, and its own log line says what that costs: "each needs a person; a
 * restart makes the sweep try them again". Nothing told a person.
 *
 * Measured on 2026-10-09 with a store that cannot write:
 *
 *   · three attempts, each logged, then "given up on until this process
 *     restarts";
 *   · `public.reports` holds no row, so the customer has no report;
 *   · `assessments.status` is `approved`, which to anyone reading the database
 *     is indistinguishable from one whose report renders on the next sweep;
 *   · `audit_log` holds nothing;
 *   · the abandonment itself lives in a module-level `Map`, which a deploy
 *     forgets.
 *
 * The in-memory cap is deliberate and stays: a restart usually follows the
 * deploy that fixed the bug, and the sweep should try again. What is added is a
 * record that outlives the process, and a second record when a later pass
 * succeeds — because an append-only log cannot mark the first one resolved, and
 * a list of customers still waiting has to be answerable.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { LocalReportStorage } from '../apps/worker/src/report.ts';
import {
  REPORT_RENDER_ATTEMPTS,
  resetReportFailureCounts,
  sweepPendingReports,
} from '../apps/worker/src/report.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from './setup/client.ts';
import { makeReviewer, seedAccount, seedAssessment, type SeededAccount } from './setup/seed.ts';

let db: Client;
let pool: Pool;
let owner: SeededAccount;
let reviewer: SeededAccount;

beforeAll(async () => {
  db = await connect();
  const dsn = new URL(process.env.VIBEFYCODE_TEST_DSN!);
  pool = new Pool({
    host: dsn.searchParams.get('host')!,
    database: dsn.pathname.slice(1),
    user: 'postgres',
  });
  owner = await seedAccount(db, 'no-report');
  reviewer = await seedAccount(db, 'no-report-rev');
  await makeReviewer(db, reviewer.userId);
});

afterAll(async () => {
  await pool?.end();
  await db?.end();
});

/**
 * An approved assessment waiting for its report.
 *
 * The scope statement and the recorded review are both required by the
 * database, and both took a measurement with me: without the scope statement
 * the sweep's pending query skips the row entirely, and the first version of
 * this reported "nothing happened" when what had happened was nothing at all.
 */
async function approvedAssessment(): Promise<string> {
  const { assessmentId } = await seedAssessment(db, owner, { depth: 'full' });
  await db.query(`update public.assessments set scope_statement = $2 where id = $1`, [
    assessmentId,
    'This assessment covered the hosted application at the authorised origin, signed out, between ' +
      'the dates recorded above. It is not an audit, not a guarantee, and not legal advice.',
  ]);
  await db.query(`update public.assessments set status = 'awaiting_review' where id = $1`, [
    assessmentId,
  ]);
  await db.query(
    `insert into public.reviews (assessment_id, organisation_id, reviewer_id, action, reason)
     values ($1, $2, $3, 'approved', 'Findings and evidence checked against the rubric.')`,
    [assessmentId, owner.organisationId, reviewer.userId],
  );
  await db.query(
    `update public.assessments
        set status = 'approved', overall_score = 71.0, reviewed_at = now() where id = $1`,
    [assessmentId],
  );
  return assessmentId;
}

/** A store that cannot write, however often it is asked. */
const readOnlyStore = {
  async put() {
    throw new Error('the bucket is read-only');
  },
  async get() {
    return null;
  },
  async remove() {},
};

const auditFor = async (assessmentId: string, action: string) =>
  (
    await db.query<{ summary: string }>(
      `select summary from public.audit_log where entity_id = $1 and action = $2`,
      [assessmentId, action],
    )
  ).rows;

describe('a report the sweep gave up on', () => {
  let assessmentId: string;

  beforeAll(async () => {
    resetReportFailureCounts();
    assessmentId = await approvedAssessment();
    for (let pass = 0; pass < REPORT_RENDER_ATTEMPTS + 1; pass += 1) {
      await sweepPendingReports(pool, readOnlyStore as never, () => undefined);
    }
  }, 180_000);

  it('leaves the customer with an approved assessment and no report', async () => {
    // The premise, and the reason the record below is needed: the database
    // alone cannot tell this apart from a report about to be rendered.
    const reports = await db.query(`select id from public.reports where assessment_id = $1`, [
      assessmentId,
    ]);
    expect(reports.rowCount).toBe(0);
    const status = await db.query<{ status: string }>(
      `select status::text as status from public.assessments where id = $1`,
      [assessmentId],
    );
    expect(status.rows[0]!.status).toBe('approved');
  });

  it('writes down that it gave up, with the error that stopped it', async () => {
    const recorded = await auditFor(assessmentId, 'report.render_abandoned');
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.summary).toMatch(/approved assessment and no report/i);
    expect(recorded[0]!.summary).toMatch(/the bucket is read-only/);
    expect(recorded[0]!.summary).toContain(String(REPORT_RENDER_ATTEMPTS));
  });

  it('writes it once, however many times the worker restarts', async () => {
    // A restart clears the in-memory cap and brings the sweep back to this
    // branch, which is the behaviour that makes a restart worth trying. Three
    // identical rows a day is not a clearer account than one.
    resetReportFailureCounts();
    for (let pass = 0; pass < REPORT_RENDER_ATTEMPTS + 1; pass += 1) {
      await sweepPendingReports(pool, readOnlyStore as never, () => undefined);
    }
    expect(await auditFor(assessmentId, 'report.render_abandoned')).toHaveLength(1);
  }, 180_000);

  it('records the recovery when a later pass produces it', async () => {
    // The append-only log cannot mark the abandonment resolved, so a second row
    // is what takes this customer off the list of people still waiting.
    resetReportFailureCounts();
    const storage = new LocalReportStorage(mkdtempSync(join(tmpdir(), 'vibefy-reports-')));
    await sweepPendingReports(pool, storage, () => undefined);

    const reports = await db.query(`select id from public.reports where assessment_id = $1`, [
      assessmentId,
    ]);
    expect(reports.rowCount).toBeGreaterThan(0);

    const cleared = await auditFor(assessmentId, 'report.render_recovered');
    expect(cleared).toHaveLength(1);
    expect(cleared[0]!.summary).toMatch(/waiting for it from the moment/i);
  }, 180_000);
});

describe('what it leaves alone', () => {
  it('records nothing for a report that rendered first time', async () => {
    resetReportFailureCounts();
    const assessmentId = await approvedAssessment();
    const storage = new LocalReportStorage(mkdtempSync(join(tmpdir(), 'vibefy-reports-')));
    await sweepPendingReports(pool, storage, () => undefined);

    expect(await auditFor(assessmentId, 'report.render_abandoned')).toHaveLength(0);
    // And no recovery row either: there was nothing to recover from, and a row
    // saying a customer was kept waiting when they were not is its own untruth.
    expect(await auditFor(assessmentId, 'report.render_recovered')).toHaveLength(0);
  }, 180_000);
});
