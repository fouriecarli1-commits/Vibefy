/**
 * The evidence the rubric says a finding must carry, against what it carries.
 *
 * Each criterion in the published rubric names the evidence kinds a finding
 * against it is made of — SEC-02 says `header_scan`, FI-07 says
 * `playwright_trace`. Nothing compared a finding's artefacts against that list,
 * and the answer, when somebody finally looked, was that ten of the forty-nine
 * criteria required a kind this engine had never produced once: it had no
 * header scan, no Playwright trace and no Lighthouse report. Those criteria
 * could be found against and could not be evidenced the way the published
 * rubric says they are.
 *
 * Two guards here. The first says the engine can produce what the rubric asks
 * for, criterion by criterion, and names the one place it still cannot. The
 * second runs the real stage against the real fixture and checks every finding
 * it makes.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  CostMeter,
  DEFAULT_CEILING,
  EvidenceStore,
  ScopeGuard,
  deterministicChecksStage,
  type StageContext,
  type StageResult,
} from '../packages/engine/src/index.ts';
import { CURRENT_RUBRIC_VERSION, getRubric } from '../packages/rubric/src/index.ts';
import { startVulnerableApp, type FixtureApp } from './fixtures/vulnerable-app.ts';

/**
 * The kinds this engine actually captures. Grown by making the engine produce
 * one, never by adding a name here — the list is checked against the source.
 */
const PRODUCED = [
  'screenshot',
  'http_exchange',
  'console_log',
  'dependency_report',
  'accessibility_scan',
  'header_scan',
  'playwright_trace',
] as const;

/**
 * Criteria whose evidence this engine still cannot produce.
 *
 * One, and it is here so that it is counted rather than discovered: PRD-01 is
 * the Lighthouse performance band, and running Lighthouse is a dependency
 * decision rather than an oversight. A finding against it would cite something
 * other than what the rubric names, so until it can be produced the criterion
 * belongs on this list where a test can see it.
 */
const CANNOT_YET_PRODUCE = ['PRD-01'];

let app: FixtureApp;
let result: StageResult;
let evidence: EvidenceStore;

beforeAll(async () => {
  app = await startVulnerableApp();
  evidence = new EvidenceStore('assessment-kinds');
  const context: StageContext = {
    assessmentId: 'assessment-kinds',
    depth: 'full',
    guard: new ScopeGuard({
      allowedHosts: [app.host.split(':')[0]!],
      exclusions: [],
      ceiling: { ...DEFAULT_CEILING, maxRequestsPerMinute: 600 },
      allowPrivateNetworkForTesting: true,
    }),
    meter: new CostMeter({ maxRunCostUsd: 1 }),
    evidence,
    model: null as never,
    log: () => undefined,
    target: {
      appId: 'app-kinds',
      organisationId: 'org-kinds',
      appName: 'Kettle',
      appType: 'web_url',
      primaryUrl: app.url,
      repositoryPath: null,
      intendedForAppStore: true,
      isGame: false,
      hasAuthentication: true,
      hasPayments: true,
      processesPersonalData: true,
      description: 'A shop that sells kettles.',
    },
  };
  result = await deterministicChecksStage.run(context);
}, 180_000);

afterAll(async () => {
  await app?.close();
});

describe('what the rubric asks for', () => {
  const criteria = getRubric(CURRENT_RUBRIC_VERSION).dimensions.flatMap(
    (dimension) => dimension.criteria,
  );

  it('is a kind this engine can produce, for every criterion but the ones we have counted', () => {
    const unsatisfiable = criteria
      .filter(
        (criterion) => !criterion.requiredEvidence.some((kind) => PRODUCED.includes(kind as never)),
      )
      .map((criterion) => criterion.id);
    expect(unsatisfiable.sort()).toEqual([...CANNOT_YET_PRODUCE].sort());
  });

  it('names kinds the engine really captures rather than kinds we listed here', async () => {
    // The list above is only worth something if it describes the code. Each of
    // these has to appear as a capture in the engine's own source.
    const { readFileSync } = await import('node:fs');
    const sources = [
      'packages/engine/src/stages/deterministic.ts',
      'packages/engine/src/stages/static-intake.ts',
      'packages/engine/src/runtime/http.ts',
      'packages/engine/src/runtime/browser.ts',
    ]
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    for (const kind of PRODUCED) {
      expect(sources, kind).toContain(`kind: '${kind}'`);
    }
  });
});

describe('what the stage actually attaches', () => {
  it('cites a kind the criterion names, for every finding it made', () => {
    const required = new Map(
      getRubric(CURRENT_RUBRIC_VERSION).dimensions.flatMap((dimension) =>
        dimension.criteria.map((criterion) => [criterion.id, criterion.requiredEvidence] as const),
      ),
    );
    expect(result.findings.length).toBeGreaterThan(5);

    const wrong: string[] = [];
    for (const finding of result.findings) {
      const want = required.get(finding.ruleId);
      expect(want, `${finding.ruleId} is not a criterion this rubric defines`).toBeDefined();
      const have = finding.evidenceIds.map((id) => evidence.byId(id)?.kind ?? 'MISSING');
      if (!have.some((kind) => want!.includes(kind))) {
        wrong.push(`${finding.ruleId} wants [${want!.join(', ')}] and cites [${have.join(', ')}]`);
      }
    }
    expect(wrong, 'findings evidenced by a kind the criterion does not name').toEqual([]);
  });

  it('records the browser pass as a trace, which nothing used to produce', () => {
    const kinds = new Set(evidence.all.map((artefact) => artefact.kind));
    expect(kinds).toContain('playwright_trace');
    expect(kinds).toContain('header_scan');
  });
});
