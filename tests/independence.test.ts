/**
 * Rating integrity.
 *
 * "Payment buys depth, re-testing, monitoring and support. Payment never buys a
 * score." This file is what makes that sentence a fact rather than a promise.
 *
 * Three independent guards are asserted here:
 *   1. Two customers — one maximally paying, one free — with identical apps and
 *      identical evidence receive identical scores.
 *   2. The scoring module contains no reference to any commercial concept.
 *   3. The scoring function takes exactly one argument, so there is no context
 *      parameter through which commercial data could be smuggled in later.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  scoreAssessment,
  type ScoringFinding,
  type ScoringInput,
} from '../packages/rubric/src/index.ts';
import { connect } from './setup/client.ts';
import {
  makeReviewer,
  seedAccount,
  seedAssessment,
  seedFinding,
  type SeededAccount,
} from './setup/seed.ts';

let db: Client;
let payingCustomer: SeededAccount;
let freeCustomer: SeededAccount;
let reviewer: SeededAccount;

const IDENTICAL_FINDINGS = [
  { dimension: 'security_posture', severity: 'high', confidence: 'high', ruleId: 'SEC-02' },
  { dimension: 'practicality_ux', severity: 'medium', confidence: 'medium', ruleId: 'UX-03' },
  { dimension: 'functional_integrity', severity: 'low', confidence: 'high', ruleId: 'FI-05' },
] as const;

beforeAll(async () => {
  db = await connect();
  reviewer = await seedAccount(db, 'independence-reviewer');
  await makeReviewer(db, reviewer.userId);

  payingCustomer = await seedAccount(db, 'maximally-paying');
  freeCustomer = await seedAccount(db, 'free-tier');

  // Make one customer as commercially attractive as this schema permits:
  // the most expensive plan, an active marketing-services relationship, and a
  // history of paid invoices.
  await db.query(
    `update public.organisations
        set account_type = 'agency', is_marketing_client = true, marketing_client_since = now()
      where id = $1`,
    [payingCustomer.organisationId],
  );
  await db.query(
    `insert into public.subscriptions (organisation_id, plan, status, seats, current_period_start, current_period_end)
     values ($1, 'organisation', 'active', 50, now(), now() + interval '30 days')`,
    [payingCustomer.organisationId],
  );
  await db.query(
    `insert into public.invoices (organisation_id, amount_due_cents, amount_paid_cents, status, issued_at, paid_at)
     values ($1, 499900, 499900, 'paid', now(), now())`,
    [payingCustomer.organisationId],
  );

  await db.query(
    `insert into public.subscriptions (organisation_id, plan, status)
     values ($1, 'free', 'active')`,
    [freeCustomer.organisationId],
  );
});

afterAll(async () => {
  await db?.end();
});

/** Reads findings back out of the database into the scorer's input shape. */
async function scoringInputFor(assessmentId: string): Promise<ScoringInput> {
  const { rows } = await db.query<ScoringFinding & { rubric_rule_id: string }>(
    `select dimension, severity, confidence, rubric_rule_id, is_published as "isPublished"
       from public.findings where assessment_id = $1 order by rubric_rule_id`,
    [assessmentId],
  );
  return {
    rubricVersion: '1.0.0',
    coreFlowsUnreachable: false,
    findings: rows.map((row) => ({
      ruleId: row.rubric_rule_id,
      dimension: row.dimension,
      severity: row.severity,
      confidence: row.confidence,
      isPublished: row.isPublished,
    })),
  };
}

describe('identical apps, opposite wallets', () => {
  it('produces identical scores for a maximally-paying and a free customer', async () => {
    const paid = await seedAssessment(db, payingCustomer, { depth: 'continuous' });
    const free = await seedAssessment(db, freeCustomer, { depth: 'limited' });

    for (const finding of IDENTICAL_FINDINGS) {
      await seedFinding(db, payingCustomer, paid.assessmentId, finding);
      await seedFinding(db, freeCustomer, free.assessmentId, finding);
    }

    const paidResult = scoreAssessment(await scoringInputFor(paid.assessmentId));
    const freeResult = scoreAssessment(await scoringInputFor(free.assessmentId));

    expect(freeResult).toEqual(paidResult);
    expect(freeResult.overallScore).toBe(paidResult.overallScore);
    expect(freeResult.certificationEligible).toBe(paidResult.certificationEligible);
    expect(JSON.stringify(freeResult)).toBe(JSON.stringify(paidResult));
  });

  it('is unaffected by the depth of coverage recorded on the assessment', async () => {
    const shallow = await seedAssessment(db, freeCustomer, { depth: 'limited' });
    const deep = await seedAssessment(db, payingCustomer, { depth: 'continuous' });
    for (const finding of IDENTICAL_FINDINGS) {
      await seedFinding(db, freeCustomer, shallow.assessmentId, finding);
      await seedFinding(db, payingCustomer, deep.assessmentId, finding);
    }
    expect(scoreAssessment(await scoringInputFor(shallow.assessmentId))).toEqual(
      scoreAssessment(await scoringInputFor(deep.assessmentId)),
    );
  });
});

describe('the scoring module cannot see money', () => {
  const scoringDir = join(process.cwd(), 'packages/rubric/src');
  const forbidden = [
    'subscription',
    'invoice',
    'stripe',
    'plan',
    'price',
    'marketing',
    'billing',
    'seats',
    'paid',
  ];

  // types.ts is exempt because it is the file that *names* the forbidden
  // concepts in order to ban them — its own guard is the compile-time
  // FreeOfCommercialInfluence assertion, which fails the build rather than a test.
  const scoringFiles = readdirSync(scoringDir).filter(
    (file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && file !== 'types.ts',
  );

  it.each(scoringFiles)('%s contains no commercial concept', (file) => {
    const source = readFileSync(join(scoringDir, file), 'utf8');
    // Strip comments: the guarantee is about what the code does, and the
    // comments necessarily discuss what it must not do.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '')
      .toLowerCase();
    for (const term of forbidden) {
      expect(code, `${file} must not reference "${term}"`).not.toMatch(new RegExp(`\\b${term}\\b`));
    }
  });

  it('takes exactly one argument, so no context parameter can be added quietly', () => {
    expect(scoreAssessment.length).toBe(1);
  });

  it('does not depend on the billing package, at any depth', () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), 'packages/rubric/package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    expect(declared).not.toContain('@vibefycode/billing');
    expect(declared).not.toContain('@vibefycode/report');
    expect(declared).not.toContain('stripe');

    for (const file of readdirSync(scoringDir).filter((name) => name.endsWith('.ts'))) {
      const source = readFileSync(join(scoringDir, file), 'utf8');
      expect(source, `${file} must not import billing`).not.toMatch(
        /from ['"]@vibefycode\/(billing|report|monitoring)/,
      );
      expect(source, `${file} must not read the price list`).not.toMatch(/config\/pricing/);
    }
  });
});

describe('what suspends a badge cannot see money either', () => {
  // Monitoring is the second place where a commercial fact could quietly change
  // a verdict — "their subscription lapsed, call it a regression" — and the
  // consequence there is worse, because it takes a live badge down. The same
  // guard applies, with one deliberate exception: schedule.ts decides *cadence*,
  // which is coverage, and is allowed to know what someone bought.
  const monitoringDir = join(process.cwd(), 'packages/monitoring/src');
  const forbidden = ['subscription', 'invoice', 'stripe', 'price', 'marketing', 'billing', 'seats'];
  const verdictFiles = ['drift.ts', 'regression.ts', 'liveness.ts'];

  it.each(verdictFiles)('%s contains no commercial concept', (file) => {
    const source = readFileSync(join(monitoringDir, file), 'utf8');
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '')
      .toLowerCase();
    for (const term of forbidden) {
      expect(code, `${file} must not reference "${term}"`).not.toMatch(new RegExp(`\\b${term}\\b`));
    }
    expect(source, `${file} must not import billing`).not.toMatch(
      /from ['"]@vibefycode\/(billing)/,
    );
  });

  it('does not let the schedule reach the verdict', () => {
    for (const file of verdictFiles) {
      const source = readFileSync(join(monitoringDir, file), 'utf8');
      expect(source, `${file} must not import the cadence table`).not.toMatch(
        /from ['"]\.\/schedule\.ts/,
      );
    }
  });

  it('keeps monitoring out of the scoring package entirely', () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), 'packages/rubric/package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })).not.toContain(
      '@vibefycode/monitoring',
    );
  });
});

describe('what a report shows never changes what it scored', () => {
  it('renders the same score at both tiers', async () => {
    const { renderReport } = await import('../packages/report/src/index.ts');
    const { entitlementFor } = await import('../packages/billing/src/index.ts');

    const source = {
      assessmentId: 'a',
      appName: 'Kettle',
      appUrl: 'https://kettle.example',
      organisationName: 'Kettle Ltd',
      rubricVersion: '1.0.0',
      assessedOn: '2026-08-22',
      reviewedOn: null,
      overallScore: 63.5,
      band: 'Adequate',
      certificationEligible: false,
      certificationBlockers: [],
      dimensions: [],
      findings: [],
      narrative: null,
      stages: [],
      scopeStatement: 'x'.repeat(120),
      promptBundleSha256: 'c'.repeat(64),
      intendedForAppStore: false,
      isGame: false,
    } as const;

    const free = renderReport(source, entitlementFor('free').reportTier);
    const paid = renderReport(source, entitlementFor('one_off').reportTier);
    const fingerprint = (html: string) =>
      /vibefycode-score-fingerprint" content="([^"]+)"/.exec(html)?.[1];
    expect(fingerprint(free.html)).toBe(fingerprint(paid.html));
  });
});
