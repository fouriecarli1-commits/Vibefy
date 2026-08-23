/**
 * The portfolio row, and the two policy rules it could not answer.
 *
 * A dashboard that evaluates a policy against facts it does not have is worse
 * than one that says nothing: it reports a pass on an application with three
 * open criticals, and it fails a store-bound application with a reason that
 * states the opposite of the truth. Both were true of this page until the view
 * started carrying the findings and the store intent.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  evaluatePolicy,
  type PolicyProfile,
  type PolicySubject,
} from '../packages/policy/src/index.ts';
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
let owner: SeededAccount;
let reviewer: SeededAccount;

interface PortfolioRow {
  app_id: string;
  intended_for_app_store: boolean;
  open_findings: PolicySubject['openFindings'];
  overall_score: string | null;
  certification_eligible: boolean | null;
  dimension_scores: { dimension: string; score: number }[] | null;
  assessment_id: string | null;
}

async function portfolioFor(appId: string): Promise<PortfolioRow> {
  const { rows } = await db.query<PortfolioRow>(
    'select * from public.portfolio where app_id = $1',
    [appId],
  );
  return rows[0]!;
}

/** Exactly what the page does with the row, so the test and the page cannot drift. */
function subjectFrom(row: PortfolioRow): PolicySubject {
  return {
    assessmentId: row.assessment_id!,
    overallScore: Number(row.overall_score),
    certificationEligible: row.certification_eligible === true,
    dimensions: (row.dimension_scores ?? []).map((entry) => ({
      dimension: entry.dimension as PolicySubject['dimensions'][number]['dimension'],
      score: Number(entry.score),
    })),
    openFindings: row.open_findings ?? [],
    intendedForAppStore: row.intended_for_app_store === true,
  };
}

const NO_CRITICALS: PolicyProfile = {
  id: 'p1',
  name: 'No open criticals',
  description: null,
  minOverallScore: null,
  dimensionFloors: {},
  maxOpenSeverity: 'medium',
  requireCertification: false,
  requireStoreReadiness: false,
};

const STORE_BOUND: PolicyProfile = {
  ...NO_CRITICALS,
  id: 'p2',
  name: 'Ready for a store',
  maxOpenSeverity: null,
  requireStoreReadiness: true,
};

beforeAll(async () => {
  db = await connect();
  owner = await seedAccount(db, 'portfolio-owner');
  reviewer = await seedAccount(db, 'portfolio-reviewer');
  await makeReviewer(db, reviewer.userId);
});

afterAll(async () => {
  await db?.end();
});

describe('the row carries what the policy engine reads', () => {
  it('lists the published findings of the latest reviewed assessment', async () => {
    const seeded = await seedAssessment(db, owner);
    await seedFinding(db, owner, seeded.assessmentId, {
      severity: 'critical',
      ruleId: 'SEC-08',
      title: 'Environment file is publicly readable',
    });
    await seedFinding(db, owner, seeded.assessmentId, { severity: 'low', ruleId: 'PRD-04' });
    await approveAssessment(db, owner, seeded.assessmentId, reviewer.userId, {
      certificationEligible: false,
      score: 72,
    });

    const row = await portfolioFor(seeded.appId);
    expect(row.open_findings.map((finding) => finding.ruleId).sort()).toEqual(['PRD-04', 'SEC-08']);
    expect(row.open_findings.every((finding) => finding.title.length > 0)).toBe(true);
  });

  it('breaches a severity ceiling that used to be unbreachable', async () => {
    const seeded = await seedAssessment(db, owner);
    await seedFinding(db, owner, seeded.assessmentId, {
      severity: 'critical',
      title: 'Environment file is publicly readable',
    });
    await approveAssessment(db, owner, seeded.assessmentId, reviewer.userId, {
      certificationEligible: false,
      score: 90,
    });

    const evaluation = evaluatePolicy(NO_CRITICALS, subjectFrom(await portfolioFor(seeded.appId)));
    expect(evaluation.meetsPolicy).toBe(false);
    expect(evaluation.failures.map((failure) => failure.rule)).toContain('max_open_severity');
  });

  it('omits a finding the reviewer unpublished', async () => {
    // Unpublishing is how a reviewer removes a finding they could not stand
    // behind. A policy evaluated on it would be measuring something we withdrew.
    const seeded = await seedAssessment(db, owner);
    const findingId = await seedFinding(db, owner, seeded.assessmentId, { severity: 'critical' });
    await approveAssessment(db, owner, seeded.assessmentId, reviewer.userId, {
      certificationEligible: false,
      score: 90,
    });
    await db.query(
      `update public.findings
          set is_published = false,
              withheld_reason = 'The evidence did not support this finding at review.'
        where id = $1`,
      [findingId],
    );

    const row = await portfolioFor(seeded.appId);
    expect(row.open_findings).toEqual([]);
    expect(evaluatePolicy(NO_CRITICALS, subjectFrom(row)).meetsPolicy).toBe(true);
  });

  it('reports store readiness against the application’s actual intent', async () => {
    const seeded = await seedAssessment(db, owner);
    await approveAssessment(db, owner, seeded.assessmentId, reviewer.userId, { score: 90 });
    await db.query('update public.apps set intended_for_app_store = true where id = $1', [
      seeded.appId,
    ]);
    await db.query(
      `update public.assessments
          set dimension_scores = '[{"dimension":"store_distribution_readiness","score":80}]'::jsonb
        where id = $1`,
      [seeded.assessmentId],
    );

    const row = await portfolioFor(seeded.appId);
    expect(row.intended_for_app_store).toBe(true);

    const evaluation = evaluatePolicy(STORE_BOUND, subjectFrom(row));
    // Previously this failed with "this application was not submitted as one
    // intended for an app store", which was false, on every application.
    expect(evaluation.failures.map((failure) => failure.rule)).not.toContain(
      'require_store_readiness',
    );
  });

  it('carries an empty list for an application nothing has been approved on', async () => {
    const seeded = await seedAssessment(db, owner);
    await seedFinding(db, owner, seeded.assessmentId, { severity: 'critical' });
    const row = await portfolioFor(seeded.appId);
    // The assessment is not reviewed, so it is not the latest *reviewed* one,
    // and a customer must not see a policy verdict built on unreviewed findings.
    expect(row.assessment_id).toBeNull();
    expect(row.open_findings).toEqual([]);
  });
});

describe('the page reads the row rather than querying again', () => {
  const page = readFileSync(join(process.cwd(), 'apps/web/app/console/portfolio/page.tsx'), 'utf8');

  it('takes both facts from the portfolio row', () => {
    expect(page).toContain('row.open_findings');
    expect(page).toContain('row.intended_for_app_store');
    // The hard-coded values that made two rules answer wrongly.
    expect(page).not.toContain('openFindings: []');
    expect(page).not.toContain('intendedForAppStore: false');
  });

  it('issues one query for the whole portfolio, not one per application', () => {
    // A dashboard that gets slower as a customer succeeds is a dashboard that
    // punishes the customers we most want.
    expect(page.match(/\.from\('portfolio'\)/g)).toHaveLength(1);
  });
});
