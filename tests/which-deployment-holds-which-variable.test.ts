/**
 * A variable a deployment needs, in the table that deployment is set up from.
 *
 * `tests/every-documented-variable-is-read.test.ts` asks one direction of this
 * question: a name we tell somebody to set has to be read by something. It
 * found twelve names that nothing read. This is the other direction, and it is
 * the one that cost a night.
 *
 * `docs/RUNBOOK.md` has a table per deployment — what to set on Vercel, what to
 * set on Render — and that table is what somebody configures a platform from.
 * Twice on 2026-10-11 the code reached a variable that its own deployment's
 * table did not list, and in both cases the result was invisible:
 *
 *   · The published badge key set and `/verify` read the signing pair, which
 *     the runbook says belongs on Render and nowhere else. Set up from the
 *     Vercel table, the console had no key, published an empty set, and every
 *     badge in the world failed to verify while `/verify` told each visitor it
 *     could not check one.
 *   · `RESEND_API_KEY` was listed for Render only, under a paragraph saying
 *     email is sent by the worker alone. The console sends the workspace
 *     invitation and has to, because the link carries a token that exists in
 *     that request and nowhere else. Every invitation went out by hand.
 *
 * ## What a failure here does not tell you
 *
 * It names a disagreement between the code and the deployment. It cannot say
 * which of the two is wrong, and the lazy resolution is the dangerous one: the
 * first case above would have been "fixed" by adding the signing key to the
 * Vercel table, which is the one thing that section of the runbook forbids. The
 * right answer was to stop the console reading it. So this fails loudly and
 * leaves the decision to a person.
 *
 * ## Reachability, and why it over-approximates on purpose
 *
 * A variable counts as reached by a deployment when it is read in a module that
 * deployment's entry points can import, transitively through the workspace
 * packages. That is more than it executes: the console imports the engine's
 * barrel for a few constants and refusal helpers, which pulls in the browser
 * launcher it never calls. Those are listed below with the reason, and where a
 * stronger claim is available the reason points at the test that holds it
 * rather than asking to be believed.
 *
 * The alternative — counting only what a request can execute — needs a call
 * graph, and a call graph that is wrong in the quiet direction is worse than a
 * list of eight exceptions somebody has read.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

/** Where a workspace package's barrel lives, or its sub-path export. */
function packageEntry(specifier: string): string | null {
  const [, name = '', sub = ''] = /^@vibefycode\/([^/]+)(?:\/(.*))?$/.exec(specifier) ?? [];
  const candidates = sub
    ? [`packages/${name}/src/${sub}.ts`, `packages/${name}/src/${sub}/index.ts`]
    : [`packages/${name}/src/index.ts`];
  const found = candidates.find((path) => existsSync(join(ROOT, path)));
  return found ? join(ROOT, found) : null;
}

function asFile(base: string): string | null {
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every module an entry point can reach, and every variable read in them. */
function reachedBy(entryPoints: readonly string[]): Map<string, Set<string>> {
  const seen = new Set<string>();
  const variables = new Map<string, Set<string>>();

  const walk = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      return;
    }

    for (const match of text.matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)) {
      const name = match[1]!;
      if (!variables.has(name)) variables.set(name, new Set());
      variables.get(name)!.add(file.replace(`${ROOT}/`, ''));
    }

    for (const match of text.matchAll(/from\s+'([^']+)'/g)) {
      const specifier = match[1]!;
      let next: string | null = null;
      if (specifier.startsWith('.')) next = asFile(resolve(dirname(file), specifier));
      else if (specifier.startsWith('@vibefycode/')) next = packageEntry(specifier);
      // The console's own alias for its root, which is how most of its
      // server-side code imports `lib/`.
      else if (specifier.startsWith('@/'))
        next = asFile(resolve(ROOT, 'apps/web', specifier.slice(2)));
      if (next) walk(next);
    }
  };

  for (const entry of entryPoints) walk(entry);
  return variables;
}

function sourcesUnder(dir: string, pattern: RegExp): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.next', 'dist'].includes(entry.name)) continue;
      found.push(...sourcesUnder(full, pattern));
    } else if (pattern.test(entry.name)) found.push(full);
  }
  return found;
}

const RUNBOOK = readFileSync(join(ROOT, 'docs/RUNBOOK.md'), 'utf8');

/** One deployment's table, found by its own heading rather than by position. */
function tableBetween(from: string, to: string): string {
  const start = RUNBOOK.indexOf(from);
  const end = RUNBOOK.indexOf(to, start + 1);
  if (start < 0 || end < 0) throw new Error(`docs/RUNBOOK.md no longer has the ${from} table`);
  return RUNBOOK.slice(start, end);
}

/**
 * Whether a table lists a variable, allowing the wildcard rows it uses.
 *
 * `STRIPE_*` stands for the five price ids and two keys, which is the right
 * thing to write for somebody setting them and the wrong thing to match
 * literally.
 */
function lists(table: string, name: string): boolean {
  if (table.includes(`\`${name}\``)) return true;
  for (const match of table.matchAll(/`([A-Z][A-Z0-9_]*)_\*`/g)) {
    if (name.startsWith(`${match[1]!}_`)) return true;
  }
  return false;
}

/**
 * Reached but deliberately not in that deployment's table, with the reason.
 *
 * A reason has to say where the behaviour comes from. "Not needed" is not a
 * reason; it is the claim being made, and this map exists because that claim
 * was wrong twice in one night.
 */
const NOT_IN_THE_TABLE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  vercel: {
    VIBEFYCODE_BADGE_SIGNING_KEY_B64:
      'Reached through packages/badge/src/keys.ts and never called: tests/the-key-the-console-could-not-publish.test.ts asserts that no file under apps/web mentions loadSigningKey, requireSigningKey or this name. That assertion is the point of the fix — listing it here instead would put the signing key on the deployment that must not hold one.',
    VIBEFYCODE_BADGE_KEY_ID:
      'The other half of the same pair, reached the same way through packages/badge/src/keys.ts and never read by the console. The same assertion in tests/the-key-the-console-could-not-publish.test.ts holds it.',
    NEXT_PUBLIC_VERIFY_URL:
      'An override for deployments that serve badges from a second hostname, and the table lists NEXT_PUBLIC_SITE_URL, which is what resolves when it is unset. apps/web/lib/verify-origin.ts is the only reader and falls back on its own; a deployment that needs it knows it does.',
    ALERT_EMAIL_REPLY_TO:
      'Optional on both deployments, which is what the Render table says about it. packages/notify/src/resend.ts omits the header when it is unset, and nothing else reads it.',
    PLAYWRIGHT_BROWSERS_PATH:
      'The engine barrel reaches the browser launcher; the console never launches one, which tests/the-console-runs-no-assessment.test.ts asserts by sweeping apps/web for the runner entry points. On the worker it is set by the platform image, not by us.',
    VIBEFYCODE_BROWSER_EXECUTABLE:
      'The same override, reached through packages/engine/src/runtime/browser.ts and never used in a request. Documented in the runbook prose where somebody debugging a runner will be, rather than in a table of things to set.',
    PATH: 'The operating system supplies it. packages/engine/src/runtime/repository.ts reads it to find git, and the console never clones anything.',
    NODE_ENV:
      'Set by Next and by Vercel, not by us. apps/web/lib/payments.ts reads it to refuse live payment keys outside production.',
  },
  render: {
    VIBEFYCODE_BADGE_PUBLIC_KEYS:
      'The serving half, reached through packages/badge/src/keys.ts because that is also where the worker loads its signing key. apps/worker/src/badge.ts publishes nothing — it prints the line for the console to publish — so setting it here would change nothing.',
    VIBEFYCODE_BADGE_RETIRED_KEYS:
      'Published by the console alongside the active key. apps/worker/src/badge.ts signs with the current key only, and never reads the retired list.',
    NEXT_PUBLIC_VERIFY_URL:
      'The same override as on Vercel. The table lists NEXT_PUBLIC_SITE_URL, which announcementOrigin falls back to, and tests/the-worker-says-what-it-cannot-do.test.ts holds the worker to saying so at start-up when neither is usable.',
    VIBEFYCODE_REPORT_DIR:
      'Defaults to .tmp/reports in apps/worker/src/report.ts. Evidence bytes on a container disk are a known gap in docs/OPEN_ITEMS.md, not a variable to set.',
    PLAYWRIGHT_BROWSERS_PATH:
      'Set by the Playwright image the worker builds on. resolveBrowserExecutable falls back to a search, and a missing browser fails a run loudly rather than quietly.',
    VIBEFYCODE_BROWSER_EXECUTABLE:
      'An override read by packages/engine/src/runtime/browser.ts when the image resolution fails, documented in the runbook prose about the runner.',
    PATH: 'The operating system supplies it, and packages/engine/src/runtime/repository.ts reads it to find git.',
  },
};

const DEPLOYMENTS = [
  {
    key: 'vercel',
    label: 'Vercel',
    table: () =>
      tableBetween('**Vercel — the console and the public pages', '**Render — the worker'),
    entryPoints: () => [
      ...sourcesUnder(join(ROOT, 'apps/web/app'), /\.(ts|tsx)$/),
      ...sourcesUnder(join(ROOT, 'apps/web/lib'), /\.ts$/),
    ],
  },
  {
    key: 'render',
    label: 'Render',
    table: () => tableBetween('**Render — the worker', '**The two that must never cross.**'),
    entryPoints: () => [join(ROOT, 'apps/worker/src/main.ts')],
  },
] as const;

describe('the deployment tables', () => {
  for (const deployment of DEPLOYMENTS) {
    describe(deployment.label, () => {
      const table = deployment.table();
      const reached = reachedBy(deployment.entryPoints());

      it('found a table and something to compare it with', () => {
        expect(table.length).toBeGreaterThan(300);
        expect(reached.size).toBeGreaterThan(8);
      });

      it('lists every variable this deployment can reach, or says why not', () => {
        const missing: string[] = [];
        for (const [name, files] of reached) {
          if (lists(table, name)) continue;
          const reason = NOT_IN_THE_TABLE[deployment.key]?.[name];
          if (!reason) missing.push(`${name} (read in ${[...files].slice(0, 2).join(', ')})`);
        }
        // Read the header of this file before resolving one of these. The
        // obvious fix — add the row — is the wrong one when the answer is that
        // this deployment should not be reading the variable at all.
        expect(missing).toEqual([]);
      });

      it('has a reason for each exception that says where the behaviour comes from', () => {
        for (const [name, reason] of Object.entries(NOT_IN_THE_TABLE[deployment.key] ?? {})) {
          expect(reason.length, name).toBeGreaterThan(40);
          expect(reason, name).toMatch(/[a-z]+\/[a-z-]+|platform|operating system|Next|Playwright/);
        }
      });

      it('has no exception for a variable it does not actually reach', () => {
        // An excuse outliving the thing it excuses is how a list like this
        // stops being read.
        const stale = Object.keys(NOT_IN_THE_TABLE[deployment.key] ?? {}).filter(
          (name) => !reached.has(name),
        );
        expect(stale).toEqual([]);
      });
    });
  }
});

describe('the two the night was spent on', () => {
  const vercel = tableBetween(
    '**Vercel — the console and the public pages',
    '**Render — the worker',
  );

  it('has the console publishing keys and not holding them', () => {
    expect(lists(vercel, 'VIBEFYCODE_BADGE_PUBLIC_KEYS')).toBe(true);
    expect(lists(vercel, 'VIBEFYCODE_BADGE_SIGNING_KEY_B64')).toBe(false);
  });

  it('has the console able to send the one email it sends', () => {
    // The invitation. Its token exists in that request and nowhere else, so
    // there is nothing for a sweep on the worker to pick up later.
    expect(lists(vercel, 'RESEND_API_KEY')).toBe(true);
    expect(lists(vercel, 'ALERT_EMAIL_FROM')).toBe(true);
  });
});
