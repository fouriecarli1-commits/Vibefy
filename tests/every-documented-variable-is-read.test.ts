/**
 * Every variable we tell somebody to set is read by something.
 *
 * The founder set `NEXT_PUBLIC_SITE_HOST=vibefycode.com` on Vercel. Nothing in
 * this codebase reads that name, so it did nothing and said nothing — the
 * console kept working off the request origin, and the worker would have issued
 * badges and skipped every announcement email with one line in a log nobody was
 * watching. A name that does not exist is the quietest kind of misconfiguration
 * there is: no error, no warning, no absent feature, just a setting that isn't.
 *
 * That was a wrong name for a variable that exists. Going the other way turned
 * up twelve of the reverse — names in `.env.example`, and two of them in the
 * deployment table of the runbook, that nothing in `apps`, `packages`, `tools`
 * or `scripts` reads. Somebody following our own instructions would set them,
 * get nothing, and have no way to tell which of their settings were real.
 *
 * Four of those twelve were the spend ceilings the build brief calls hard
 * ceilings against a runaway agent loop, presented as environment variables. The
 * ceilings are enforced — from `config/pricing.json`, through
 * `packages/governance/src/spend.ts` — so this was documentation contradicting
 * working code rather than a missing control. Which is exactly why it needed
 * measuring rather than reading: the file looked like the answer.
 *
 * So a variable in `.env.example` is either read by code, or listed below with
 * the reason it is there anyway. Adding one silently is the failure this test
 * exists to prevent, in both directions: an unread name and an unexplained one.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

/**
 * Names that appear in `.env.example` and are deliberately not read by any code
 * in this repository, each with the reason.
 *
 * A reason is required, and it has to say where the behaviour actually comes
 * from. "Not used yet" is not a reason; it is the thing this test is about.
 */
const NOT_READ_BY_CODE: Readonly<Record<string, string>> = {
  VIBEFYCODE_JURISDICTION:
    'The legal copy has one baseline, and tools/legal-registry.mjs writes it as `jurisdictionBaseline: "gdpr"`. The swap layer the brief asks for is not built, so setting this changes nothing. Kept in the file because the variable is the shape that layer will take.',
  VIBEFYCODE_MAX_COST_PER_RUN_USD:
    'A ceiling, and it is enforced — from config/pricing.json via packages/governance/src/spend.ts, not from the environment. Kept as documentation of the ceiling that exists; setting it does nothing.',
  VIBEFYCODE_MAX_FREE_TIER_COST_PER_ACCOUNT_MONTH_USD:
    'Same: config/pricing.json, not the environment.',
  VIBEFYCODE_GLOBAL_DAILY_SPEND_CAP_USD: 'Same: config/pricing.json, not the environment.',
  VIBEFYCODE_FREE_TIER_WEEKLY_BUDGET_ALERT_USD: 'Same: config/pricing.json, not the environment.',
};

/** Every file the product or its tooling could plausibly read a variable from. */
function sourceFiles(): string[] {
  const roots = ['apps', 'packages', 'tools', 'scripts', 'config', '.github'];
  const found: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx|mts|mjs|js|cjs|sh|json|ya?ml)$/.test(entry)) {
        found.push(full);
      }
    }
  };
  for (const root of roots) walk(join(ROOT, root));
  found.push(join(ROOT, 'vitest.config.mts'));
  return found;
}

const HAYSTACK = sourceFiles()
  .map((file) => {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return '';
    }
  })
  .join('\n');

const DOCUMENTED = [
  ...readFileSync(join(ROOT, '.env.example'), 'utf8').matchAll(/^([A-Z][A-Z0-9_]*)=/gm),
].map((match) => match[1]!);

describe('.env.example', () => {
  it('documents something', () => {
    // Guards the guard: a regex that stopped matching would make every
    // assertion below vacuously true, which is the failure mode of a test that
    // reads a file for its subject.
    expect(DOCUMENTED.length).toBeGreaterThan(20);
    expect(DOCUMENTED).toContain('NEXT_PUBLIC_SITE_URL');
  });

  it('names no variable that nothing reads and nothing explains', () => {
    const unexplained = DOCUMENTED.filter(
      (name) => !HAYSTACK.includes(name) && NOT_READ_BY_CODE[name] === undefined,
    );
    expect(unexplained).toEqual([]);
  });

  it('explains no variable that is in fact read', () => {
    // The other direction, so an exemption cannot outlive the reason for it.
    const stale = Object.keys(NOT_READ_BY_CODE).filter((name) => HAYSTACK.includes(name));
    expect(stale).toEqual([]);
  });

  it('gives a reason that says where the behaviour comes from', () => {
    for (const [name, reason] of Object.entries(NOT_READ_BY_CODE)) {
      expect(reason.length, name).toBeGreaterThan(40);
      expect(reason, name).toMatch(/\.(json|mjs|ts)|packages\/|tools\/|config\//);
    }
  });
});

describe('the runbook’s deployment table', () => {
  it('tells nobody to set a variable that does nothing', () => {
    const runbook = readFileSync(join(ROOT, 'docs/RUNBOOK.md'), 'utf8');
    const table = /Set the environment variables[\s\S]*?\n\n(?=[0-9]\.|#|\s*Everything else)/.exec(
      runbook,
    );
    expect(table, 'the deployment table moved or was renamed').not.toBeNull();

    const named = [...(table?.[0] ?? '').matchAll(/`([A-Z][A-Z0-9_]{3,})`/g)].map((m) => m[1]!);
    expect(named.length).toBeGreaterThan(3);

    const dead = [...new Set(named)].filter(
      (name) => !HAYSTACK.includes(name) && NOT_READ_BY_CODE[name] === undefined,
    );
    expect(dead).toEqual([]);
  });
});
