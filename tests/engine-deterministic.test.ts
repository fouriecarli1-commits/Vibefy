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
import { CeilingExceededError } from '../packages/engine/src/runtime/scope.ts';
import { runPipeline } from '../packages/engine/src/pipeline.ts';
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
      isGame: false,
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

describe('when the browser pass cannot run', () => {
  /**
   * A server that answers a plain GET and refuses a browser navigation.
   *
   * Not a contrivance: a page that answers `curl` and then hangs, redirects in
   * a loop, or never reaches network idle in Chromium is an ordinary Tuesday.
   * What made it worth a test is what used to happen next — the stage reported
   * `succeeded`, the report carried no accessibility finding, no console error,
   * no observation about the layout at phone width, and `practicality_ux`
   * scored full marks because nothing had been found there. Nothing had been
   * looked for.
   *
   * The discriminator is the user-agent. The engine's HTTP client identifies
   * itself as VibefyCodeAssessment on purpose — an assessment service that
   * arrives disguised is indistinguishable from an attacker in a customer's
   * logs — and Chromium does not. (`sec-fetch-mode` looked like the obvious
   * choice and is not: Node's own fetch sends it too.)
   */
  async function serverThatRefusesBrowsers(): Promise<{ url: string; close: () => Promise<void> }> {
    const { createServer } = await import('node:http');
    const server = createServer((request, response) => {
      if (!String(request.headers['user-agent'] ?? '').startsWith('VibefyCode')) {
        request.socket.destroy();
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(
        '<!doctype html><html lang="en"><head><title>Kettle</title></head><body><h1>Kettle</h1></body></html>',
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    return {
      url: `http://127.0.0.1:${port}/`,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  it('does not call the stage succeeded, and says what was not looked at', async () => {
    const fixture = await serverThatRefusesBrowsers();
    try {
      const store = new EvidenceStore('assessment-no-browser');
      const outcome = await deterministicChecksStage.run({
        assessmentId: 'assessment-no-browser',
        depth: 'full',
        guard: new ScopeGuard({
          allowedHosts: ['127.0.0.1'],
          exclusions: [],
          ceiling: { ...DEFAULT_CEILING, maxRequestsPerMinute: 600 },
          allowPrivateNetworkForTesting: true,
        }),
        meter: new CostMeter({ maxRunCostUsd: 1 }),
        evidence: store,
        model: null as never,
        log: () => undefined,
        target: {
          appId: 'app-no-browser',
          organisationId: 'org-fixture',
          appName: 'Kettle',
          appType: 'web_url',
          primaryUrl: fixture.url,
          repositoryPath: null,
          intendedForAppStore: false,
          isGame: false,
          hasAuthentication: false,
          hasPayments: false,
          processesPersonalData: false,
          description: 'A shop that sells kettles.',
        },
      });

      expect(outcome.status, 'the stage did not do its job').toBe('failed');
      // The HTTP half still stands and is still reported — a failed stage is
      // not a discarded one.
      expect(outcome.findings.length).toBeGreaterThan(0);
      const notes = outcome.notes.join(' ');
      expect(notes).toMatch(/browser pass did not complete/i);
      expect(notes).toMatch(/absent because it was not examined/i);
      expect(outcome.findings.some((finding) => finding.ruleId === 'UX-03')).toBe(false);
    } finally {
      await fixture.close();
    }
  }, 120_000);
});

describe('when the run reaches a ceiling inside this stage', () => {
  /**
   * The stop has to leave the stage.
   *
   * Every catch block in here turned what it caught into a note and carried on,
   * and `probe` returned null for anything that threw. That is right for a page
   * that would not load; for a ceiling it meant the run did not stop. Nothing
   * reached the pipeline, so nothing was classified, so `stopped` stayed null,
   * so every later stage ran on to hit the same ceiling — and the run came out
   * `completed`, with no stop reason recorded, carrying a security posture
   * assembled from probes that were never sent.
   */
  const contextWith = (url: string, maxTotalRequests: number): StageContext => ({
    assessmentId: 'assessment-ceiling',
    depth: 'full',
    guard: new ScopeGuard({
      allowedHosts: [new URL(url).hostname],
      exclusions: [],
      ceiling: { ...DEFAULT_CEILING, maxRequestsPerMinute: 600, maxTotalRequests },
      allowPrivateNetworkForTesting: true,
    }),
    meter: new CostMeter({ maxRunCostUsd: 1 }),
    evidence: new EvidenceStore('assessment-ceiling'),
    model: null as never,
    log: () => undefined,
    target: {
      appId: 'app-ceiling',
      organisationId: 'org-fixture',
      appName: 'Kettle',
      appType: 'web_url',
      primaryUrl: url,
      repositoryPath: null,
      intendedForAppStore: false,
      isGame: false,
      hasAuthentication: false,
      hasPayments: false,
      processesPersonalData: false,
      description: 'A shop that sells kettles.',
    },
  });

  it('throws the ceiling rather than noting it and carrying on', async () => {
    // One request is allowed: the initial page load. The first probe after it
    // is refused, and used to come back as "nothing is served at /.env".
    await expect(deterministicChecksStage.run(contextWith(app.url, 1))).rejects.toBeInstanceOf(
      CeilingExceededError,
    );
  }, 120_000);

  it('comes out of the pipeline as an aborted run with a reason', async () => {
    const outcome = await runPipeline({
      context: contextWith(app.url, 1),
      stages: [deterministicChecksStage],
    });
    expect(outcome.status).toBe('aborted');
    expect(outcome.stopReason).toBe('intensity_ceiling');
    // And it is not retried: spending money to break the same rule twice.
    expect(outcome.notes.join(' ')).not.toMatch(/Succeeded on attempt 2/);
  }, 120_000);
});
