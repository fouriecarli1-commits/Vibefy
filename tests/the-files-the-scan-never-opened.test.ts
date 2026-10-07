/**
 * The secret scan reads an allowlist of file types, and said nothing about the
 * rest.
 *
 * `walk` reports three narrowings in the notes — files over 1 MB, symbolic links
 * not followed, directories that would not open — and the stage's own header
 * commits to that: "a count of what was analysed, with no mention of what was
 * not, reads like a statement about the whole repository."
 *
 * The largest narrowing was the one it did not report. `scannable` admits a file
 * only where its extension is in `TEXT_EXTENSIONS` or its whole name is in
 * `SCANNED_FILENAMES`; everything else is dropped during the walk and never
 * counted. The report then says "Analysed 612 source file(s)" and no findings,
 * and SEC-04 renders as a tick.
 *
 * Two things were measured on our own repository on 2026-10-07, with the
 * database fixtures under `.tmp` and the known binary types set aside:
 *
 *   · `.mts` — nine files, TypeScript, unscanned, while `.mjs` and `.cjs` were
 *     both on the list. There is no reading of this under which `.mts` is a
 *     different kind of file from `.mjs`.
 *   · nothing in the output said a single file had been skipped on its type.
 *
 * The missing extensions here are the ones where a committed credential is a
 * documented pattern rather than a hypothetical: shell and PowerShell deploy
 * scripts, Jupyter notebooks, Terraform's other extension, and the template
 * languages that embed configuration.
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
  sandbox = mkdtempSync(join(tmpdir(), 'vibefycode-coverage-'));
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function contextFor(repositoryPath: string): StageContext {
  return {
    assessmentId: 'coverage',
    depth: 'full' as const,
    guard: new ScopeGuard({
      allowedHosts: ['example.test'],
      exclusions: [],
      ceiling: DEFAULT_CEILING,
    }),
    meter: new CostMeter({ maxRunCostUsd: 1 }),
    evidence: new EvidenceStore('coverage'),
    model: null as never,
    log: () => undefined,
    target: {
      appId: 'app-coverage',
      organisationId: 'org-coverage',
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

/** A key shape the scanner rates critical, so a miss is unambiguous. */
const AWS_KEY = 'AKIA' + 'IOSFODNN7EXAMPLE';

function repositoryWith(name: string, files: Record<string, string>): string {
  const root = join(sandbox, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'kettle' }));
  for (const [path, contents] of Object.entries(files)) {
    writeFileSync(join(root, path), contents);
  }
  return root;
}

const secretsIn = (result: { findings: readonly { ruleId: string }[] }) =>
  result.findings.filter((finding) => finding.ruleId === 'SEC-04');

describe('file types a committed credential actually turns up in', () => {
  const cases: readonly [string, string][] = [
    ['config.mts', 'TypeScript, where .mjs and .cjs were already read'],
    ['config.cts', 'the other half of the same pair'],
    ['deploy.ps1', 'a PowerShell deploy script'],
    ['deploy.bash', 'a shell script under a name .sh does not cover'],
    ['main.tf.json', 'Terraform in its JSON form'],
    ['infra.hcl', 'Terraform’s other extension, beside .tf and .tfvars'],
    ['notebook.ipynb', 'a Jupyter notebook, the classic place a key is pasted'],
    ['index.erb', 'a template that embeds configuration'],
  ];

  for (const [filename, why] of cases) {
    it(`reads ${filename} — ${why}`, async () => {
      const root = repositoryWith(filename.replace(/\W/g, '-'), {
        [filename]: `const key = "${AWS_KEY}"\n`,
      });

      const result = await staticIntakeStage.run(contextFor(root));
      expect(secretsIn(result)).toHaveLength(1);
    });
  }
});

describe('what the notes say about the files it did not open', () => {
  it('counts them, rather than reporting only what it read', async () => {
    const root = repositoryWith('unread', {
      'events.parquet': 'whatever',
      'events.avro': 'whatever',
    });

    const result = await staticIntakeStage.run(contextFor(root));
    expect(result.notes.join(' ')).toMatch(/2 file\(s\) (?:were|was) of a type/i);
  });

  it('names the types, so the customer can say whether it mattered', async () => {
    const root = repositoryWith('named-types', { 'events.parquet': 'whatever' });

    const result = await staticIntakeStage.run(contextFor(root));
    expect(result.notes.join(' ')).toContain('.parquet');
  });

  it('does not count an image, because naming every asset is noise', async () => {
    // The direction this note fails in: a sentence on every report saying
    // thousands of files were not read, which trains the reader to skip it.
    const root = repositoryWith('images', { 'logo.png': 'not really a png' });

    const result = await staticIntakeStage.run(contextFor(root));
    expect(result.notes.join(' ')).not.toMatch(/of a type/i);
  });

  it('says nothing where it read everything', async () => {
    const root = repositoryWith('complete', { 'index.ts': 'export const a = 1;\n' });

    const result = await staticIntakeStage.run(contextFor(root));
    expect(result.notes.join(' ')).not.toMatch(/of a type/i);
  });
});

describe('what has to keep holding', () => {
  it('still refuses to follow a symbolic link', async () => {
    const root = repositoryWith('linked', { 'index.ts': 'export const a = 1;\n' });
    const { symlinkSync } = await import('node:fs');
    symlinkSync('/', join(root, 'everything'));

    const result = await staticIntakeStage.run(contextFor(root));
    expect(result.notes.join(' ')).toMatch(/symbolic link/);
  });

  it('still finds a key in a file type it always read', async () => {
    const root = repositoryWith('plain-ts', { 'index.ts': `const k = "${AWS_KEY}"\n` });

    const result = await staticIntakeStage.run(contextFor(root));
    expect(secretsIn(result)).toHaveLength(1);
  });
});
