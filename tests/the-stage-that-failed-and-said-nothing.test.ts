/**
 * The deterministic stage fails in six places, and only one of them says which
 * criteria went unanswered.
 *
 * The browser pass learned this lesson already. When it dies, it records
 * SEC-12, SEC-13 and PRI-07 as not tested, under a note saying "what is absent
 * from this stage is absent because it was not examined". That was right and it
 * was incomplete: the browser pass answers nine criteria, not three.
 *
 *   · read straight from the loaded page — PRD-02, UX-02, UX-03
 *   · from the trust survey — SEC-12, SEC-13, PRI-07
 *   · from the design survey — UX-04, UX-06, UX-07
 *
 * UX-03 is the automated WCAG 2.2 AA scan. The brief makes accessibility a
 * rubric dimension and holds this product to the same standard, and a page
 * nobody opened in a browser was ticking it.
 *
 * Five other failures recorded nothing at all:
 *
 *   · the initial request, which returns `failed` and no criteria,
 *   · the trust survey's own catch,
 *   · the design survey's own catch, at each of the two widths,
 *   · the game pass, which answers six criteria of its own.
 *
 * A `failed` stage status does not help. The pipeline turns it into a note —
 * "what they did not look at is not evidence that there was nothing to find" —
 * and a note is not on the page a visitor reads. `assuranceFor` works from
 * `notTested` entries and nothing else, so a criterion with no finding and no
 * entry is a tick however the stage ended.
 *
 * The case below is the whole stage failing at its first request, which is the
 * cheapest to reproduce and the most severe: with a repository in scope the
 * static-intake stage still succeeds, so the assessment comes out `completed`
 * rather than `failed`, and nine criteria tick on a target that never answered.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CostMeter,
  DEFAULT_CEILING,
  EvidenceStore,
  ScopeGuard,
  deterministicChecksStage,
  type StageContext,
} from '../packages/engine/src/index.ts';
import {
  BROWSER_PASS_CRITERIA,
  DESIGN_SURVEY_CRITERIA,
  GAME_PASS_CRITERIA,
  TRUST_SURVEY_CRITERIA,
} from '../packages/engine/src/stages/deterministic.ts';

/** A port nothing is listening on, found by opening one and closing it. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

let sandbox: string;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'vibefycode-silent-stage-'));
  writeFileSync(join(sandbox, 'package.json'), JSON.stringify({ name: 'kettle' }));
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function contextFor(url: string, isGame = false): StageContext {
  return {
    assessmentId: 'silent-stage',
    depth: 'full',
    guard: new ScopeGuard({
      allowedHosts: ['127.0.0.1'],
      exclusions: [],
      ceiling: { ...DEFAULT_CEILING, maxRequestsPerMinute: 600 },
      // A loopback fixture in a test. A policy built from a real authorisation
      // record cannot set this; tests/engine-scope.test.ts asserts that.
      allowPrivateNetworkForTesting: true,
    }),
    meter: new CostMeter({ maxRunCostUsd: 1 }),
    evidence: new EvidenceStore('silent-stage'),
    model: null as never,
    log: () => undefined,
    target: {
      appId: 'app-silent',
      organisationId: 'org-silent',
      appName: 'Kettle',
      appType: 'web_url',
      primaryUrl: url,
      repositoryPath: sandbox,
      intendedForAppStore: false,
      isGame,
      hasAuthentication: false,
      hasPayments: false,
      processesPersonalData: false,
      description: 'A shop that sells kettles.',
    },
  };
}

describe('a target that never answered', () => {
  it('still reports the stage as failed, which it always did', async () => {
    const result = await deterministicChecksStage.run(
      contextFor(`http://127.0.0.1:${await closedPort()}/`),
    );
    expect(result.status).toBe('failed');
  });

  it('records every criterion it would have answered as not tested', async () => {
    const result = await deterministicChecksStage.run(
      contextFor(`http://127.0.0.1:${await closedPort()}/`),
    );

    const recorded = (result.notTested ?? []).map((entry) => entry.criterion);
    for (const criterion of [
      ...BROWSER_PASS_CRITERIA,
      ...TRUST_SURVEY_CRITERIA,
      ...DESIGN_SURVEY_CRITERIA,
    ]) {
      expect(recorded).toContain(criterion);
    }
  });

  it('gives a reason that does not read as a pass', async () => {
    const result = await deterministicChecksStage.run(
      contextFor(`http://127.0.0.1:${await closedPort()}/`),
    );

    const reasons = (result.notTested ?? []).map((entry) => entry.because);
    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) expect(reason).toMatch(/did not respond|not observed|not read/i);
  });

  it('records the game criteria too, where the owner said it is a game', async () => {
    const result = await deterministicChecksStage.run(
      contextFor(`http://127.0.0.1:${await closedPort()}/`, true),
    );

    const recorded = (result.notTested ?? []).map((entry) => entry.criterion);
    for (const criterion of GAME_PASS_CRITERIA) expect(recorded).toContain(criterion);
  });

  it('does not record the game criteria where it is not a game', async () => {
    // The direction this fix fails in: marking everything untested on every
    // run, which is the same as marking nothing.
    const result = await deterministicChecksStage.run(
      contextFor(`http://127.0.0.1:${await closedPort()}/`, false),
    );

    const recorded = (result.notTested ?? []).map((entry) => entry.criterion);
    expect(recorded).not.toContain('FI-01');
  });

  it('says it once per criterion, not once per pass', async () => {
    const result = await deterministicChecksStage.run(
      contextFor(`http://127.0.0.1:${await closedPort()}/`),
    );

    const recorded = (result.notTested ?? []).map((entry) => entry.criterion);
    expect(new Set(recorded).size).toBe(recorded.length);
  });
});

/**
 * The lists above have to stay level with the code that produces the findings.
 *
 * Hand-written sets rot: a criterion added to design-checks.ts next month is a
 * criterion that ticks when the design survey dies, and nothing would say so.
 * Both sides of this comparison are read from source, so the drift is what goes
 * red rather than the consequence.
 */
describe('the criteria each pass claims to answer', () => {
  const ruleIdsIn = async (path: string): Promise<string[]> => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(join(import.meta.dirname, '..', path), 'utf8')
      // Comments quote rule ids while explaining them, and this file is one of
      // the reasons they do. Strip them before reading the code.
      .replace(/(^|\s)\/\/.*$/gm, '$1')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    return [
      ...new Set(
        [...source.matchAll(/ruleId: '([A-Z]+-\d+)'/g)].map((match) => match[1] as string),
      ),
    ].sort();
  };

  it('covers everything the trust survey can find', async () => {
    const produced = await ruleIdsIn('packages/engine/src/stages/trust-checks.ts');
    expect(produced.length).toBeGreaterThan(0);
    for (const ruleId of produced) expect(TRUST_SURVEY_CRITERIA).toContain(ruleId);
  });

  it('covers everything the design survey can find', async () => {
    const produced = await ruleIdsIn('packages/engine/src/stages/design-checks.ts');
    expect(produced.length).toBeGreaterThan(0);
    for (const ruleId of produced) expect(DESIGN_SURVEY_CRITERIA).toContain(ruleId);
  });

  it('covers everything the game pass can find', async () => {
    const produced = await ruleIdsIn('packages/engine/src/stages/game-checks.ts');
    expect(produced.length).toBeGreaterThan(0);
    for (const ruleId of produced) expect(GAME_PASS_CRITERIA).toContain(ruleId);
  });

  it('covers what the browser pass reads from the page itself', async () => {
    // UX-03 is the automated WCAG 2.2 AA scan, and it is the reason this one
    // matters: the brief holds this product to that standard and a page nobody
    // opened was ticking it.
    expect(BROWSER_PASS_CRITERIA).toContain('UX-03');
    expect(BROWSER_PASS_CRITERIA).toContain('UX-02');
    expect(BROWSER_PASS_CRITERIA).toContain('PRD-02');
  });
});
