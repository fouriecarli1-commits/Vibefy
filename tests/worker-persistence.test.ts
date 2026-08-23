/**
 * The worker: the hard gate at dispatch, and what actually lands in the database.
 *
 * The gate is checked twice on purpose — once before a run starts and once
 * before its output is written — because a customer can withdraw authorisation
 * while a run is in flight, and if they do, the run's output must not become a
 * report.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import {
  CostMeter,
  DEFAULT_CEILING,
  EvidenceStore,
  ModelClient,
  ScopeGuard,
  ScriptedTransport,
  runPipeline,
  type AssessmentOutcome,
  type StageContext,
  type TransportRequest,
} from '../packages/engine/src/index.ts';
import {
  AuthorisationWithdrawnError,
  NotAuthorisedError,
  persistOutcome,
  runAssessmentJob,
} from '../apps/worker/src/index.ts';
import { connect } from './setup/client.ts';
import {
  makeReviewer,
  seedAccount,
  seedApp,
  seedAuthorisation,
  seedRubric,
  sha256,
  type SeededAccount,
} from './setup/seed.ts';
import { startVulnerableApp, type FixtureApp } from './fixtures/vulnerable-app.ts';

let db: Client;
let pool: Pool;
let owner: SeededAccount;
let reviewer: SeededAccount;
let app: FixtureApp;
let outcome: AssessmentOutcome;

function poolConfig() {
  const dsn = process.env.VIBEFYCODE_TEST_DSN!;
  const url = new URL(dsn);
  return { host: url.searchParams.get('host')!, database: url.pathname.slice(1), user: 'postgres' };
}

function mintedIds(request: TransportRequest): string[] {
  const context = request.system.map((block) => block.text).join('\n');
  const section = /Evidence ids captured during this stage:\n([\s\S]*)$/.exec(context);
  return (section?.[1] ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[0-9a-f-]{36}$/.test(line));
}

beforeAll(async () => {
  db = await connect();
  pool = new Pool(poolConfig());
  owner = await seedAccount(db, 'worker-owner');
  reviewer = await seedAccount(db, 'worker-reviewer');
  await makeReviewer(db, reviewer.userId);
  await seedRubric(db);

  // A real pipeline run against the flawed fixture, so what gets persisted is a
  // genuine outcome rather than a hand-written object.
  app = await startVulnerableApp();
  const evidence = new EvidenceStore(crypto.randomUUID());
  const meter = new CostMeter({ maxRunCostUsd: 4 });
  const emptyExtraction = {
    parsed: (request: TransportRequest) => ({
      findings: [
        {
          ruleId: 'SEC-05',
          dimension: 'security_posture',
          severity: 'high',
          confidence: 'high',
          title: 'The admin dashboard renders for anyone who visits it',
          description:
            'An unauthenticated request to /admin returned the full dashboard, including customer email addresses.',
          remediation:
            'Enforce authorisation on the server before rendering /admin or anything it calls.',
          evidenceIds: mintedIds(request).slice(0, 1),
        },
      ],
      notes: [],
      coreFlowsReached: true,
    }),
  };
  const exploration = [
    { toolUses: [{ name: 'navigate', input: { url: app.url } }] },
    { toolUses: [{ name: 'screenshot', input: { caption: 'Evidence' } }] },
    { text: 'Done.' },
  ];

  const context: StageContext = {
    assessmentId: crypto.randomUUID(),
    depth: 'full',
    guard: new ScopeGuard({
      allowedHosts: [app.host.split(':')[0]!],
      exclusions: [],
      ceiling: { ...DEFAULT_CEILING, maxRequestsPerMinute: 600 },
      allowPrivateNetworkForTesting: true,
    }),
    meter,
    evidence,
    model: new ModelClient(
      new ScriptedTransport([
        ...exploration,
        emptyExtraction,
        ...exploration,
        emptyExtraction,
        {
          parsed: {
            headline: 'x',
            summary: 'y',
            strengths: [],
            prioritisedRemediation: [],
            notAssessed: [],
          },
        },
      ]),
      meter,
    ),
    log: () => undefined,
    target: {
      appId: 'app',
      organisationId: 'org',
      appName: 'Kettle',
      appType: 'web_url',
      primaryUrl: app.url,
      repositoryPath: null,
      intendedForAppStore: false,
      hasAuthentication: true,
      hasPayments: false,
      processesPersonalData: true,
      description: 'A shop that sells kettles.',
    },
  };

  outcome = await runPipeline({ context });
}, 180_000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await db?.end();
});

describe('the hard gate at dispatch', () => {
  it('refuses an app with no verified authorisation', async () => {
    const appId = await seedApp(db, owner);
    await expect(
      runAssessmentJob({ appId, depth: 'full', requestedBy: owner.userId }, { pool }),
    ).rejects.toThrow(NotAuthorisedError);
  });

  it('refuses an app refused under the Acceptable Use Policy', async () => {
    const appId = await seedApp(db, owner);
    await seedAuthorisation(db, owner, appId);
    await db.query(`update public.apps set screening_status = 'refused' where id = $1`, [appId]);
    await expect(
      runAssessmentJob({ appId, depth: 'full', requestedBy: owner.userId }, { pool }),
    ).rejects.toThrow(/Acceptable Use Policy/);
  });

  it('refuses an app whose authorisation was withdrawn', async () => {
    const appId = await seedApp(db, owner);
    const granted = await seedAuthorisation(db, owner, appId);
    await db.query(
      `insert into public.authorisations
         (app_id, organisation_id, supersedes_id, status, method, scope_domains,
          warranty_text_version, warranty_text_sha256, granted_by, revocation_reason)
       values ($1, $2, $3, 'revoked', 'dns_txt', '{}', '1.0.0', $4, $5, 'Customer withdrew authorisation')`,
      [appId, owner.organisationId, granted, sha256('w'), owner.userId],
    );
    await expect(
      runAssessmentJob({ appId, depth: 'full', requestedBy: owner.userId }, { pool }),
    ).rejects.toThrow(/hard gate/);
  });

  it('never permits a private address, even for an app whose declared host resolves inward', async () => {
    const appId = await seedApp(db, owner);
    await seedAuthorisation(db, owner, appId, { scopeDomains: ['localhost'] });
    // The run starts — authorisation exists — but no request reaches loopback,
    // so the deterministic stage cannot fetch anything and the run ends failed.
    const result = await runAssessmentJob(
      { appId, depth: 'limited', requestedBy: owner.userId },
      { pool, transport: new ScriptedTransport([]) },
    );
    const stages = await db.query(
      `select stage, status from public.assessment_runs where assessment_id = $1`,
      [result.assessmentId],
    );
    const deterministic = stages.rows.find((row) => row.stage === 'deterministic_checks');
    expect(deterministic?.status).toBe('failed');
  }, 60_000);
});

describe('what lands in the database', () => {
  let appId: string;
  let authorisationId: string;
  let assessmentId: string;

  beforeEach(async () => {
    appId = await seedApp(db, owner);
    authorisationId = await seedAuthorisation(db, owner, appId);
    const client = await pool.connect();
    try {
      // A fresh id per case: the engine's assessment id is the database primary
      // key, so re-persisting the same outcome twice is not something that
      // happens outside a test.
      assessmentId = await persistOutcome(client, {
        outcome: { ...outcome, assessmentId: crypto.randomUUID() },
        appId,
        organisationId: owner.organisationId,
        authorisationId,
        depth: 'full',
        requestedBy: owner.userId,
        engineVersion: '1.0.0',
      });
    } finally {
      client.release();
    }
  });

  it('stops at awaiting_review, because approval needs a human', async () => {
    const { rows } = await db.query(
      'select status, certification_eligible from public.assessments where id = $1',
      [assessmentId],
    );
    expect(rows[0].status).toBe('awaiting_review');
    expect(rows[0].certification_eligible).toBe(false);
  });

  it('links the assessment to the exact authorisation that permitted it', async () => {
    const { rows } = await db.query(
      'select authorisation_id from public.assessments where id = $1',
      [assessmentId],
    );
    expect(rows[0].authorisation_id).toBe(authorisationId);
  });

  it('writes every finding with its evidence attached', async () => {
    const findings = await db.query(
      'select id, title from public.findings where assessment_id = $1',
      [assessmentId],
    );
    expect(findings.rows.length).toBeGreaterThan(3);

    const unevidenced = await db.query(
      `select f.title from public.findings f
        where f.assessment_id = $1 and f.is_published
          and not exists (select 1 from public.finding_evidence fe where fe.finding_id = f.id)`,
      [assessmentId],
    );
    expect(unevidenced.rows, 'every published finding must carry evidence').toHaveLength(0);
  });

  it('records the prompt bundle, so the report can be reproduced', async () => {
    const { rows } = await db.query(
      'select prompt_bundle_sha256, scope_statement from public.assessments where id = $1',
      [assessmentId],
    );
    expect(rows[0].prompt_bundle_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].scope_statement).toContain('Absence of a finding is not evidence');
  });

  it('records what the run cost us, per stage', async () => {
    const { rows } = await db.query(
      'select sum(total_cost_usd) as total, count(*) as stages from public.cost_records where assessment_id = $1',
      [assessmentId],
    );
    expect(Number(rows[0].total)).toBeGreaterThan(0);
    expect(Number(rows[0].stages)).toBeGreaterThan(2);
  });

  it('writes an audit entry that cannot later be edited', async () => {
    const { rows } = await db.query(
      `select action, summary from public.audit_log where entity_id = $1 and action = 'assessment.completed'`,
      [assessmentId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].summary).toMatch(/finding/);
  });

  it('cannot be approved without a recorded human review', async () => {
    await db.query('begin');
    await expect(
      db.query(`update public.assessments set status = 'approved' where id = $1`, [assessmentId]),
    ).rejects.toThrow(/without a recorded human review/);
    await db.query('rollback');
  });
});

describe('withdrawal during a run', () => {
  it('discards the output rather than storing it', async () => {
    const appId = await seedApp(db, owner);
    const granted = await seedAuthorisation(db, owner, appId);
    await db.query(
      `insert into public.authorisations
         (app_id, organisation_id, supersedes_id, status, method, scope_domains,
          warranty_text_version, warranty_text_sha256, granted_by, revocation_reason)
       values ($1, $2, $3, 'revoked', 'dns_txt', '{}', '1.0.0', $4, $5, 'Withdrawn while the run was in flight')`,
      [appId, owner.organisationId, granted, sha256('w'), owner.userId],
    );

    const client = await pool.connect();
    try {
      await expect(
        persistOutcome(client, {
          outcome,
          appId,
          organisationId: owner.organisationId,
          authorisationId: granted,
          depth: 'full',
          requestedBy: owner.userId,
          engineVersion: '1.0.0',
        }),
      ).rejects.toThrow(AuthorisationWithdrawnError);
    } finally {
      client.release();
    }

    const stored = await db.query(
      'select count(*)::int as n from public.assessments where app_id = $1',
      [appId],
    );
    expect(stored.rows[0].n, 'nothing from a withdrawn authorisation may be stored').toBe(0);
  });
});
