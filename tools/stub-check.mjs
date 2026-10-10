#!/usr/bin/env node
/**
 * "Never leave a TODO where a working implementation is expected. If you must
 * stub something, name it STUB_ and list it in /docs/OPEN_ITEMS.md."
 *
 * This gate makes that rule self-enforcing: every STUB_ symbol in the codebase
 * must appear in the open-items register, and any TODO or FIXME left behind
 * fails the build. Work that is deferred stays visible; work that is forgotten
 * does not exist.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, extname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/*
 * Not named with the STUB_ prefix, which was the first thing tried: the prefix
 * is this file's own marker for deferred work, and a test importing the
 * constant failed the gate for an unregistered stub named after the gate's
 * directory list. Fourth time tonight that a checker tripped over the name of
 * the thing checking it.
 */
export const SCANNED_DIRS = ['apps', 'packages', 'tools', 'tests', 'supabase', 'scripts'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.sql', '.sh']);
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', 'coverage']);
const SKIP_FILES = new Set(['tools/stub-check.mjs']);

/*
 * A scan directory that is not there used to be indistinguishable from one
 * that is empty.
 *
 * `readdirSync` threw, the `catch` returned the accumulator, and the walk
 * carried on — so renaming one of the six directories above silently removed
 * it from the gate, with no message and a passing exit code. The error is
 * raised instead, because the only two readings of a missing scan directory
 * are "somebody moved it and this list is stale" and "the checkout is
 * broken", and both want saying out loud.
 */
export function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (error) {
    throw new Error(`stub check cannot read ${dir} — if the directory moved, update SCANNED_DIRS`, {
      cause: error,
    });
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTENSIONS.has(extname(entry))) out.push(full);
  }
  return out;
}

/** The rule, separable from the walk, so each can be watched without the other. */
export function inspectLines(rel, text) {
  const problems = [];
  const stubs = new Set();
  text.split('\n').forEach((line, index) => {
    if (/\b(TODO|FIXME|XXX|HACK)\b/.test(line)) {
      problems.push(
        `${rel}:${index + 1}  leftover marker — name it STUB_ and register it in docs/OPEN_ITEMS.md`,
      );
    }
    for (const match of line.matchAll(/\bSTUB_[A-Z0-9_]+/g)) stubs.add(match[0]);
  });
  return { problems, stubs };
}

export function runStubCheck() {
  const openItems = readFileSync(join(root, 'docs/OPEN_ITEMS.md'), 'utf8');
  const problems = [];
  const stubs = new Set();
  let fileCount = 0;

  for (const file of SCANNED_DIRS.flatMap((dir) => walk(join(root, dir)))) {
    const rel = relative(root, file);
    if (SKIP_FILES.has(rel)) continue;
    fileCount += 1;
    const found = inspectLines(rel, readFileSync(file, 'utf8'));
    problems.push(...found.problems);
    for (const stub of found.stubs) stubs.add(stub);
  }

  for (const stub of stubs) {
    if (!openItems.includes(stub)) {
      problems.push(`${stub} is stubbed in the codebase but not listed in docs/OPEN_ITEMS.md`);
    }
  }

  return { problems, stubs, fileCount };
}

/*
 * Guarded, so the file can be imported and its two halves watched separately.
 * Its absence is why this was the one member of `pnpm verify` with no tests at
 * all: importing it ran it, and the first test fixture containing a marker
 * failed the suite on itself.
 */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { problems, stubs, fileCount } = runStubCheck();
  if (problems.length > 0) {
    console.error(`\n✗ Stub check failed — ${problems.length} problem(s):\n`);
    for (const problem of problems) console.error(`  · ${problem}`);
    console.error('');
    process.exit(1);
  }
  /*
   * The file count is the part worth printing. Zero registered stubs is a true
   * and welcome answer, and it was also what an empty scan printed — the same
   * sentence for a clean codebase and for a gate that read nothing.
   */
  console.log(
    `✓ Stub check passed — ${fileCount} files, ${stubs.size} registered stub(s), no leftover markers.`,
  );
}
