/**
 * SEC-10 was the last criterion that could tick without being looked at.
 *
 * The engine already refuses to let an absent check read as a pass. When no
 * test account exists, the four criteria behind a sign-in are recorded as not
 * tested; when the browser pass dies, SEC-12, SEC-13 and PRI-07 are; when no
 * checkout is found, SEC-12 is. `assuranceFor` turns each of those into "not
 * tested" on the visitor's list rather than a tick.
 *
 * `static_intake` produced none of them, and it is the only stage that answers
 * SEC-10 — the dependency check. It has four ways not to run:
 *
 *   · no repository was in scope at all,
 *   · the declared repository could not be read,
 *   · no readable file was found under it,
 *   · `package.json` is missing or will not parse.
 *
 * Every one of them pushes a carefully worded note — "their absence here is not
 * a clean result" — into a `notes` array the visitor never sees, and returns no
 * findings. No findings renders as a tick.
 *
 * **The first case is not an edge.** The free tier is URL-only by decision 007,
 * so there is no repository on most assessments this product will ever run. And
 * SEC-10 sits in `hostile_code` beside SEC-13, which *does* run, in the browser
 * — so `unknown` is empty under rubric 1.1.0, which defines both, and nothing
 * stood between a free URL-only assessment and a tick on
 *
 *     Is it running anything it should not be?
 *
 * under a sentence reading "We also checked the application's declared
 * dependencies for advisories rated critical." We had not. There was nothing to
 * check and nobody said so.
 *
 * Rubric 1.0.0 hid it: it defines SEC-10 but not SEC-13, so `unknown` caught the
 * whole claim and the line read "not tested" for the other half's absence. The
 * protection was accidental and 1.1.0 removed it.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  staticIntakeStage,
  CostMeter,
  EvidenceStore,
  ScopeGuard,
  DEFAULT_CEILING,
} from '../packages/engine/src/index.ts';
import type { StageContext } from '../packages/engine/src/stages/types.ts';
import { assuranceFor, type AssuranceInput } from '../packages/assurance/src/index.ts';
import { getRubric } from '../packages/rubric/src/rubric.ts';

let sandbox: string;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'vibefycode-sec10-'));
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function contextFor(repositoryPath: string | null, repositoryUnavailable?: string): StageContext {
  return {
    assessmentId: 'sec10',
    depth: 'full' as const,
    guard: new ScopeGuard({
      allowedHosts: ['example.test'],
      exclusions: [],
      ceiling: DEFAULT_CEILING,
    }),
    meter: new CostMeter({ maxRunCostUsd: 1 }),
    evidence: new EvidenceStore('sec10'),
    model: null as never,
    log: () => undefined,
    target: {
      appId: 'app-sec10',
      organisationId: 'org-sec10',
      appName: 'Kettle',
      appType: 'web_url' as const,
      primaryUrl: 'https://example.test',
      // `string | null` and not optional: omitting it is a different type error
      // from declaring there is none, and the stage reads the null.
      repositoryPath,
      ...(repositoryUnavailable === undefined ? {} : { repositoryUnavailable }),
      intendedForAppStore: false,
      isGame: false,
      hasAuthentication: false,
      hasPayments: false,
      processesPersonalData: false,
      description: 'A shop that sells kettles.',
    },
  };
}

const sec10In = (result: { notTested?: readonly { criterion: string }[] }) =>
  (result.notTested ?? []).filter((entry) => entry.criterion === 'SEC-10');

describe('the dependency check that did not run', () => {
  it('says so when no repository was in scope — the free tier, on every run', async () => {
    const result = await staticIntakeStage.run(contextFor(null));
    expect(result.status).toBe('skipped');
    expect(sec10In(result)).toHaveLength(1);
    expect(sec10In(result)[0]!.criterion).toBe('SEC-10');
  });

  it('says so when the declared repository could not be read', async () => {
    const result = await staticIntakeStage.run(contextFor(null, 'clone timed out'));
    expect(result.status).toBe('failed');
    expect(sec10In(result)).toHaveLength(1);
  });

  it('says so when there is a repository but no package.json', async () => {
    const root = join(sandbox, 'no-manifest');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'index.html'), '<!doctype html><title>Kettle</title>');

    const result = await staticIntakeStage.run(contextFor(root));
    expect(sec10In(result)).toHaveLength(1);
  });

  it('says so when package.json will not parse', async () => {
    const root = join(sandbox, 'bad-manifest');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'index.html'), '<!doctype html><title>Kettle</title>');
    writeFileSync(join(root, 'package.json'), '{ this is not json');

    const result = await staticIntakeStage.run(contextFor(root));
    expect(sec10In(result)).toHaveLength(1);
  });

  it('stays quiet when it did run, so a real pass is still a pass', async () => {
    // The direction a guard fails in silence: marking everything untested, and
    // being noticed only when no application can ever earn a tick.
    const root = join(sandbox, 'good-manifest');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'index.html'), '<!doctype html><title>Kettle</title>');
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'kettle', dependencies: { nothing: '1.0.0' } }),
    );

    const result = await staticIntakeStage.run(contextFor(root));
    expect(sec10In(result)).toHaveLength(0);
  });
});

describe('what the visitor is shown', () => {
  const criteria = getRubric('1.1.0').dimensions.flatMap((dimension) =>
    dimension.criteria.map((criterion) => criterion.id),
  );

  const base: AssuranceInput = {
    appName: 'Kettle',
    assessedOn: '2026-09-24',
    rubricVersion: '1.1.0',
    depth: 'limited',
    gateFailures: [],
    findings: [],
    rubricCriteria: criteria,
    declared: { authentication: false, payments: false, personalData: false },
  };

  it('is a tick when nothing records that SEC-10 went unchecked', () => {
    // The state the product was in. Kept as a test rather than deleted, because
    // it is the thing the fix exists to prevent and it should be visible.
    const line = assuranceFor(base).find((entry) => entry.claim.id === 'hostile_code')!;
    expect(line.state).toBe('checked_clear');
  });

  it('is not a tick once it does', () => {
    const line = assuranceFor({
      ...base,
      notTested: [{ criterion: 'SEC-10', because: 'No repository was in scope.' }],
    }).find((entry) => entry.claim.id === 'hostile_code')!;

    expect(line.state).toBe('not_tested');
    expect(line.notTestedBecause).toMatch(/not a pass/i);
  });

  it('holds for rubric 1.1.0 specifically, which is where the accident stopped', () => {
    // 1.0.0 defines SEC-10 and not SEC-13, so `unknown` caught the claim for the
    // other half's absence. That protection was luck, and 1.1.0 removed it by
    // adding SEC-13.
    expect(criteria).toContain('SEC-10');
    expect(criteria).toContain('SEC-13');
  });
});
