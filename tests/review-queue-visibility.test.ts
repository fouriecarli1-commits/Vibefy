/**
 * Whether a reviewer can see the queue at all.
 *
 * `/review` reads through row-level security as the signed-in reviewer, and it
 * reads five things: the assessments awaiting review, the application each one
 * belongs to, every finding in the queue, the evidence joined to those
 * findings, and the stages that did not succeed.
 *
 * If a reviewer cannot read any one of those, the page does not break. It
 * renders. An assessment with no application name, or worse, an assessment with
 * an empty finding list — and an empty finding list is what an assessment with
 * nothing wrong with it looks like. The reviewer whose approval is the hard
 * gate on every badge would be looking at a clean-looking row.
 *
 * So this asks each read as a reviewer rather than reading the policies. The
 * policies all say `or public.is_reviewer()` today; the point is that the page
 * keeps working when somebody changes one, and that a failure shows up here
 * rather than as a quiet approval.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { actingAs, connect } from './setup/client.ts';
import {
  makeReviewer,
  seedAccount,
  seedAssessment,
  seedFinding,
  type SeededAccount,
} from './setup/seed.ts';

let db: Client;
let reviewer: SeededAccount;
let stranger: SeededAccount;
let owner: SeededAccount;
let assessmentId: string;

beforeAll(async () => {
  db = await connect();
  owner = await seedAccount(db, 'queue-owner');
  reviewer = await seedAccount(db, 'queue-reviewer');
  stranger = await seedAccount(db, 'queue-stranger');
  await makeReviewer(db, reviewer.userId);

  const seeded = await seedAssessment(db, owner);
  assessmentId = seeded.assessmentId;
  await db.query(
    `update public.assessments set status = 'awaiting_review', overall_score = 71.5 where id = $1`,
    [assessmentId],
  );
  await seedFinding(db, owner, assessmentId, { severity: 'critical', ruleId: 'SEC-04' });
  await seedFinding(db, owner, assessmentId, { severity: 'medium', ruleId: 'SEC-02' });
  await db.query(
    `insert into public.assessment_runs (assessment_id, organisation_id, stage, status)
     values ($1, $2, 'store_readiness', 'cancelled')`,
    [assessmentId, owner.organisationId],
  );
});

afterAll(async () => {
  await db?.end();
});

const asReviewer = <T>(work: (client: Client) => Promise<T>) =>
  actingAs(db, { userId: reviewer.userId, aal: 'aal2' }, work);

describe('what the queue page reads', () => {
  it('finds the assessment awaiting review', async () => {
    const rows = await asReviewer(async (client) => {
      const { rows } = await client.query(
        `select id from public.assessments where status = 'awaiting_review' and id = $1`,
        [assessmentId],
      );
      return rows.length;
    });
    expect(rows).toBe(1);
  });

  it('finds the application it belongs to, so the row says what it is', async () => {
    const name = await asReviewer(async (client) => {
      const { rows } = await client.query<{ name: string }>(
        `select app.name from public.apps app
           join public.assessments a on a.app_id = app.id
          where a.id = $1`,
        [assessmentId],
      );
      return rows[0]?.name ?? null;
    });
    expect(name).not.toBeNull();
  });

  it('finds every finding, because an empty list reads as a clean application', async () => {
    /*
     * The one that matters. A reviewer who cannot read findings is shown an
     * assessment with nothing against it, which is indistinguishable from an
     * assessment with nothing wrong with it — and their approval is the hard
     * gate on the badge.
     */
    const severities = await asReviewer(async (client) => {
      const { rows } = await client.query<{ severity: string }>(
        `select severity::text from public.findings where assessment_id = $1 order by severity`,
        [assessmentId],
      );
      return rows.map((row) => row.severity);
    });
    expect(severities).toHaveLength(2);
    expect(severities).toContain('critical');
  });

  it('finds the evidence joined to those findings', async () => {
    const count = await asReviewer(async (client) => {
      const { rows } = await client.query(
        `select fe.evidence_id from public.finding_evidence fe
           join public.findings f on f.id = fe.finding_id
          where f.assessment_id = $1`,
        [assessmentId],
      );
      return rows.length;
    });
    expect(count).toBeGreaterThan(0);
  });

  it('finds the artefacts themselves, which is what approving on evidence means', async () => {
    const count = await asReviewer(async (client) => {
      const { rows } = await client.query(
        `select id from public.evidence where assessment_id = $1`,
        [assessmentId],
      );
      return rows.length;
    });
    expect(count).toBeGreaterThan(0);
  });

  it('finds the stages that did not succeed, which is what "not assessed" is built from', async () => {
    const stages = await asReviewer(async (client) => {
      const { rows } = await client.query<{ stage: string }>(
        `select stage from public.assessment_runs
          where assessment_id = $1 and status <> 'succeeded'`,
        [assessmentId],
      );
      return rows.map((row) => row.stage);
    });
    expect(stages).toContain('store_readiness');
  });
});

describe('and it is still not a public queue', () => {
  it.each([
    ['assessments', `select id from public.assessments where id = $1`],
    ['findings', `select id from public.findings where assessment_id = $1`],
    ['evidence', `select id from public.evidence where assessment_id = $1`],
    ['assessment_runs', `select stage from public.assessment_runs where assessment_id = $1`],
  ])('shows another customer nothing of %s', async (_table, sql) => {
    // The other half of every policy above. `or public.is_reviewer()` widens
    // access deliberately and to staff only; a signed-in stranger sees none of
    // it, and this is the assertion that keeps the widening honest.
    const visible = await actingAs(db, { userId: stranger.userId, aal: 'aal2' }, async (client) => {
      const { rows } = await client.query(sql, [assessmentId]);
      return rows.length;
    });
    expect(visible).toBe(0);
  });
});
