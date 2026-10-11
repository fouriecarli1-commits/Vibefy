/**
 * The console imports the engine. It must never run one.
 *
 * `apps/web` imports `@vibefycode/engine` in six places, for constants and
 * refusals it is right to share: the screening categories, the scope ceiling,
 * the retention period, the DNS record prefix, the repository-URL check. A
 * shared constant is how the console and the worker avoid saying different
 * things about the same rule.
 *
 * Importing the barrel also reaches the runner, and that is a different kind of
 * thing to have in a request. An assessment launches a browser, clones a
 * repository, calls a model with a key the console has no business holding, and
 * takes minutes — none of which belongs in a serverless function with a
 * ten-second budget, and a half-run assessment is worse than no assessment
 * because it writes evidence rows for work that did not finish.
 *
 * This matters here because `tests/which-deployment-holds-which-variable.test.ts`
 * excuses `PLAYWRIGHT_BROWSERS_PATH`, `VIBEFYCODE_BROWSER_EXECUTABLE` and `PATH`
 * from the Vercel table on exactly this ground: the modules are reachable and
 * the code is never called. An excuse like that is worth no more than the
 * assertion behind it, so this is the assertion.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withoutComments } from './setup/source.ts';

function sourcesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.next', 'dist'].includes(entry.name)) continue;
      found.push(...sourcesUnder(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

const console_ = sourcesUnder('apps/web').map((path) => ({
  path,
  code: withoutComments(readFileSync(path, 'utf8')),
}));

describe('what the console does not do', () => {
  it('found the console to search', () => {
    expect(console_.length).toBeGreaterThan(100);
    expect(console_.map((file) => file.path)).toContain('apps/web/app/console/apps/actions.ts');
  });

  it('runs no pipeline', () => {
    // The worker runs it, from a queue, one at a time, with a spend ceiling.
    const running = console_.filter((file) =>
      /\brunPipeline\b|\brunAssessmentJob\b/.test(file.code),
    );
    expect(running.map((file) => file.path)).toEqual([]);
  });

  it('launches no browser', () => {
    const launching = console_.filter((file) =>
      /\bchromium\b|\bBrowserSession\b|\bresolveBrowserExecutable\b|playwright/.test(file.code),
    );
    expect(launching.map((file) => file.path)).toEqual([]);
  });

  it('clones no repository', () => {
    // `repositoryUrlOrRefuse` is a check on a string and is imported
    // deliberately; cloning is the part that needs git, a disk and minutes.
    const cloning = console_.filter((file) =>
      /\bcloneRepository\b|\bsimple-git\b|execFile\(/.test(file.code),
    );
    expect(cloning.map((file) => file.path)).toEqual([]);
  });

  it('still shares the constants, which is why the import is there at all', () => {
    // If this stops being true the exclusions above are about nothing, and the
    // deployment sweep's reasons should be rewritten rather than quietly kept.
    const sharing = console_.filter((file) => file.code.includes("from '@vibefycode/engine"));
    expect(sharing.length).toBeGreaterThan(3);
  });
});
