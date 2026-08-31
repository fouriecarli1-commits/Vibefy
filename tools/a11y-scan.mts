#!/usr/bin/env tsx
/**
 * The accessibility gate for our own pages.
 *
 * PART 8.3, in the brief's own words: WCAG 2.2 AA is a rubric dimension *and* a
 * requirement for our own product, because it is hard to sell an accessibility
 * score from an inaccessible dashboard. We score other people on this.
 *
 * It lives in its own command rather than in `pnpm test` because it needs the
 * app built and served, which is a different order of setup from a unit test.
 * The report, the badge and the alert email are scanned in `pnpm test` instead —
 * those are pure functions and need nothing running.
 *
 *   pnpm check:a11y                 build, serve, scan, tear down
 *   pnpm check:a11y --url <origin>  scan something already running
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { auditUrl, closeAxeBrowser, describe as explain } from '../tests/setup/axe.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3123;

/**
 * The pages a stranger can reach.
 *
 * The authenticated console is not here, and that is a real gap rather than an
 * oversight: reaching it needs a live auth service, which the local harness does
 * not run. It is registered in docs/OPEN_ITEMS.md.
 */
const PAGES = [
  '/',
  '/how-it-works',
  '/services/remediation',
  '/methodology',
  '/legal',
  '/legal/badge-licence',
  '/legal/privacy-policy',
  '/legal/terms-of-service',
  '/legal/rating-methodology-and-independence',
  '/verify',
  '/directory',
  // Added the day they were built. A public page that ships unscanned is the
  // credibility problem this gate exists for: we sell an accessibility score.
  '/advertise',
  '/games',
  '/trust-check',
  '/trust-check/traps/the-free-trial-that-was-not',
  '/sign-in',
  '/sign-up',
  '/not-a-page-that-exists',
];

const ENVIRONMENT: Record<string, string> = {
  // Rendering only. The anon key is public by design and nothing here reaches a
  // real project; the pages that need the database read the local test one.
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-anon-key-for-rendering-only',
  NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${PORT}`,
  NEXT_PUBLIC_VERIFY_URL: `http://127.0.0.1:${PORT}`,
  SUPABASE_DB_URL:
    process.env.SUPABASE_DB_URL ??
    process.env.VIBEFYCODE_TEST_DSN ??
    `postgresql://postgres@localhost/vibefycode_test?host=${join(root, '.tmp/pg/socket')}`,
};

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, ...ENVIRONMENT },
    });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
}

async function waitForServer(origin: string, attempts = 40): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(2000) });
      if (response.ok || response.status < 500) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`The app did not start on ${origin}.`);
}

async function main(): Promise<void> {
  const urlFlag = process.argv.indexOf('--url');
  const external = urlFlag >= 0 ? process.argv[urlFlag + 1] : undefined;
  const origin = external ?? `http://127.0.0.1:${PORT}`;
  const web = join(root, 'apps/web');

  let server: ChildProcess | undefined;
  if (!external) {
    // The pages that read the database need a *current* one. Three times now a
    // stale local cluster — missing a migration added since it was last
    // created — has made `/directory` render its error page, and an error page
    // has no title and no lang attribute, so the scan reported two
    // accessibility violations for what was really an out-of-date schema. The
    // failure told the truth about the page and lied about the cause.
    if (!process.env.SUPABASE_DB_URL) {
      console.log('· Bringing the local test database up to date…');
      await run('bash', ['scripts/test-db.sh', 'reset'], root);
    }

    console.log('· Building the app…');
    await run('pnpm', ['exec', 'next', 'build'], web);
    server = spawn('pnpm', ['exec', 'next', 'start', '-p', String(PORT)], {
      cwd: web,
      stdio: 'ignore',
      env: { ...process.env, ...ENVIRONMENT },
    });
    await waitForServer(origin);
  }

  const failures: string[] = [];
  let scanned = 0;
  try {
    for (const page of PAGES) {
      const { violations, passes } = await auditUrl(`${origin}${page}`);
      // A green gate that is green because the scan silently did nothing is
      // worse than no gate at all.
      if (passes === 0) {
        failures.push(`${page}: no rules ran. The scan did not happen.`);
        continue;
      }
      scanned += 1;
      if (violations.length > 0) {
        failures.push(`${page} — ${violations.length} violation(s)\n${explain(violations)}`);
      }
    }
  } finally {
    await closeAxeBrowser();
    server?.kill('SIGTERM');
  }

  if (failures.length > 0) {
    console.error(`\n✗ Accessibility scan failed on ${failures.length} page(s):\n`);
    for (const failure of failures) console.error(`  ${failure}\n`);
    process.exit(1);
  }

  console.log(
    `\n✓ Accessibility scan passed — ${scanned} pages, no WCAG 2.2 AA violations.\n` +
      '  An automated scan finds a minority of real barriers. This is a floor, not a claim.',
  );
}

await main();
