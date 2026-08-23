/**
 * The pipeline, end to end.
 *
 * Runs every stage against the deliberately flawed fixture, with a scripted
 * model transport so the test is deterministic, hermetic and free. What is being
 * tested is the machinery around the model — evidence enforcement, ceilings,
 * retries, scoring, and the fact that a claim nobody captured evidence for never
 * reaches the report.
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CostMeter,
  DEFAULT_CEILING,
  EvidenceStore,
  ModelClient,
  ScopeGuard,
  ScriptedTransport,
  runPipeline,
  type AssessmentOutcome,
  type ScriptedStep,
  type StageContext,
  type TransportRequest,
} from '../packages/engine/src/index.ts';
import { startVulnerableApp, type FixtureApp } from './fixtures/vulnerable-app.ts';

let app: FixtureApp;
let repoPath: string;
let outcome: AssessmentOutcome;
let transport: ScriptedTransport;
let meter: CostMeter;

/** Reads the evidence ids the stage minted out of the request it just sent. */
function mintedIds(request: TransportRequest): string[] {
  const context = request.system.map((block) => block.text).join('\n');
  const section = /Evidence ids captured during this stage:\n([\s\S]*)$/.exec(context);
  return (section?.[1] ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[0-9a-f-]{36}$/.test(line));
}

const explorationSteps = (toolName: string, input: Record<string, unknown>): ScriptedStep[] => [
  { toolUses: [{ name: toolName, input }] },
  {
    toolUses: [
      { name: 'screenshot', input: { caption: 'What the page looked like at this point' } },
    ],
  },
  { text: 'I worked through the application and captured what I saw.' },
];

beforeAll(async () => {
  app = await startVulnerableApp();

  // A small repository fixture, so the static stage has something to analyse.
  repoPath = mkdtempSync(join(tmpdir(), 'vibefycode-repo-'));
  mkdirSync(join(repoPath, 'src'), { recursive: true });
  writeFileSync(
    join(repoPath, 'package.json'),
    JSON.stringify(
      { name: 'kettle', version: '1.0.0', dependencies: { minimist: '1.2.0', express: '4.17.1' } },
      null,
      2,
    ),
  );
  writeFileSync(
    join(repoPath, '.env'),
    // secret-scan-allow: fabricated fixture value the static stage is meant to find
    `STRIPE_SECRET_KEY=${'sk' + '_live_' + '51ZZZZZZZZZZZZZZZZZZZ'}\n`,
  );
  writeFileSync(join(repoPath, 'src', 'index.js'), 'console.log("hello");\n');

  const evidence = new EvidenceStore('assessment-pipeline');
  meter = new CostMeter({ maxRunCostUsd: 4 });

  transport = new ScriptedTransport([
    // functional exploration, then its structured extraction
    ...explorationSteps('navigate', { url: app.url }),
    {
      parsed: (request: TransportRequest) => ({
        findings: [
          {
            ruleId: 'FI-05',
            dimension: 'functional_integrity',
            severity: 'low',
            confidence: 'high',
            title: 'The orders page shows a bare list with no empty state',
            description:
              'Opening the orders page as a new user shows an unstyled list and nothing else. A first-time user has no idea whether the page is broken or simply empty.',
            remediation:
              'Add an empty state to the orders page explaining there are no orders yet and linking to the shop.',
            evidenceIds: mintedIds(request).slice(0, 1),
          },
          {
            ruleId: 'FI-01',
            dimension: 'functional_integrity',
            severity: 'high',
            confidence: 'low',
            title: 'Checkout probably loses the basket on refresh',
            description:
              'I did not actually see this happen, but applications like this usually do.',
            remediation: 'Persist the basket.',
            evidenceIds: [], // deliberately unevidenced — must be dropped
          },
        ],
        notes: ['The payment flow was not reachable without a card, so it was not assessed.'],
        coreFlowsReached: true,
      }),
    },
    // adversarial pass, then extraction
    ...explorationSteps('http_request', {
      url: `${app.url}.env`,
      method: 'GET',
      why: 'checking for a committed env file',
    }),
    {
      parsed: (request: TransportRequest) => ({
        findings: [
          {
            ruleId: 'SEC-05',
            dimension: 'security_posture',
            severity: 'critical',
            confidence: 'high',
            title: 'The admin dashboard renders for anyone who visits it',
            description:
              'A request to /admin as an unauthenticated visitor returned the full dashboard, including customer email addresses. The page hides itself with JavaScript after it has already been sent.',
            remediation:
              'Enforce authorisation on the server for /admin and every endpoint it calls, returning 401 or 404 before rendering anything.',
            evidenceIds: mintedIds(request).slice(0, 1),
          },
        ],
        notes: [],
        coreFlowsReached: true,
      }),
    },
    // store readiness, then extraction
    ...explorationSteps('navigate', { url: app.url }),
    {
      parsed: (request: TransportRequest) => ({
        findings: [
          {
            ruleId: 'STR-01',
            dimension: 'store_distribution_readiness',
            severity: 'medium',
            confidence: 'high',
            title: 'No privacy policy URL is reachable from the application',
            description:
              'Both stores require a reachable privacy policy URL at submission. Nothing on the site links to one, and /privacy returns 404.',
            remediation:
              'Publish a privacy policy for this application and link it from the footer and the sign-up form.',
            evidenceIds: mintedIds(request).slice(0, 1),
          },
        ],
        notes: [],
        coreFlowsReached: true,
      }),
    },
    // synthesis
    {
      parsed: {
        headline:
          'Kettle works as a shop, but it is currently serving an administrative page and a live payment key to anyone who asks. Fix those two things before anything else.',
        summary:
          'The core purchase flow completes and the interface is clear. Underneath it, authorisation is enforced in the browser rather than on the server, a Stripe key is embedded in the page, and an environment file is readable in the document root. None of these are hard to fix, and all of them are being exploited on applications like this today.',
        strengths: [
          'The sign-up flow completes without friction and returns a clear confirmation.',
        ],
        prioritisedRemediation: [
          {
            order: 1,
            title: 'Rotate the exposed Stripe key',
            why: 'Anyone who has loaded the page can charge cards and issue refunds as you.',
            step: 'Roll the key in the Stripe dashboard, then move the call that needs it to a server route.',
            findingTitles: ['What appears to be a Stripe live secret key is served to the browser'],
          },
        ],
        notAssessed: [
          'The payment flow was not exercised, because that would require a real card.',
        ],
      },
    },
  ]);

  const guard = new ScopeGuard({
    allowedHosts: [app.host.split(':')[0]!],
    exclusions: [],
    ceiling: { ...DEFAULT_CEILING, maxRequestsPerMinute: 600 },
    allowPrivateNetworkForTesting: true,
  });

  const context: StageContext = {
    assessmentId: 'assessment-pipeline',
    depth: 'full',
    guard,
    meter,
    evidence,
    model: new ModelClient(transport, meter),
    log: () => undefined,
    syntheticCredentials: {
      email: 'test-account@example.test',
      password: 'fixture-only-passphrase',
    },
    target: {
      appId: 'app-pipeline',
      organisationId: 'org-pipeline',
      appName: 'Kettle',
      appType: 'web_url',
      primaryUrl: app.url,
      repositoryPath: repoPath,
      intendedForAppStore: true,
      hasAuthentication: true,
      hasPayments: true,
      processesPersonalData: true,
      description: 'A shop that sells kettles.',
    },
  };

  outcome = await runPipeline({ context, assessedOn: '2026-08-22' });
}, 180_000);

afterAll(async () => {
  await app?.close();
  if (repoPath) rmSync(repoPath, { recursive: true, force: true });
});

describe('the run completes', () => {
  it('runs every stage', () => {
    expect(outcome.status).toBe('completed');
    expect(outcome.stageResults.map((result) => result.stage)).toEqual([
      'static_intake',
      'deterministic_checks',
      'functional_exploration',
      'adversarial_practicality',
      'store_readiness',
      'synthesis',
    ]);
    expect(outcome.stageResults.every((result) => result.status !== 'failed')).toBe(true);
  });

  it('records which prompts produced it', () => {
    expect(outcome.promptBundleSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('freezes the scope statement into the outcome', () => {
    expect(outcome.scopeStatement).toContain('Kettle');
    expect(outcome.scopeStatement).toContain('Rubric version 1.0.0');
    expect(outcome.scopeStatement).toContain(
      'Absence of a finding is not evidence of absence of a defect',
    );
    expect(outcome.nonRelianceLegend).toMatch(/No third party/);
    expect(outcome.aiDisclosure).toMatch(/AI output may contain errors/);
  });
});

describe('the static stage', () => {
  it('finds the committed key and the vulnerable dependency', () => {
    const statik = outcome.stageResults.find((result) => result.stage === 'static_intake')!;
    expect(statik.status).toBe('succeeded');
    const titles = statik.findings.map((finding) => finding.title).join(' | ');
    expect(titles).toMatch(/credential/i);
    expect(titles).toMatch(/known advisory/i);
  });

  it('leads remediation with rotation, because deleting a commit is not rotating a key', () => {
    const credential = outcome.findings.find((finding) =>
      /apparent credential/i.test(finding.title),
    );
    expect(credential?.remediation).toMatch(/^Rotate/);
  });
});

describe('evidence enforcement', () => {
  it('publishes only findings backed by evidence we actually captured', () => {
    for (const finding of outcome.findings) {
      expect(finding.evidenceIds.length, finding.title).toBeGreaterThan(0);
    }
  });

  it('drops the unevidenced claim and says that it did', () => {
    expect(
      outcome.findings.some((finding) => /probably loses the basket/i.test(finding.title)),
    ).toBe(false);
    expect(outcome.notes.join(' ')).toMatch(/withheld because they cited no evidence/i);
  });
});

describe('scoring', () => {
  it('caps the score and refuses certification, because a critical security finding stands', () => {
    expect(outcome.score.certificationEligible).toBe(false);
    expect(outcome.score.overallScore).toBeLessThanOrEqual(49);
    expect(outcome.score.gatesApplied.map((gate) => gate.id)).toContain('GATE-CRITICAL-SECURITY');
  });

  it('fires the exposed-credential gate on the key in the client bundle', () => {
    expect(outcome.score.gatesApplied.map((gate) => gate.id)).toContain('GATE-EXPOSED-SECRET');
  });

  it('scores every rubric dimension', () => {
    expect(outcome.score.dimensions).toHaveLength(6);
  });
});

describe('the report', () => {
  it('carries a narrative that names a first action', () => {
    expect(outcome.narrative?.headline).toBeTruthy();
    expect(outcome.narrative?.prioritisedRemediation[0]?.step).toBeTruthy();
  });

  it('says what was not assessed, so silence is not mistaken for a clean result', () => {
    expect(outcome.narrative?.notAssessed.length).toBeGreaterThan(0);
  });

  it('says what the application does well', () => {
    expect(outcome.narrative?.strengths.length).toBeGreaterThan(0);
  });
});

describe('cost', () => {
  it('meters every stage and stays under the ceiling', () => {
    expect(outcome.totalCostUsd).toBeGreaterThan(0);
    expect(outcome.totalCostUsd).toBeLessThan(4);
    expect(Object.keys(outcome.costByStage).length).toBeGreaterThan(3);
  });

  it('attributes model spend to the stage that spent it', () => {
    expect(outcome.costByStage.functional_exploration?.inputTokens).toBeGreaterThan(0);
    expect(outcome.costByStage.deterministic_checks?.computeSeconds).toBeGreaterThan(0);
  });

  it('consumed exactly the scripted model calls, and no more', () => {
    expect(transport.stepsConsumed).toBe(13);
  });
});

describe('evidence rows', () => {
  it('produces rows ready for the database, without the bodies', () => {
    expect(outcome.evidence.length).toBeGreaterThan(5);
    for (const row of outcome.evidence) {
      expect(row).not.toHaveProperty('body');
      expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(new Date(row.retentionUntil).getTime()).toBeGreaterThan(Date.now());
    }
  });

  it('gives screenshots the shortest retention of anything captured', () => {
    const screenshot = outcome.evidence.find((row) => row.kind === 'screenshot');
    const exchange = outcome.evidence.find((row) => row.kind === 'http_exchange');
    expect(screenshot).toBeDefined();
    expect(exchange).toBeDefined();
    expect(new Date(screenshot!.retentionUntil).getTime()).toBeLessThan(
      new Date(exchange!.retentionUntil).getTime(),
    );
  });
});
