/**
 * The whole thing, once, in order.
 *
 * Every other suite in this repository proves one milestone in isolation. This
 * one walks a single application from a signature on a warranty to a suspended
 * badge, through the same tables, functions and sweeps a real customer would
 * touch, in the order they would touch them. It exists because the failures that
 * matter most in a system like this are not inside a milestone — they are in the
 * seam between two of them, where a column was renamed on one side, or a status
 * one step writes is a status the next step never looks for.
 *
 * Where it is not the real code, it says so:
 *
 *   · Act 1 runs the genuine engine against the flawed fixture, over the queue,
 *     and asserts what actually comes back.
 *   · Act 2 needs an application that passes, and a loopback fixture is served
 *     over plain HTTP, which is a critical finding on its own and always will
 *     be. So the re-assessment substitutes a stage — everything downstream of
 *     it, from scoring to signing, is the production path.
 *
 * The rule the whole product rests on is checked at both ends: no run without a
 * verified authorisation, and no badge without a human, a rubric gate and a
 * signed licence. Nothing here can buy any of them.
 */
import { createPublicKey, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool, type PoolClient } from 'pg';
import {
  CostMeter,
  DEFAULT_CEILING,
  EvidenceStore,
  ModelClient,
  ScopeGuard,
  ScriptedTransport,
  createChallenge,
  permittedScopeFor,
  runPipeline,
  verifyWellKnownFile,
  type AssessmentOutcome,
  type RawFinding,
  type Stage,
  type StageContext,
} from '../packages/engine/src/index.ts';
import {
  ENGINE_VERSION,
  claimNextRequest,
  completeRequest,
  findIssuanceCandidates,
  issueBadgeFor,
  persistOutcome,
  recordDriftFor,
  runAssessmentJob,
  BADGE_LICENCE_VERSION,
} from '../apps/worker/src/index.ts';
import { LocalReportStorage, sweepPendingReports } from '../apps/worker/src/report.ts';
import {
  buildKeySet,
  generateSigningKey,
  privateKeyFromBase64,
  toJwk,
  verifyBadge,
} from '../packages/badge/src/index.ts';
import { NON_RELIANCE_LEGEND } from '../packages/shared/src/index.ts';
import { connect } from './setup/client.ts';
import { makeReviewer, seedAccount, seedRubric, sha256, type SeededAccount } from './setup/seed.ts';
import { startVulnerableApp, type FixtureApp } from './fixtures/vulnerable-app.ts';

let db: Client;
let pool: Pool;
let owner: SeededAccount;
let reviewer: SeededAccount;
let fixture: FixtureApp;
let reportDir: string;
/**
 * The host the customer registers and proves. It is not the fixture's host: the
 * schema refuses a `primary_url` that is not HTTPS, and the fixture is loopback
 * HTTP. So the record says what a real record would say, and the one run that
 * actually leaves the machine is pointed at the fixture explicitly.
 */
let appHost: string;

/** Carried between acts, in the order the customer creates them. */
const journey: {
  appId?: string;
  authorisationId?: string;
  firstAssessmentId?: string;
  secondAssessmentId?: string;
  thirdAssessmentId?: string;
  badgeId?: string;
  badgePublicId?: string;
} = {};

const generated = generateSigningKey('vibefycode-journey');
const signingKey = {
  kid: generated.kid,
  privateKey: privateKeyFromBase64(generated.privateKeyB64),
  jwk: toJwk(createPublicKey(privateKeyFromBase64(generated.privateKeyB64)), generated.kid),
};
const publishedKeys = buildKeySet(signingKey);

async function withClient<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await work(client);
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  db = await connect();
  const dsn = new URL(process.env.VIBEFYCODE_TEST_DSN!);
  pool = new Pool({
    host: dsn.searchParams.get('host')!,
    database: dsn.pathname.slice(1),
    user: 'postgres',
  });
  owner = await seedAccount(db, 'journey-owner');
  reviewer = await seedAccount(db, 'journey-reviewer');
  await makeReviewer(db, reviewer.userId);
  await seedRubric(db);
  fixture = await startVulnerableApp();
  reportDir = await mkdtemp(join(tmpdir(), 'vibefycode-journey-'));
}, 120_000);

afterAll(async () => {
  await fixture?.close();
  if (reportDir) await rm(reportDir, { recursive: true, force: true });
  await pool?.end();
  await db?.end();
});

// ---------------------------------------------------------------------------
// Act 1 — sign up, add an application, and prove you control it
// ---------------------------------------------------------------------------

describe('act 1: getting to the point where anything may be tested', () => {
  it('gives a new account exactly one organisation, without being asked', async () => {
    const { rows } = await db.query<{ count: string; role: string }>(
      `select count(*)::text as count, min(role) as role
         from public.memberships where user_id = $1`,
      [owner.userId],
    );
    expect(rows[0]!.count).toBe('1');
    expect(rows[0]!.role).toBe('owner');
  });

  it('accepts the application, unscreened and untestable', async () => {
    const slug = `journey-${randomUUID().slice(0, 8)}`;
    appHost = `${slug}.example.test`;
    const { rows } = await db.query<{ id: string; screening_status: string }>(
      `insert into public.apps
         (organisation_id, name, slug, app_type, primary_url, created_by,
          has_authentication, has_payments, processes_personal_data)
       values ($1, 'Kettle', $2, 'web_url', $3, $4, true, true, true)
       returning id, screening_status`,
      [owner.organisationId, slug, `https://${appHost}/`, owner.userId],
    );
    journey.appId = rows[0]!.id;

    const { rows: gate } = await db.query<{ ok: boolean }>(
      'select public.app_is_authorised_for_testing($1) as ok',
      [journey.appId],
    );
    // Adding an application authorises nothing. This is the state the product
    // spends most of its life in and the one an attacker would like to skip.
    expect(gate[0]!.ok).toBe(false);
  });

  it('refuses to run against it', async () => {
    await expect(
      runAssessmentJob(
        { appId: journey.appId!, depth: 'full', requestedBy: owner.userId },
        { pool },
      ),
    ).rejects.toThrow(/hard gate/);
  });

  it('records the warranty and the challenge before anything is verified', async () => {
    const host = appHost;
    const challenge = createChallenge(host);
    const { allowed, refused } = permittedScopeFor(host, [host, 'someone-elses.example']);

    // A customer may authorise the host they prove and its subdomains. Asking
    // for more is not an error message; it is silently narrowed and reported.
    expect(allowed).toEqual([host]);
    expect(refused).toEqual(['someone-elses.example']);

    const { rows } = await db.query<{ id: string }>(
      `insert into public.authorisations
         (app_id, organisation_id, status, method, verification_token, verification_target,
          scope_domains, warranty_text_version, warranty_text_sha256, granted_by)
       values ($1, $2, 'pending', 'dns_txt', $3, $4, $5, '1.0.0', $6, $7)
       returning id`,
      [
        journey.appId,
        owner.organisationId,
        challenge.token,
        host,
        allowed,
        sha256('authorisation-warranty-1.0.0'),
        owner.userId,
      ],
    );

    // Pending is not verified.
    const { rows: gate } = await db.query<{ ok: boolean }>(
      'select public.app_is_authorised_for_testing($1) as ok',
      [journey.appId],
    );
    expect(gate[0]!.ok).toBe(false);

    // And the check has to actually pass before anything changes. Nothing is
    // published at this host, so it does not.
    const outcome = await verifyWellKnownFile(host, challenge.token);
    expect(outcome.verified).toBe(false);
    expect(outcome.detail).toMatch(/does not resolve|non-public address|could not be reached/);

    journey.authorisationId = rows[0]!.id;
  });

  it('opens the gate only once a verified record supersedes the pending one', async () => {
    const host = appHost;
    const { rows } = await db.query<{ id: string }>(
      `insert into public.authorisations
         (app_id, organisation_id, supersedes_id, status, method, verification_target,
          verified_at, scope_domains, warranty_text_version, warranty_text_sha256,
          granted_by, expires_at)
       values ($1, $2, $3, 'verified', 'dns_txt', $4, now(), $5, '1.0.0', $6, $7,
               now() + interval '365 days')
       returning id`,
      [
        journey.appId,
        owner.organisationId,
        journey.authorisationId,
        host,
        [host],
        sha256('authorisation-warranty-1.0.0'),
        owner.userId,
      ],
    );
    journey.authorisationId = rows[0]!.id;

    const { rows: gate } = await db.query<{ ok: boolean }>(
      'select public.app_is_authorised_for_testing($1) as ok',
      [journey.appId],
    );
    expect(gate[0]!.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Act 2 — the queue, the engine, and a verdict the customer will not enjoy
// ---------------------------------------------------------------------------

describe('act 2: the first assessment, run for real', () => {
  it('queues a request the customer can see in their own tables', async () => {
    await db.query(
      `insert into public.assessment_requests
         (app_id, organisation_id, requested_by, depth, max_run_cost_usd, plan_at_request)
       values ($1, $2, $3, 'full', 4.00, 'one_off')`,
      [journey.appId, owner.organisationId, owner.userId],
    );
    const { rows } = await db.query<{ status: string }>(
      'select status from public.assessment_requests where app_id = $1',
      [journey.appId],
    );
    expect(rows.map((row) => row.status)).toEqual(['queued']);
  });

  it('runs the engine against the application and lands in the review queue', async () => {
    const claimed = await withClient((client) => claimNextRequest(client));
    expect(claimed?.appId).toBe(journey.appId);

    // The scope guard the worker builds from the stored record cannot reach a
    // private address, and the fixture is on loopback — so the run is driven
    // here with a policy that can, which is the one thing tests are allowed to
    // do and nothing else in the codebase is.
    const result = await runRealPipeline();
    journey.firstAssessmentId = result.assessmentId;
    await withClient((client) => completeRequest(client, claimed!.id, result.assessmentId));

    const { rows } = await db.query<{ status: string; certification_eligible: boolean }>(
      'select status, certification_eligible from public.assessments where id = $1',
      [result.assessmentId],
    );
    // The worker's last word is `awaiting_review`. It cannot approve anything.
    expect(rows[0]!.status).toBe('awaiting_review');
    expect(rows[0]!.certification_eligible).toBe(false);
  }, 180_000);

  it('found the defects the fixture actually has, with evidence attached', async () => {
    const { rows } = await db.query<{ rubric_rule_id: string; severity: string; evidence: string }>(
      `select f.rubric_rule_id, f.severity,
              count(fe.evidence_id)::text as evidence
         from public.findings f
         left join public.finding_evidence fe on fe.finding_id = f.id
        where f.assessment_id = $1
        group by f.id`,
      [journey.firstAssessmentId],
    );
    expect(rows.length).toBeGreaterThan(3);
    // Every published finding carries evidence. One that does not is withheld
    // by the pipeline before it ever reaches here.
    expect(rows.every((row) => Number(row.evidence) > 0)).toBe(true);
    expect(rows.some((row) => row.severity === 'critical')).toBe(true);
  });

  it('will not let a reviewer certify it, however much they want to', async () => {
    await db.query(
      `insert into public.reviews (assessment_id, organisation_id, reviewer_id, action, reason)
       values ($1, $2, $3, 'approved', 'Findings and evidence checked against the rubric.')`,
      [journey.firstAssessmentId, owner.organisationId, reviewer.userId],
    );
    await expect(
      db.query(
        `update public.assessments
            set status = 'approved', certification_eligible = true, reviewed_at = now()
          where id = $1`,
        [journey.firstAssessmentId],
      ),
    ).rejects.toThrow(/critical security or privacy finding/);

    // Approved, but not certified. The customer gets a report and no badge.
    await db.query(
      `update public.assessments
          set status = 'approved', overall_score = 41.0, reviewed_at = now()
        where id = $1`,
      [journey.firstAssessmentId],
    );
  });

  it('produces a report that states its own limits', async () => {
    const storage = new LocalReportStorage(reportDir);
    const generated = await sweepPendingReports(pool, storage);
    expect(generated).toBeGreaterThan(0);

    const { rows } = await db.query<{ storage_path: string; non_reliance_legend: string }>(
      `select storage_path, non_reliance_legend from public.reports
        where assessment_id = $1 and format = 'html'`,
      [journey.firstAssessmentId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.non_reliance_legend).toBe(NON_RELIANCE_LEGEND);

    const html = (await storage.get(rows[0]!.storage_path))!.toString('utf8');
    expect(html).toContain(NON_RELIANCE_LEGEND);
    // The scope statement is what makes the score honest. A report without one
    // is a claim about an application rather than about what we looked at.
    expect(html).toContain('What this assessment is, and is not');
  }, 120_000);

  it('offers no badge, because the gate that matters did not open', async () => {
    await acceptBadgeLicence();
    const candidates = await withClient((client) => findIssuanceCandidates(client));
    expect(candidates.some((row) => row.assessmentId === journey.firstAssessmentId)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Act 3 — the customer fixes it, and earns the badge
// ---------------------------------------------------------------------------

describe('act 3: the re-assessment that passes', () => {
  it('scores, reviews and certifies the fixed application', async () => {
    await db.query(
      `insert into public.assessment_requests
         (app_id, organisation_id, requested_by, depth, max_run_cost_usd, plan_at_request)
       values ($1, $2, $3, 'full', 4.00, 'one_off')`,
      [journey.appId, owner.organisationId, owner.userId],
    );
    const claimed = await withClient((client) => claimNextRequest(client));
    expect(claimed).not.toBeNull();

    const outcome = await runSubstitutedPipeline([
      finding({
        ruleId: 'SEC-01',
        severity: 'medium',
        title: 'No Strict-Transport-Security header',
      }),
      finding({
        ruleId: 'UX-02',
        dimension: 'practicality_ux',
        severity: 'low',
        title: 'Touch targets on the basket page are below 24px',
      }),
    ]);
    journey.secondAssessmentId = await withClient((client) =>
      persistOutcome(client, {
        outcome,
        appId: journey.appId!,
        organisationId: owner.organisationId,
        authorisationId: journey.authorisationId!,
        depth: 'full',
        requestedBy: owner.userId,
        engineVersion: ENGINE_VERSION,
      }),
    );
    await withClient((client) => completeRequest(client, claimed!.id, journey.secondAssessmentId!));

    await db.query(
      `insert into public.reviews (assessment_id, organisation_id, reviewer_id, action, reason)
       values ($1, $2, $3, 'approved', 'Re-checked; the critical findings are resolved.')`,
      [journey.secondAssessmentId, owner.organisationId, reviewer.userId],
    );
    await db.query(
      `update public.assessments
          set status = 'approved', certification_eligible = true, overall_score = 86.0,
              reviewed_at = now()
        where id = $1`,
      [journey.secondAssessmentId],
    );
  }, 60_000);

  it('issues a badge, and only because all three gates opened', async () => {
    const candidate = (await withClient((client) => findIssuanceCandidates(client))).find(
      (row) => row.assessmentId === journey.secondAssessmentId,
    );
    expect(candidate).toBeDefined();

    const issued = await withClient((client) => issueBadgeFor(client, candidate!, signingKey));
    journey.badgeId = issued.badgeId;
    journey.badgePublicId = issued.publicId;

    const { rows } = await db.query<{ status: string; signing_key_id: string }>(
      'select status, signing_key_id from public.badges where id = $1',
      [issued.badgeId],
    );
    expect(rows[0]!.status).toBe('active');
    expect(rows[0]!.signing_key_id).toBe(signingKey.kid);
  });

  it('verifies for a stranger holding nothing but the payload and the public keys', async () => {
    const { rows } = await db.query<{ payload: unknown; signature: string }>(
      'select payload, signature from public.badges where id = $1',
      [journey.badgeId],
    );
    const result = verifyBadge(
      { payload: rows[0]!.payload, signature: rows[0]!.signature },
      publishedKeys,
    );
    expect(result.signatureValid).toBe(true);
    expect(result.withinValidity).toBe(true);
    expect(result.payload?.badgeId).toBe(journey.badgePublicId);
    expect(result.payload?.score).toBe(86);
  });

  it('says nothing a badge is not entitled to say', async () => {
    const { rows } = await db.query<{ payload: Record<string, unknown> }>(
      'select payload from public.badges where id = $1',
      [journey.badgeId],
    );
    const text = JSON.stringify(rows[0]!.payload).toLowerCase();
    for (const word of ['secure', 'safe', 'guaranteed', 'hack-proof', 'approved by']) {
      expect(text).not.toContain(word);
    }
  });
});

// ---------------------------------------------------------------------------
// Act 4 — the application changes, and the claim stops being true
// ---------------------------------------------------------------------------

describe('act 4: drift, and taking the badge back', () => {
  it('suspends the badge when a re-assessment finds a serious new problem', async () => {
    const outcome = await runSubstitutedPipeline([
      finding({
        ruleId: 'SEC-05',
        severity: 'critical',
        title: 'The admin dashboard renders for anyone who visits it',
      }),
    ]);
    journey.thirdAssessmentId = await withClient((client) =>
      persistOutcome(client, {
        outcome,
        appId: journey.appId!,
        organisationId: owner.organisationId,
        authorisationId: journey.authorisationId!,
        depth: 'continuous',
        requestedBy: null,
        engineVersion: ENGINE_VERSION,
      }),
    );
    await db.query(
      `insert into public.reviews (assessment_id, organisation_id, reviewer_id, action, reason)
       values ($1, $2, $3, 'approved', 'Confirmed against evidence; the regression is real.')`,
      [journey.thirdAssessmentId, owner.organisationId, reviewer.userId],
    );
    await db.query(
      `update public.assessments
          set status = 'approved', overall_score = 48.0, reviewed_at = now(),
              completed_at = now() + interval '1 second'
        where id = $1`,
      [journey.thirdAssessmentId],
    );

    const drift = await withClient((client) => recordDriftFor(client, journey.thirdAssessmentId!));
    expect(drift?.materialRegression).toBe(true);
    expect(drift?.badgeSuspended).toBe(true);

    const { rows } = await db.query<{ status: string; suspension_reason: string | null }>(
      'select status, suspension_reason from public.badges where id = $1',
      [journey.badgeId],
    );
    expect(rows[0]!.status).toBe('suspended');
    expect(rows[0]!.suspension_reason).toMatch(/material change/i);
  }, 60_000);

  it('tells the customer on the screen they are already looking at', async () => {
    const { rows } = await db.query<{ severity: string; read_at: string | null; kind: string }>(
      `select severity, read_at, kind from public.alerts
        where organisation_id = $1 and app_id = $2
        order by created_at`,
      [owner.organisationId, journey.appId],
    );
    expect(rows.some((row) => row.kind === 'badge_suspended')).toBe(true);
    // Unread and critical, which is what the console banner reads. Email is the
    // record; this is the channel that gets seen.
    expect(rows.some((row) => row.severity === 'critical' && row.read_at === null)).toBe(true);
  });

  it('keeps the signature genuine while the standing is gone', async () => {
    // The distinction the whole verification page rests on: the badge was
    // really issued by us and the bytes were not forged. It is simply no longer
    // in force, and only the record can say that — which is why the badge image
    // is not the proof and the verification page is.
    const { rows } = await db.query<{ payload: unknown; signature: string; status: string }>(
      'select payload, signature, status from public.badges where id = $1',
      [journey.badgeId],
    );
    const result = verifyBadge(
      { payload: rows[0]!.payload, signature: rows[0]!.signature },
      publishedKeys,
    );
    expect(result.signatureValid).toBe(true);
    expect(rows[0]!.status).toBe('suspended');
  });

  it('leaves the drift report behind as an unalterable record', async () => {
    const { rows } = await db.query<{ id: string; material_regression: boolean }>(
      'select id, material_regression from public.drift_reports where assessment_id = $1',
      [journey.thirdAssessmentId],
    );
    expect(rows[0]!.material_regression).toBe(true);
    await expect(
      db.query('update public.drift_reports set material_regression = false where id = $1', [
        rows[0]!.id,
      ]),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function finding(overrides: Partial<RawFinding> & { ruleId: string; title: string }): RawFinding {
  return {
    dimension: 'security_posture',
    severity: 'medium',
    confidence: 'high',
    description: `${overrides.title}. Observed on the assessed routes.`,
    remediation: 'Fix it at the origin rather than in front of it.',
    evidenceIds: [],
    ...overrides,
  } as RawFinding;
}

/** The real engine, against the real fixture, with the one policy tests may set. */
async function runRealPipeline(): Promise<{ assessmentId: string }> {
  const assessmentId = randomUUID();
  const evidence = new EvidenceStore(assessmentId);
  const meter = new CostMeter({ maxRunCostUsd: 4 });
  const guard = new ScopeGuard({
    allowedHosts: [fixture.host.split(':')[0]!],
    exclusions: [],
    ceiling: { ...DEFAULT_CEILING, maxRequestsPerMinute: 600 },
    allowPrivateNetworkForTesting: true,
  });

  const explore = [
    { toolUses: [{ name: 'navigate', input: { url: fixture.url } }] },
    { toolUses: [{ name: 'screenshot', input: { caption: 'Landing page' } }] },
    { text: 'Done.' },
  ];
  const extraction = {
    parsed: () => ({ findings: [], notes: [], coreFlowsReached: true }),
  };

  const outcome = await runPipeline({
    context: {
      assessmentId,
      depth: 'full',
      guard,
      meter,
      evidence,
      model: new ModelClient(
        new ScriptedTransport([
          ...explore,
          extraction,
          ...explore,
          extraction,
          {
            parsed: {
              headline: 'Several defects were found on the assessed routes.',
              summary:
                'The application exposes configuration and serves an administrative route without authentication.',
              strengths: [],
              prioritisedRemediation: [],
              notAssessed: [],
            },
          },
        ]),
        meter,
      ),
      log: () => undefined,
      // The stored record says `https://<slug>.example.test`, because the schema
      // will not hold anything else. The request that actually leaves is pointed
      // at the fixture, which is the application the customer is describing.
      target: { ...(await targetRow()), primaryUrl: fixture.url },
    },
  });

  const persisted = await withClient((client) =>
    persistOutcome(client, {
      outcome,
      appId: journey.appId!,
      organisationId: owner.organisationId,
      authorisationId: journey.authorisationId!,
      depth: 'full',
      requestedBy: owner.userId,
      engineVersion: ENGINE_VERSION,
    }),
  );
  return { assessmentId: persisted };
}

/**
 * The pipeline with its network stages replaced by one that reports a given set
 * of findings. Scoring, evidence enforcement, the scope statement, the narrative
 * and everything downstream are the production path; only the observation is
 * substituted, because a loopback fixture cannot be served over HTTPS and plain
 * HTTP is a critical finding forever.
 */
async function runSubstitutedPipeline(findings: readonly RawFinding[]): Promise<AssessmentOutcome> {
  const assessmentId = randomUUID();
  const evidence = new EvidenceStore(assessmentId);
  const meter = new CostMeter({ maxRunCostUsd: 4 });

  const stage: Stage = {
    id: 'deterministic_checks',
    appliesTo: () => true,
    async run(context) {
      // Real evidence rows, so the pipeline's evidence enforcement has something
      // genuine to enforce against rather than being handed a pass.
      return {
        stage: 'deterministic_checks',
        status: 'succeeded',
        notes: [],
        findings: findings.map((raw) => ({
          ...raw,
          evidenceIds: [
            context.evidence.capture({
              kind: 'header_scan',
              summary: `Observation supporting: ${raw.title}`,
              body: { rule: raw.ruleId },
            }).id,
          ],
        })),
      };
    },
  };

  return runPipeline({
    stages: [stage],
    context: {
      assessmentId,
      depth: 'full',
      guard: new ScopeGuard({
        allowedHosts: [fixture.host.split(':')[0]!],
        exclusions: [],
        ceiling: DEFAULT_CEILING,
        allowPrivateNetworkForTesting: true,
      }),
      meter,
      evidence,
      model: new ModelClient(
        new ScriptedTransport([
          {
            parsed: {
              headline: 'The previously reported critical defects were not found again.',
              summary:
                'The assessed routes no longer expose configuration, and the administrative route requires authentication.',
              strengths: ['Configuration is no longer served from the document root.'],
              prioritisedRemediation: [],
              notAssessed: [],
            },
          },
        ]),
        meter,
      ),
      log: () => undefined,
      target: await targetRow(),
    },
  });
}

async function targetRow(): Promise<StageContext['target']> {
  const { rows } = await db.query<{
    id: string;
    organisation_id: string;
    name: string;
    primary_url: string;
  }>('select id, organisation_id, name, primary_url from public.apps where id = $1', [
    journey.appId,
  ]);
  const row = rows[0]!;
  return {
    appId: row.id,
    organisationId: row.organisation_id,
    appName: row.name,
    appType: 'web_url',
    primaryUrl: row.primary_url,
    repositoryPath: null,
    intendedForAppStore: false,
    hasAuthentication: true,
    hasPayments: true,
    processesPersonalData: true,
    description: 'A shop that sells kettles.',
  };
}

async function acceptBadgeLicence(): Promise<void> {
  await db.query(
    `insert into public.consents
       (user_id, organisation_id, document_type, document_version, document_sha256, action)
     values ($1, $2, 'badge_licence', $3, $4, 'accepted')`,
    [owner.userId, owner.organisationId, BADGE_LICENCE_VERSION, sha256('badge-licence')],
  );
}
