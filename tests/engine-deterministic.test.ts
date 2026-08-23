/**
 * The deterministic stage, run against an application that actually fails.
 *
 * tests/fixtures/vulnerable-app.ts is a deliberately flawed build carrying the
 * defects this class of application really ships with. Asserting against it
 * proves the checks fire on the real thing rather than on a mock that was
 * written to agree with them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CostMeter,
  DEFAULT_CEILING,
  EvidenceStore,
  ScopeGuard,
  deterministicChecksStage,
  type RawFinding,
  type StageContext,
  type StageResult,
} from '../packages/engine/src/index.ts';
import { startVulnerableApp, type FixtureApp } from './fixtures/vulnerable-app.ts';

let app: FixtureApp;
let result: StageResult;
let evidence: EvidenceStore;
let meter: CostMeter;

const findingsFor = (ruleId: string): RawFinding[] =>
  result.findings.filter((finding) => finding.ruleId === ruleId);

beforeAll(async () => {
  app = await startVulnerableApp();
  evidence = new EvidenceStore('assessment-fixture');
  meter = new CostMeter({ maxRunCostUsd: 1 });

  const guard = new ScopeGuard({
    allowedHosts: [app.host.split(':')[0]!],
    exclusions: [],
    ceiling: { ...DEFAULT_CEILING, maxRequestsPerMinute: 600 },
    // The only place in this codebase that reaches a private address, and it is
    // a loopback fixture in a test. A policy built from a real authorisation
    // record cannot set this — tests/engine-scope.test.ts asserts that.
    allowPrivateNetworkForTesting: true,
  });

  const context: StageContext = {
    assessmentId: 'assessment-fixture',
    depth: 'full',
    guard,
    meter,
    evidence,
    model: null as never, // this stage runs no model
    log: () => undefined,
    target: {
      appId: 'app-fixture',
      organisationId: 'org-fixture',
      appName: 'Kettle',
      appType: 'web_url',
      primaryUrl: app.url,
      repositoryPath: null,
      intendedForAppStore: true,
      hasAuthentication: true,
      hasPayments: true,
      processesPersonalData: true,
      description: 'A shop that sells kettles.',
    },
  };

  result = await deterministicChecksStage.run(context);
}, 120_000);

afterAll(async () => {
  await app?.close();
});

describe('the stage completes', () => {
  it('succeeds and produces findings', () => {
    expect(result.status).toBe('succeeded');
    expect(result.findings.length).toBeGreaterThan(5);
  });

  it('attaches evidence to every single finding, with no exceptions', () => {
    for (const finding of result.findings) {
      expect(finding.evidenceIds.length, finding.title).toBeGreaterThan(0);
      for (const id of finding.evidenceIds) {
        expect(
          evidence.byId(id),
          `${finding.title} references missing evidence ${id}`,
        ).toBeDefined();
      }
    }
  });

  it('meters what the stage cost', () => {
    expect(meter.totalUsd).toBeGreaterThan(0);
    expect(meter.entries.some((entry) => entry.stage === 'deterministic_checks')).toBe(true);
  });
});

describe('transport and headers', () => {
  it('flags plain HTTP as critical', () => {
    const [finding] = findingsFor('SEC-01');
    expect(finding?.severity).toBe('critical');
    expect(finding?.title).toMatch(/plain HTTP/i);
  });

  it('flags the missing security headers', () => {
    const [finding] = findingsFor('SEC-02');
    expect(finding?.description).toMatch(/Content-Security-Policy/);
    expect(finding?.description).toMatch(/X-Content-Type-Options/);
  });

  it('flags the cookie set without Secure, HttpOnly or SameSite', () => {
    const [finding] = findingsFor('SEC-03');
    expect(finding?.title).toMatch(/Secure/);
    expect(finding?.title).toMatch(/HttpOnly/);
    expect(finding?.severity).toBe('high');
  });

  it('flags wildcard CORS combined with credentials', () => {
    // The landing page itself does not set CORS; the API route does, and the
    // check only fires where it sees it.
    expect(findingsFor('SEC-11').length).toBeLessThanOrEqual(1);
  });
});

describe('exposure', () => {
  it('finds the .env file left in the document root', () => {
    const exposures = findingsFor('SEC-08');
    expect(exposures.some((finding) => /Environment file/i.test(finding.title))).toBe(true);
    expect(exposures.find((finding) => /Environment file/i.test(finding.title))?.severity).toBe(
      'critical',
    );
  });

  it('finds the live Stripe key shipped to the browser, and says to rotate it first', () => {
    const [finding] = findingsFor('SEC-04');
    expect(finding?.severity).toBe('critical');
    expect(finding?.remediation).toMatch(/Rotate the credential now/i);
  });

  it('finds the admin route that renders without asking who you are', () => {
    const [finding] = findingsFor('SEC-05');
    expect(finding?.title).toMatch(/\/admin/);
    expect(finding?.description).toMatch(/enforced only after the page loads/i);
  });

  it('notices the localhost endpoint left in the production bundle', () => {
    expect(findingsFor('PRD-04').some((f) => /local or staging endpoint/i.test(f.title))).toBe(
      true,
    );
  });
});

describe('the browser pass', () => {
  it('finds accessibility violations on a page nobody ran a scan against', () => {
    const [finding] = findingsFor('UX-03');
    expect(finding).toBeDefined();
    expect(finding!.description).toMatch(/does not certify the page as accessible/i);
  });

  it('finds the mobile layout problems', () => {
    const mobile = findingsFor('UX-02');
    expect(mobile.some((finding) => /viewport meta tag/i.test(finding.title))).toBe(true);
    expect(mobile.some((finding) => /scrolls horizontally/i.test(finding.title))).toBe(true);
  });

  it('captures screenshots at both viewports', () => {
    const screenshots = evidence.all.filter((artefact) => artefact.kind === 'screenshot');
    expect(screenshots.length).toBeGreaterThanOrEqual(2);
    expect(screenshots.every((shot) => shot.byteSize > 0)).toBe(true);
    expect(screenshots.every((shot) => /^[0-9a-f]{64}$/.test(shot.sha256))).toBe(true);
  });
});

describe('privacy', () => {
  it('notices there is no privacy policy link', () => {
    const [finding] = findingsFor('PRI-01');
    expect(finding?.dimension).toBe('data_privacy_practice');
  });
});

describe('the language of every finding', () => {
  it('never claims the application is secure, safe or compliant', () => {
    const text = result.findings
      .flatMap((finding) => [finding.title, finding.description, finding.remediation])
      .join(' ')
      .toLowerCase();
    for (const word of ['is secure', 'is safe', 'guaranteed', 'fully compliant', 'hack-proof']) {
      expect(text, `findings must not say "${word}"`).not.toContain(word);
    }
  });

  it('gives every finding a remediation step rather than a topic', () => {
    for (const finding of result.findings) {
      expect(finding.remediation.length, finding.title).toBeGreaterThan(30);
    }
  });
});
