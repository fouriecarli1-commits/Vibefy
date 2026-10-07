/**
 * The dependency check read one manifest and reported on the repository.
 *
 * `checkDependencies` opened `<root>/package.json` and nothing else. A single-
 * package repository is the case it was written for, and for that case it was
 * right. But the shape this product is pointed at is not that: a vibe-coded
 * application is very often a workspace — `apps/web`, `packages/ui` — where the
 * root manifest holds the toolchain and the dependencies that actually ship are
 * declared one directory down.
 *
 * Measured on our own repository on 2026-10-07: 13 of 57 declared dependencies
 * are in the root manifest. The other 44 were never read.
 *
 * What makes it a silent failure rather than a narrow check is the sentence it
 * produces. With nothing matched, `checkDependencies` returns no findings and
 * pushes no `notTested`, so SEC-10 renders as a tick — under a claim that reads
 * "we checked the application's declared dependencies for advisories rated
 * critical". For a workspace, that tick was earned by reading a list that did
 * not contain the dependencies.
 *
 * This is the same defect as the one in `the-dependency-check-that-never-ran`,
 * one layer in: there the check did not run, here it ran over the wrong list.
 * A clean result from an empty list looks exactly like a clean result.
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

let sandbox: string;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'vibefycode-workspace-'));
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function contextFor(repositoryPath: string): StageContext {
  return {
    assessmentId: 'workspace',
    depth: 'full' as const,
    guard: new ScopeGuard({
      allowedHosts: ['example.test'],
      exclusions: [],
      ceiling: DEFAULT_CEILING,
    }),
    meter: new CostMeter({ maxRunCostUsd: 1 }),
    evidence: new EvidenceStore('workspace'),
    model: null as never,
    log: () => undefined,
    target: {
      appId: 'app-workspace',
      organisationId: 'org-workspace',
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

/** A workspace whose shipped dependency is declared one directory down. */
function workspaceRepository(name: string): string {
  const root = join(sandbox, name);
  mkdirSync(join(root, 'apps', 'web'), { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'kettle', private: true, workspaces: ['apps/*'] }),
  );
  writeFileSync(
    join(root, 'apps', 'web', 'package.json'),
    // Pinned and squarely inside GHSA-xvch-5gv4-984h (<1.2.6), so there is
    // nothing to argue about: this is a critical advisory on an exact version.
    JSON.stringify({ name: 'web', dependencies: { minimist: '1.2.0' } }),
  );
  return root;
}

const sec10Findings = (result: { findings: readonly { ruleId: string; description: string }[] }) =>
  result.findings.filter((finding) => finding.ruleId === 'SEC-10');

describe('a dependency declared in a workspace manifest', () => {
  it('is found, rather than producing a tick off an empty list', async () => {
    const result = await staticIntakeStage.run(contextFor(workspaceRepository('found')));

    expect(sec10Findings(result)).toHaveLength(1);
    expect(sec10Findings(result)[0]!.description).toContain('minimist');
  });

  it('names the manifest it was declared in, so the customer can go and fix it', async () => {
    const result = await staticIntakeStage.run(contextFor(workspaceRepository('named')));

    expect(sec10Findings(result)[0]!.description).toContain('apps/web/package.json');
  });

  it('counts the manifests it read, so a clean result says how wide it was', async () => {
    const result = await staticIntakeStage.run(contextFor(workspaceRepository('counted')));

    expect(result.notes.join(' ')).toMatch(/2 manifest/);
  });
});

describe('what has to keep holding', () => {
  it('a single-package repository still reports its own dependency', async () => {
    const root = join(sandbox, 'single');
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'kettle', dependencies: { minimist: '1.2.0' } }),
    );

    const result = await staticIntakeStage.run(contextFor(root));
    expect(sec10Findings(result)).toHaveLength(1);
  });

  it('a repository with no vulnerable dependency anywhere stays quiet', async () => {
    // The direction this fix could fail in: finding something in every
    // repository, which is the same as finding nothing.
    const root = join(sandbox, 'clean');
    mkdirSync(join(root, 'packages', 'ui'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'kettle', private: true }));
    writeFileSync(
      join(root, 'packages', 'ui', 'package.json'),
      JSON.stringify({ name: 'ui', dependencies: { minimist: '1.2.8' } }),
    );

    const result = await staticIntakeStage.run(contextFor(root));
    expect(sec10Findings(result)).toHaveLength(0);
    expect((result.notTested ?? []).filter((entry) => entry.criterion === 'SEC-10')).toHaveLength(
      0,
    );
  });

  it('a manifest inside node_modules is not somebody’s declared dependency', async () => {
    // The walk skips node_modules, and this is the reason it matters here:
    // every installed package carries a manifest, and charging the customer for
    // what their dependencies depend on would turn SEC-10 into noise.
    const root = join(sandbox, 'installed');
    mkdirSync(join(root, 'node_modules', 'left-pad'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'kettle' }));
    writeFileSync(
      join(root, 'node_modules', 'left-pad', 'package.json'),
      JSON.stringify({ name: 'left-pad', dependencies: { minimist: '1.2.0' } }),
    );

    const result = await staticIntakeStage.run(contextFor(root));
    expect(sec10Findings(result)).toHaveLength(0);
  });
});
