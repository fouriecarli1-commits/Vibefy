/**
 * The console pulling a browser automation library into a page request.
 *
 * `packages/engine/src/authorisation/index.ts` exists for one stated reason:
 * "the parts of the engine that run inside the web app rather than inside the
 * sandboxed runner… kept as a separate entry point so the console never pulls a
 * browser driver into its bundle graph."
 *
 * `apps/web/app/console/apps/actions.ts` then imported the package root as
 * well, for two functions about a repository URL — and the root reaches
 * `runtime/browser.ts`, which imports Playwright. Every page that imports that
 * action module was loading a browser driver to validate a string. The report
 * package refuses the same dependency in its own words: "a report package that
 * depended on the engine would drag a browser automation library into a
 * renderer."
 *
 * `/console/apps/new` answered with a server error in production on
 * 2026-10-21. This is not proof of what caused that — a blank "a server error
 * occurred" is proof of nothing, which is its own finding and why that page now
 * prints a reference. It is a thing that was wrong, found while looking.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { commentsBlanked } from './setup/source.ts';

const webSources = () =>
  execFileSync('git', ['ls-files', 'apps/web'], { encoding: 'utf8' })
    .split('\n')
    .filter((path) => /\.tsx?$/.test(path));

describe('what the web app may import from the engine', () => {
  it('never the package root, which reaches Playwright', () => {
    const offenders = webSources().filter((path) =>
      /from '@vibefycode\/engine'/.test(commentsBlanked(readFileSync(path, 'utf8'))),
    );
    expect(
      offenders,
      `these import the engine root; use a subpath:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('has subpaths for the things it does need', () => {
    // Named exports in the engine's own package manifest, so a subpath import
    // cannot silently resolve to the root through a bundler's guesswork.
    const manifest = JSON.parse(readFileSync('packages/engine/package.json', 'utf8')) as {
      exports: Record<string, string>;
    };
    for (const subpath of ['./authorisation', './repository', './cost', './scope']) {
      expect(manifest.exports[subpath], subpath).toBeTruthy();
    }
  });

  it('keeps the browser out of every subpath the web app uses', () => {
    /*
     * The claim the subpaths exist to make. Followed one level: each entry
     * point, and what it imports, may not reach `runtime/browser.ts`.
     */
    const reached = new Set<string>();
    const follow = (file: string) => {
      if (reached.has(file) || !file.startsWith('packages/engine/')) return;
      reached.add(file);
      const source = commentsBlanked(readFileSync(file, 'utf8'));
      for (const match of source.matchAll(/from '(\.[^']+\.ts)'/g)) {
        const from = new URL(match[1]!, `file:///${file}`).pathname.slice(1);
        follow(from);
      }
    };
    for (const entry of [
      'packages/engine/src/authorisation/index.ts',
      'packages/engine/src/runtime/repository.ts',
      'packages/engine/src/runtime/cost.ts',
      'packages/engine/src/runtime/scope.ts',
    ]) {
      follow(entry);
    }
    expect(reached.size, 'nothing was followed, so this proves nothing').toBeGreaterThan(4);
    expect([...reached].filter((file) => file.endsWith('runtime/browser.ts'))).toEqual([]);
  });

  it('is the console that would have carried it', () => {
    // The positive control: the worker does import the root, and should.
    const worker = commentsBlanked(readFileSync('apps/worker/src/run-assessment.ts', 'utf8'));
    expect(worker).toMatch(/from '@vibefycode\/engine'/);
  });
});

describe('a page that fails to render', () => {
  it('says so in our own words, with something to report', () => {
    /*
     * What production showed instead: a white screen, a triangle and "This page
     * couldn't load — a server error occurred". Not our wording, nothing about
     * whose fault it is, and nothing for somebody reporting it to report. The
     * digest is a hash of the error rather than its message — useless to
     * anybody who cannot already read our logs, which is what makes it both
     * safe to print and worth printing.
     */
    const boundary = readFileSync('apps/web/app/console/error.tsx', 'utf8');
    expect(boundary).toMatch(/'use client'/);
    expect(boundary).toMatch(/error\.digest/);
    expect(boundary).toMatch(/Nothing you did caused it/);
    expect(boundary, 'the message itself may name our internals').not.toMatch(/\{error\.message\}/);
  });
});
