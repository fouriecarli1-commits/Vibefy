/**
 * The constraint that is not a type error.
 *
 * Next refuses a route file that exports both `metadata` and
 * `generateMetadata`: "cannot be exported at the same time, please keep one of
 * them". It is a framework rule, so `tsc` is happy, so `pnpm verify` is happy —
 * it typechecks and renders no page — and the first thing that objects is a
 * production build, which only `pnpm check:a11y` runs. On 2026-10-11 that meant
 * a green fast gate, a pushed commit, and a failed accessibility job on two
 * pages that could no longer build.
 *
 * The runbook now says a change to a page's exports needs `pnpm verify:all`.
 * This is the cheaper half of the same lesson: a six-minute build failure
 * turned into a two-second test failure, for the one rule that can be checked
 * by reading.
 *
 * It deliberately does not try to be a Next linter. Every other export shape
 * this app relies on — `dynamic`, `revalidate`, `generateStaticParams` — is
 * legal in combination and only a build can tell whether it does what somebody
 * meant.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withoutComments } from './setup/source.ts';

function routeFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.next', 'dist'].includes(entry.name)) continue;
      found.push(...routeFiles(full));
    } else if (/^(page|layout|route|template|default)\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

const FILES = routeFiles('apps/web/app').map((path) => ({
  path,
  code: withoutComments(readFileSync(path, 'utf8')),
}));

describe('every route file in the console and the public pages', () => {
  it('was found, or the sweep below is about nothing', () => {
    expect(FILES.length).toBeGreaterThan(40);
    expect(FILES.map((file) => file.path)).toContain('apps/web/app/layout.tsx');
  });

  it('includes the two that generate their metadata, so the rule has something to catch', () => {
    // The positive control. A regex that matches nothing passes every absence
    // assertion ever written.
    const generating = FILES.filter((file) =>
      /export (?:async )?function generateMetadata/.test(file.code),
    );
    expect(generating.length).toBeGreaterThan(0);
    expect(generating.map((file) => file.path)).toContain('apps/web/app/trust-check/page.tsx');
  });

  it('exports metadata or generateMetadata, never both', () => {
    const both = FILES.filter(
      (file) =>
        /export (?:async )?function generateMetadata|export const generateMetadata/.test(
          file.code,
        ) && /export const metadata\b|export let metadata\b/.test(file.code),
    ).map((file) => file.path);
    // Next's message, for whoever reads this failure: "metadata and
    // generateMetadata cannot be exported at the same time, please keep one of
    // them." Keep the function and make the object a local constant.
    expect(both).toEqual([]);
  });
});
