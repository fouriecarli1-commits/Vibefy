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
const SCAN_DIRS = ['apps', 'packages', 'tools', 'tests', 'supabase', 'scripts'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.sql', '.sh']);
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', 'coverage']);
const SKIP_FILES = new Set(['tools/stub-check.mjs']);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTENSIONS.has(extname(entry))) out.push(full);
  }
  return out;
}

const openItems = readFileSync(join(root, 'docs/OPEN_ITEMS.md'), 'utf8');
const problems = [];
const stubs = new Set();

for (const file of SCAN_DIRS.flatMap((dir) => walk(join(root, dir)))) {
  const rel = relative(root, file);
  if (SKIP_FILES.has(rel)) continue;
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (/\b(TODO|FIXME|XXX|HACK)\b/.test(line)) {
        problems.push(
          `${rel}:${index + 1}  leftover marker — name it STUB_ and register it in docs/OPEN_ITEMS.md`,
        );
      }
      for (const match of line.matchAll(/\bSTUB_[A-Z0-9_]+/g)) stubs.add(match[0]);
    });
}

for (const stub of stubs) {
  if (!openItems.includes(stub)) {
    problems.push(`${stub} is stubbed in the codebase but not listed in docs/OPEN_ITEMS.md`);
  }
}

if (problems.length > 0) {
  console.error(`\n✗ Stub check failed — ${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`  · ${problem}`);
  console.error('');
  process.exit(1);
}
console.log(`✓ Stub check passed — ${stubs.size} registered stub(s), no leftover markers.`);
