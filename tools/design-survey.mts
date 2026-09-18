#!/usr/bin/env tsx
/**
 * The objective eye, turned on our own pages.
 *
 * Anré asked for a survey that counts the pieces of a design rather than
 * judging it, because the person who chose every value one at a time is
 * precisely the person who cannot see the result. That applies to us. We are
 * also the people who get tired and get trapped in fixing.
 *
 * It is also the only honest way to set a threshold. The button check fires
 * above three styles and not above two because running it here found a primary,
 * a secondary and a compact control in our own navigation — which is not sprawl,
 * it is the minimum vocabulary an interface needs. A threshold that fires on
 * every well-built page is noise, and noise teaches people to stop reading.
 *
 * A report rather than a gate, for now: it prints what the survey sees and
 * exits zero. Promoting it to something that fails the build is a decision to
 * take once our own pages are clean, not a way of pretending they are.
 *
 *   pnpm check:design                 build, serve, survey, tear down
 *   pnpm check:design --url <origin>  survey something already running
 *   pnpm check:design --why            print the measurements, not only the titles
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  BrowserSession,
  DESKTOP_VIEWPORT,
  MOBILE_VIEWPORT,
} from '../packages/engine/src/runtime/browser.ts';
import { EvidenceStore } from '../packages/engine/src/runtime/evidence.ts';
import { DEFAULT_CEILING, ScopeGuard } from '../packages/engine/src/runtime/scope.ts';
import { designFindings, measureDesign } from '../packages/engine/src/stages/design-checks.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3124;

/** The pages a stranger sees, which are the ones worth being consistent across. */
const PAGES = [
  '/',
  '/how-it-works',
  '/methodology',
  '/directory',
  '/trust-check',
  '/advertise',
  '/games',
  '/services',
  '/glossary',
  '/services/remediation',
  '/legal',
  '/sign-in',
];

const ENVIRONMENT: Record<string, string> = {
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
  const why = process.argv.includes('--why');
  const web = join(root, 'apps/web');

  let server: ChildProcess | undefined;
  if (!external) {
    if (!process.env.SUPABASE_DB_URL) await run('bash', ['scripts/test-db.sh', 'reset'], root);
    console.log('· Building the app…');
    await run('pnpm', ['exec', 'next', 'build'], web);
    server = spawn('pnpm', ['exec', 'next', 'start', '-p', String(PORT)], {
      cwd: web,
      stdio: 'ignore',
      env: { ...process.env, ...ENVIRONMENT },
    });
    await waitForServer(origin);
  }

  const guard = new ScopeGuard({
    allowedHosts: [new URL(origin).hostname],
    exclusions: [],
    ceiling: { ...DEFAULT_CEILING, maxRequestsPerMinute: 600, maxTotalRequests: 2000 },
    allowPrivateNetworkForTesting: true,
  });

  // Both widths. A page is built at the width its author had open, and the
  // breakpoints underneath it are where a type scale quietly acquires three
  // more sizes. Most people will see the narrow one.
  const WIDTHS = [
    { label: 'desktop', viewport: DESKTOP_VIEWPORT },
    { label: 'phone', viewport: MOBILE_VIEWPORT },
  ];

  let clean = 0;
  let surveyed = 0;
  try {
    for (const page of PAGES) {
      for (const width of WIDTHS) {
        const session = new BrowserSession(guard, new EvidenceStore(page), {
          viewport: width.viewport,
        });
        await session.open();
        try {
          const measurements = await measureDesign(session, `${origin}${page}`);
          const findings = designFindings(measurements, ['survey']);
          surveyed += 1;
          if (findings.length === 0) {
            clean += 1;
            console.log(`\n✓ ${page} at ${width.label}`);
            continue;
          }
          console.log(`\n${page} at ${width.label}`);
          for (const finding of findings) {
            console.log(`  · ${finding.title}`);
            // The numbers are the whole point of an objective eye — a title
            // alone says a page is wrong and leaves somebody hunting for where.
            if (why) console.log(`    ${finding.description}\n`);
          }
        } finally {
          await session.close();
        }
      }
    }
  } finally {
    server?.kill('SIGTERM');
  }

  console.log(
    `\n${clean} of ${surveyed} page-widths had nothing to say about them.\n` +
      '  This counts pieces. It says nothing about whether the result is good.',
  );
}

await main();
