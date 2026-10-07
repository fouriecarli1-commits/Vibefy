/**
 * An advisory in the data file that the code reading it cannot parse.
 *
 * `below` and `permitsVulnerable` both start with the same regular expression:
 *
 *     /^<\s*(\d+)\.(\d+)\.(\d+)/
 *
 * and both `return false` when it does not match. That is the right behaviour
 * for a version string we cannot read — guessing would produce a finding nobody
 * can act on. But it is also the behaviour for an *advisory* we cannot read, and
 * there the consequence is the opposite of safe: the advisory is skipped, no
 * finding is produced, and SEC-10 renders as a tick.
 *
 * Nothing in the pipeline would notice. The advisory would sit in
 * `advisories.json`, be counted in the artefact's `source` line, and never fire
 * on any repository. Adding one in the shape OSV actually publishes —
 * `>=1.0.0 <1.2.6`, or `<=1.2.5`, or `1.2.x` — is enough to do it, and the
 * curated set is meant to grow.
 *
 * Measured on 2026-10-07: all ten entries are in the supported shape. This test
 * exists so that the eleventh cannot quietly not be.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import advisoryData from '../packages/engine/src/data/advisories.json' with { type: 'json' };
import {
  staticIntakeStage,
  CostMeter,
  EvidenceStore,
  ScopeGuard,
  DEFAULT_CEILING,
} from '../packages/engine/src/index.ts';
import type { StageContext } from '../packages/engine/src/stages/types.ts';

let advisorySandbox: string;

beforeAll(() => {
  advisorySandbox = mkdtempSync(join(tmpdir(), 'vibefycode-advisory-'));
});

afterAll(() => {
  rmSync(advisorySandbox, { recursive: true, force: true });
});

function advisoryContextFor(repositoryPath: string): StageContext {
  return {
    assessmentId: 'advisory',
    depth: 'full' as const,
    guard: new ScopeGuard({
      allowedHosts: ['example.test'],
      exclusions: [],
      ceiling: DEFAULT_CEILING,
    }),
    meter: new CostMeter({ maxRunCostUsd: 1 }),
    evidence: new EvidenceStore('advisory'),
    model: null as never,
    log: () => undefined,
    target: {
      appId: 'app-advisory',
      organisationId: 'org-advisory',
      appName: 'Kettle',
      appType: 'web_url' as const,
      primaryUrl: 'https://example.test',
      repositoryPath,
      intendedForAppStore: false,
      isGame: false,
      hasAuthentication: false,
      hasPayments: false,
      processesPersonalData: false,
      description: 'A shop that sells kettles.',
    },
  };
}

/** The one range shape `below` and `permitsVulnerable` can read. */
const SUPPORTED = /^<\s*\d+\.\d+\.\d+$/;

const advisories = advisoryData.advisories as {
  package: string;
  vulnerable: string;
  severity: string;
  id: string;
  summary: string;
}[];

describe('the curated advisory set', () => {
  it('is not empty, so this file is testing something', () => {
    expect(advisories.length).toBeGreaterThan(0);
  });

  it('declares every range in the one shape the matcher can read', () => {
    const unreadable = advisories
      .filter((advisory) => !SUPPORTED.test(advisory.vulnerable))
      .map((advisory) => `${advisory.id} (${advisory.package}: ${advisory.vulnerable})`);

    // Any entry listed here is in the file, is counted, and can never fire.
    // Either rewrite it as `<x.y.z`, or teach `below` and `permitsVulnerable`
    // the shape — but it must not stay as it is.
    expect(unreadable).toEqual([]);
  });

  it('gives every advisory the fields the finding quotes', () => {
    // A missing `summary` or `id` does not throw; it renders as "undefined" in
    // the customer's report, which is the same defect one layer out.
    for (const advisory of advisories) {
      expect(typeof advisory.package).toBe('string');
      expect(advisory.package.length).toBeGreaterThan(0);
      expect(typeof advisory.id).toBe('string');
      expect(advisory.id.length).toBeGreaterThan(0);
      expect(typeof advisory.summary).toBe('string');
      expect(advisory.summary.length).toBeGreaterThan(0);
    }
  });

  it('rates every advisory at a severity the finding knows how to use', () => {
    // Measured on 2026-10-07: express is rated `medium` here and was reported
    // to the customer as `high`, because the finding computed its severity as
    // "critical if any entry is critical, otherwise high". Nine of ten entries
    // were high, so the tenth was wrong and nothing said so.
    const scale = ['info', 'low', 'medium', 'high', 'critical'];
    for (const advisory of advisories) {
      expect(scale).toContain(advisory.severity);
    }
  });
});

describe('what the shape rule is for', () => {
  const matcher = (range: string) => SUPPORTED.test(range);

  it('rejects the shapes OSV publishes that this matcher cannot read', () => {
    // Watched failing: each of these, added to the data file, would produce an
    // advisory that is never matched against anything.
    expect(matcher('>=1.0.0 <1.2.6')).toBe(false);
    expect(matcher('<=1.2.5')).toBe(false);
    expect(matcher('1.2.x')).toBe(false);
    expect(matcher('^1.0.0')).toBe(false);
    expect(matcher('')).toBe(false);
  });

  it('accepts the shape it can', () => {
    expect(matcher('<1.2.6')).toBe(true);
    expect(matcher('< 4.17.21')).toBe(true);
  });
});

/**
 * The severity the data file gives an advisory is the severity the customer is
 * shown.
 *
 * `worst` used to read: critical where any matched entry is critical, and
 * `high` otherwise. With nine of ten curated entries rated high that was almost
 * always right, and for the tenth — express, rated `medium` — it silently
 * inflated the finding by one step. An inflated severity costs the customer
 * real points in `security_posture`, and it is the same class of defect as a
 * suppressed one: the report says something the evidence does not.
 */
describe('the severity a matched advisory is reported at', () => {
  it('is the advisory’s own, not a default', async () => {
    const root = join(advisorySandbox, 'medium');
    mkdirSync(root, { recursive: true });
    // express <4.19.2 is GHSA-rv95-896h-c2vc, rated `medium` in the data file.
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'kettle', dependencies: { express: '4.18.0' } }),
    );

    const result = await staticIntakeStage.run(advisoryContextFor(root));
    const sec10 = result.findings.filter((finding) => finding.ruleId === 'SEC-10');
    expect(sec10).toHaveLength(1);
    expect(sec10[0]!.severity).toBe('medium');
  });

  it('is the worst of them where several match', async () => {
    const root = join(advisorySandbox, 'worst');
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'kettle',
        dependencies: { express: '4.18.0', minimist: '1.2.0' },
      }),
    );

    const result = await staticIntakeStage.run(advisoryContextFor(root));
    const sec10 = result.findings.filter((finding) => finding.ruleId === 'SEC-10');
    expect(sec10[0]!.severity).toBe('critical');
  });

  it('still reports a high advisory as high, so the fix changed one thing', async () => {
    const root = join(advisorySandbox, 'high');
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'kettle', dependencies: { lodash: '4.17.0' } }),
    );

    const result = await staticIntakeStage.run(advisoryContextFor(root));
    const sec10 = result.findings.filter((finding) => finding.ruleId === 'SEC-10');
    expect(sec10[0]!.severity).toBe('high');
  });
});
