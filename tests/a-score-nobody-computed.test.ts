/**
 * A report is a statement about a number. There had to be one, and there
 * didn't have to be.
 *
 * `assembleReportSource` read `Number(row.overall_score ?? 0)` in four places,
 * and `overall_score` is nullable with nothing tying it to a status. So an
 * assessment with no score assembled into a report saying **0**, banded by the
 * published rubric as "Not ready — findings that block usable release within
 * the assessed scope". That is the harshest sentence this product can print
 * about somebody's application, and it would have been arrived at by the
 * absence of a measurement rather than by one: an empty dimensions table
 * underneath it, and a peer comparison placing them at zero.
 *
 * Not reachable today. The engine writes the score in the same statement as
 * the status, `sweepPendingReports` only takes `approved` and `published`, and
 * since `20261008010000` nothing a request can reach may write the column.
 * This holds anyway, for the reason decision 871 gives about `scoreExit`: a
 * function that cannot tell "zero" from "not measured" is wrong in itself, and
 * the next caller will not be the careful one.
 *
 * The scope statement is the same shape found in the same place.
 * `generateReport` refuses one under a hundred characters — "a report without
 * one states no limits, and we do not publish those" — and that is the
 * function which *stores* a report. The console page calls `renderReport`
 * directly on this source and gates only on status, so the one caller that
 * shows a customer their report live would have rendered the scope paragraph
 * empty. The rule moves to where both callers meet.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { assembleReportSource, missingClaimColumns } from '../packages/report/src/assemble.ts';
import { connect } from './setup/client.ts';
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

const SCOPE = 'What was assessed, and what was not. '.repeat(4);

beforeAll(async () => {
  db = await connect();
  owner = await seedAccount(db, 'no-score');
  reviewer = await seedAccount(db, 'no-score-reviewer');
  await makeReviewer(db, reviewer.userId);
});

afterAll(async () => {
  await db?.end();
});

/**
 * An assessment at `awaiting_review`, with whatever the caller leaves out.
 *
 * Not `approved`: `assert_human_review` refuses that transition without a
 * recorded review, which is a different rule with its own test. It makes no
 * difference to what is being measured — `assembleReportSource` reads no
 * status at all, which is itself part of why the `?? 0` mattered.
 */
async function approvedAssessment(fields: {
  score: number | null;
  scope: string | null;
}): Promise<string> {
  const { assessmentId } = await seedAssessment(db, owner);
  await seedFinding(db, owner, assessmentId);
  await db.query(
    `update public.assessments
        set overall_score = $2, scope_statement = $3, status = 'awaiting_review',
            completed_at = now(), rubric_version = '1.1.0'
      where id = $1`,
    [assessmentId, fields.score, fields.scope],
  );
  return assessmentId;
}

describe('what a report may be assembled from', () => {
  it('refuses an assessment with no score rather than printing nought', async () => {
    const assessmentId = await approvedAssessment({ score: null, scope: SCOPE });
    await expect(
      assembleReportSource(db, assessmentId),
      'a report was assembled for an assessment nobody scored',
    ).rejects.toThrow(/has no score/i);
  });

  it('refuses an assessment with no frozen scope statement', async () => {
    const assessmentId = await approvedAssessment({ score: 72, scope: null });
    await expect(
      assembleReportSource(db, assessmentId),
      'a report was assembled with no statement of what was not covered',
    ).rejects.toThrow(/no frozen scope statement/i);
  });

  it('refuses a scope statement too short to say anything', async () => {
    // The same rule `generateReport` has always had, now where both callers
    // meet. A hundred characters is not a measure of quality; it is the length
    // below which the sentence cannot be describing limits at all.
    const assessmentId = await approvedAssessment({ score: 72, scope: 'Everything. ' });
    await expect(assembleReportSource(db, assessmentId)).rejects.toThrow(
      /no frozen scope statement/i,
    );
  });

  it('assembles one that has both, which is what the engine writes', async () => {
    // The direction a guard fails in silence: refusing everything, and being
    // found the day no customer can open their report.
    const assessmentId = await approvedAssessment({ score: 72.5, scope: SCOPE });
    const source = await assembleReportSource(db, assessmentId);
    expect(source.overallScore).toBeCloseTo(72.5, 6);
    expect(source.band, 'the band came back unbanded for a real score').not.toBe('Unbanded');
    expect(source.scopeStatement.length).toBeGreaterThanOrEqual(100);
  });

  it('bands a real nought as "Not ready", so the refusal is about absence', async () => {
    /*
     * The distinction the `?? 0` destroyed, asserted from both sides. An
     * application that genuinely scored zero gets the band it earned; one that
     * was never scored gets no report at all. Without this case the refusal
     * above could be read as "zero is not allowed", which would be a different
     * and wrong rule.
     */
    const assessmentId = await approvedAssessment({ score: 0, scope: SCOPE });
    const source = await assembleReportSource(db, assessmentId);
    expect(source.overallScore).toBe(0);
    expect(source.band).toBe('Not ready');
  });
});

/**
 * The columns a default cannot speak for.
 *
 * The query is `select a.*`, so `not_tested`, `gate_failures` and the rest
 * arrive by being columns of `public.assessments` rather than by being asked
 * for — and each is read with a default. `?? []` cannot tell an empty value
 * from an absent column, which means a rename would have every report assert
 * that nothing went unanswered and that nothing blocked certification.
 *
 * This file's subject is the same mistake one field over: a function that
 * cannot tell nought from not measured. These are checked by key rather than
 * by value, because `'not_tested' in row` is the only thing that can tell the
 * two apart.
 */
describe('a row that came back without a column', () => {
  it('names the missing column and what its absence would have asserted', () => {
    const row = {
      id: 'assessment-1',
      overall_score: 71,
      scope_statement: 'x'.repeat(120),
      gate_failures: [],
      certification_eligible: true,
      dimension_scores: [],
      prompt_bundle_sha256: 'abc',
    };
    expect(missingClaimColumns(row)).toEqual(['not_tested']);
  });

  it('says nothing is missing when every column is there, including an empty one', () => {
    // The half that makes the other half mean something: an empty array is a
    // real answer and must not be refused.
    const row = {
      not_tested: [],
      gate_failures: [],
      certification_eligible: false,
      dimension_scores: [],
      scope_statement: '',
      prompt_bundle_sha256: '',
    };
    expect(missingClaimColumns(row)).toEqual([]);
  });

  it('refuses to assemble rather than reporting the default', async () => {
    /*
     * Through the real function, with a fake executor, because the refusal has
     * to be in the path both callers take — the sweep that stores a report and
     * the console page that renders one live. The row carries everything but
     * `not_tested`.
     */
    const row = {
      id: 'assessment-1',
      app_name: 'An App',
      primary_url: 'https://customer.example',
      intended_for_app_store: false,
      category: null,
      policy_profile_id: null,
      organisation_name: 'A Workspace',
      rubric_version: '1.1.0',
      overall_score: 71,
      dimension_scores: [],
      certification_eligible: true,
      gate_failures: [],
      scope_statement: 'x'.repeat(120),
      prompt_bundle_sha256: 'abc',
      report_narrative: null,
      completed_at: '2026-10-01T00:00:00.000Z',
      created_at: '2026-10-01T00:00:00.000Z',
      reviewed_at: null,
    };
    const executor = { query: async () => ({ rows: [row] }) };
    await expect(assembleReportSource(executor as never, 'assessment-1')).rejects.toThrow(
      /without the column "not_tested"/,
    );
    await expect(assembleReportSource(executor as never, 'assessment-1')).rejects.toThrow(
      /nothing went unanswered/,
    );
  });
});
