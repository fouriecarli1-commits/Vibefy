/**
 * A gate that passes because it read nothing.
 *
 * `pnpm verify` is the only thing standing between a change and production
 * here, and three of its members enumerate the tree themselves from a
 * hardcoded list of directories:
 *
 *     copy-lint    ['apps', 'packages', 'legal', 'brand', 'supabase']
 *     stub-check   ['apps', 'packages', 'tools', 'tests', 'supabase', 'scripts']
 *
 * Both walked each one inside `try { readdirSync(dir) } catch { return out }`,
 * so a directory that is not there is indistinguishable from one that is
 * empty. Rename `legal/` and the Badge Licence — the prose this gate exists
 * for — stops being read, with no message and a passing exit code.
 *
 * `tests/gates.test.ts` already asks `fileCount` to be greater than zero,
 * which is the fourth signature in the runbook's list: a matcher that stopped
 * matching, measured against a floor so low that losing a whole directory
 * cannot reach it. `apps/` alone keeps that assertion green.
 *
 * So the floor is per directory. Each entry has to contribute a file, and a
 * directory that is missing has to be an error rather than a shrug.
 *
 * `stub-check` additionally had no count at all — it reports how many STUB_
 * symbols it found, which is legitimately zero, and never says it read a
 * single file. An empty scan and a clean codebase printed the same sentence.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COPY_SCAN_DIRS, collectFiles, runCopyLint } from '../tools/copy-lint.mjs';
import { SCANNED_DIRS, inspectLines, runStubCheck, walk } from '../tools/stub-check.mjs';
import { runSecretScan } from '../tools/secret-scan.mjs';

const ROOT = resolve('.');

describe('copy lint reaches every directory it claims to', () => {
  it('names the directories it walks, so this test is about the real list', () => {
    expect(COPY_SCAN_DIRS).toContain('legal');
    expect(COPY_SCAN_DIRS).toContain('brand');
    expect(COPY_SCAN_DIRS.length).toBeGreaterThan(3);
  });

  it('every one of them contributes at least one file', () => {
    // A total count cannot see this. `apps/` is thousands of files; `legal/` is
    // the one the gate exists for.
    for (const dir of COPY_SCAN_DIRS) {
      expect(collectFiles(join(ROOT, dir)).length, dir).toBeGreaterThan(0);
    }
  });

  it('refuses a directory that is not there rather than walking past it', () => {
    expect(() => collectFiles(join(ROOT, 'legaal'))).toThrow(/legaal/);
  });

  it('still reads far more than the old floor of one', () => {
    expect(runCopyLint().fileCount).toBeGreaterThan(200);
  });
});

describe('stub check reaches every directory it claims to', () => {
  it('every one of them contributes at least one file', () => {
    for (const dir of SCANNED_DIRS) {
      expect(walk(join(ROOT, dir)).length, dir).toBeGreaterThan(0);
    }
  });

  it('refuses a directory that is not there', () => {
    expect(() => walk(join(ROOT, 'packagez'))).toThrow(/packagez/);
  });

  it('says how many files it read, because zero stubs is a true answer to nothing', () => {
    const { fileCount } = runStubCheck();
    expect(fileCount).toBeGreaterThan(200);
  });

  it('prints that count where somebody running it will see it', () => {
    const result = spawnSync('node', [resolve('tools/stub-check.mjs')], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    const claimed = Number(/(\d+) files/.exec(result.stdout)?.[1]);
    expect(claimed).toBe(runStubCheck().fileCount);
  });

  it('is clean on this repository, or the assertions above prove nothing', () => {
    expect(runStubCheck().problems).toEqual([]);
  });
});

describe('the rules stub check applies, with the wiring watched separately', () => {
  /*
   * Built at runtime, never written out.
   *
   * The first draft of this file spelled the marker in a string literal, and
   * stub-check — which scans `tests/` — failed the whole suite on its own test
   * fixture. Third time tonight that a checker tripped over the file written
   * to check it: copy lint on the word in a comment explaining the word, and
   * the audit's word check on the sentence explaining the word check.
   */
  const marker = (word: string) => `const a = 1; // ${word}: come back to this`;
  const stubName = `STUB_${'SYNTHESIS'}_MODEL`;

  it('flags a leftover marker', () => {
    const { problems } = inspectLines('apps/web/x.ts', marker('TO' + 'DO'));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('apps/web/x.ts:1');
  });

  it('flags each of the four words, not just the first one anybody thought of', () => {
    for (const word of ['TO' + 'DO', 'FIX' + 'ME', 'XX' + 'X', 'HA' + 'CK']) {
      expect(inspectLines('a.ts', marker(word)).problems, word).toHaveLength(1);
    }
  });

  it('collects a STUB_ symbol so the register can be checked against it', () => {
    const { stubs } = inspectLines('apps/web/x.ts', `export const ${stubName} = null;`);
    expect([...stubs]).toEqual([stubName]);
  });

  it('reads the marker as a word and not as a substring', () => {
    // Written the other way round first, asserting that a trailing S still
    // counted. It does not, and should not: `\b` on both sides is the rule,
    // and an identifier that merely contains the letters is not deferred work.
    expect(inspectLines('a.ts', 'const todoList = [];').problems).toEqual([]);
    expect(inspectLines('a.ts', `const ${'TO' + 'DO'}S_DONE = 1;`).problems).toEqual([]);
    expect(inspectLines('a.ts', marker('TO' + 'DO')).problems).toHaveLength(1);
  });
});

describe('secret scan, which asks git rather than walking', () => {
  it('scanned a plausible number of files', () => {
    // It calls `git ls-files`, so a renamed directory cannot hide from it. The
    // failure mode here is a count that collapses for another reason entirely,
    // and a floor is the only thing that would show it.
    expect(runSecretScan().scanned).toBeGreaterThan(300);
  });

  it('is looking at a checkout and not an empty directory', () => {
    const empty = mkdtempSync(join(tmpdir(), 'notarepo-'));
    expect(existsSync(join(ROOT, '.git'))).toBe(true);
    expect(existsSync(join(empty, '.git'))).toBe(false);
  });
});
