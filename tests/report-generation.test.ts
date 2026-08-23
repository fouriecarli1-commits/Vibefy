/**
 * Generating a report from the database.
 *
 * The point of assembling from stored rows rather than from the engine's memory
 * is that a report must be reproducible years later, from the row alone. So this
 * runs a real pipeline, persists it, throws the outcome away, and rebuilds the
 * report from what the database kept.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import {
  CostMeter,
  DEFAULT_CEILING,
  EvidenceStore,
  ModelClient,
  ScopeGuard,
  ScriptedTransport,
  runPipeline,
  type StageContext,
  type TransportRequest,
} from '../packages/engine/src/index.ts';
import { persistOutcome } from '../apps/worker/src/persist.ts';
import {
  LocalReportStorage,
  assembleReportSource,
  generateReport,
} from '../apps/worker/src/report.ts';
import { connect } from './setup/client.ts';
import {
  makeReviewer,
  seedAccount,
  seedApp,
  seedAuthorisation,
  seedRubric,
  type SeededAccount,
} from './setup/seed.ts';
import { startVulnerableApp, type FixtureApp } from './fixtures/vulnerable-app.ts';

let db: Client;
let pool: Pool;
let app: FixtureApp;
let owner: SeededAccount;
let reviewer: SeededAccount;
let assessmentId: string;
let storageRoot: string;
let storage: LocalReportStorage;

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
  const dsn = new URL(process.env.VIBEFYCODE_TEST_DSN!);
  pool = new Pool({
    host: dsn.searchParams.get('host')!,
    database: dsn.pathname.slice(1),
    user: 'postgres',
  });
  storageRoot = mkdtempSync(join(tmpdir(), 'vibefycode-reports-'));
  storage = new LocalReportStorage(storageRoot);

  owner = await seedAccount(db, 'report-owner');
  reviewer = await seedAccount(db, 'report-reviewer');
  await makeReviewer(db, reviewer.userId);
  await seedRubric(db);

  app = await startVulnerableApp();
  const evidence = new EvidenceStore(crypto.randomUUID());
  const meter = new CostMeter({ maxRunCostUsd: 4 });
  const exploration = [
    { toolUses: [{ name: 'navigate', input: { url: app.url } }] },
    {
      toolUses: [
        {
          name: 'screenshot',
          input: { caption: 'Admin dashboard rendered without a sign-in prompt' },
        },
      ],
    },
    { text: 'Done.' },
  ];
  const extraction = {
    parsed: (request: TransportRequest) => ({
      findings: [
        {
          ruleId: 'SEC-05',
          dimension: 'security_posture',
          severity: 'critical',
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
        extraction,
        ...exploration,
        extraction,
        {
          parsed: {
            headline: 'Kettle works as a shop, but it is serving an admin page to anyone who asks.',
            summary:
              'The purchase flow completes. Authorisation is enforced in the browser rather than on the server.',
            strengths: ['Sign-up completes without friction.'],
            prioritisedRemediation: [
              {
                order: 1,
                title: 'Enforce authorisation on the server',
                why: 'Anyone can read every customer email address today.',
                step: 'Return 401 before rendering /admin, and check the session on every endpoint it calls.',
              },
            ],
            notAssessed: [
              'The payment flow was not exercised, because that would require a real card.',
            ],
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
      // Store readiness is exercised in the pipeline test; skipping it here keeps
      // the scripted transport aligned with exactly the calls this test needs.
      intendedForAppStore: false,
      hasAuthentication: true,
      hasPayments: true,
      processesPersonalData: true,
      description: 'A shop that sells kettles.',
    },
  };

  const outcome = await runPipeline({ context, assessedOn: '2026-08-22' });
  const appId = await seedApp(db, owner, 'Kettle');
  const authorisationId = await seedAuthorisation(db, owner, appId);

  const client = await pool.connect();
  try {
    assessmentId = await persistOutcome(client, {
      outcome,
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
}, 240_000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await db?.end();
  if (storageRoot) rmSync(storageRoot, { recursive: true, force: true });
});

describe('assembling from the database alone', () => {
  it('rebuilds everything a report needs', async () => {
    const client = await pool.connect();
    try {
      const source = await assembleReportSource(client, assessmentId);
      expect(source.appName).toBe('Kettle');
      expect(source.findings.length).toBeGreaterThan(3);
      expect(source.dimensions).toHaveLength(6);
      expect(source.scopeStatement).toContain('Absence of a finding is not evidence');
      expect(source.promptBundleSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(source.narrative?.headline).toMatch(/admin page/);
      expect(source.narrative?.notAssessed[0]).toMatch(/real card/);
    } finally {
      client.release();
    }
  });

  it('carries the evidence behind each finding', async () => {
    const client = await pool.connect();
    try {
      const source = await assembleReportSource(client, assessmentId);
      const evidenced = source.findings.filter((finding) => finding.evidence.length > 0);
      expect(evidenced.length).toBe(source.findings.length);
      expect(evidenced[0]!.evidence[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      client.release();
    }
  });
});

describe('generating', () => {
  it('writes an HTML report and records it', async () => {
    const client = await pool.connect();
    try {
      const result = await generateReport(client, storage, {
        assessmentId,
        tier: 'paid',
        formats: ['html'],
      });
      expect(result.html.sha256).toMatch(/^[0-9a-f]{64}$/);
      const html = readFileSync(join(storageRoot, result.html.storagePath), 'utf8');
      expect(html).toContain('Kettle');
      expect(html).toContain('Enforce authorisation on the server');
    } finally {
      client.release();
    }

    const { rows } = await db.query(
      `select format, sha256, scope_statement, non_reliance_legend from public.reports where assessment_id = $1`,
      [assessmentId],
    );
    expect(rows.map((row) => row.format)).toContain('html');
    expect(rows[0].scope_statement).toContain('point-in-time');
    expect(rows[0].non_reliance_legend).toMatch(/No third party/);
  }, 60_000);

  it('prints a PDF that opens', async () => {
    const client = await pool.connect();
    try {
      const result = await generateReport(client, storage, {
        assessmentId,
        tier: 'paid',
        formats: ['pdf'],
      });
      expect(result.pdf).not.toBeNull();
      const bytes = readFileSync(join(storageRoot, result.pdf!.storagePath));
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
      expect(bytes.byteLength).toBeGreaterThan(5_000);
    } finally {
      client.release();
    }
  }, 120_000);

  it('refuses a PDF on the free tier rather than quietly downgrading', async () => {
    const client = await pool.connect();
    try {
      await expect(
        generateReport(client, storage, { assessmentId, tier: 'free', formats: ['pdf'] }),
      ).rejects.toThrow(/part of the paid report/i);
    } finally {
      client.release();
    }
  });

  it('refuses to publish a report with no frozen scope statement', async () => {
    await db.query(`update public.assessments set scope_statement = null where id = $1`, [
      assessmentId,
    ]);
    const client = await pool.connect();
    try {
      await expect(
        generateReport(client, storage, { assessmentId, tier: 'paid', formats: ['html'] }),
      ).rejects.toThrow(/states no limits/i);
    } finally {
      client.release();
      await db.query(`update public.assessments set scope_statement = $2 where id = $1`, [
        assessmentId,
        'This assessment is a point-in-time, scope-limited, AI-assisted and human-reviewed evaluation. Absence of a finding is not evidence of absence of a defect.',
      ]);
    }
  });
});
