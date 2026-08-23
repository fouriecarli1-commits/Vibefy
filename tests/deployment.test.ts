/**
 * The deployment can be performed by the person who owns it.
 *
 * This is not incidental. A one-person product where the deployment lives in
 * somebody's head, or in a dashboard form nobody wrote down, is a product with
 * a single point of failure that is not the code. So the settings live in the
 * repository, and the schema a fresh database needs is a file rather than a
 * seventeen-step manual procedure.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('the schema file', () => {
  it('is exactly what the migrations produce', () => {
    // The check is the real gate; running it here means a stale schema file
    // fails the test suite and not only CI.
    expect(() =>
      execFileSync('node', ['tools/build-schema.mjs', '--check'], { cwd: process.cwd() }),
    ).not.toThrow();
  });

  it('contains every migration, in order', () => {
    const schema = read('supabase/schema.sql');
    const migrations = execFileSync('ls', ['supabase/migrations'], { encoding: 'utf8' })
      .split('\n')
      .filter((name) => name.endsWith('.sql'))
      .sort();

    expect(migrations.length).toBeGreaterThan(10);
    let cursor = 0;
    for (const name of migrations) {
      const at = schema.indexOf(name, cursor);
      // Out of order is worse than missing: a table created before the type it
      // uses fails halfway, leaving a half-built database.
      expect(at, `${name} is missing or out of order in supabase/schema.sql`).toBeGreaterThan(-1);
      cursor = at;
    }
  });

  it('says it is generated, and how to regenerate it', () => {
    const schema = read('supabase/schema.sql');
    expect(schema).toContain('GENERATED FILE');
    expect(schema).toContain('pnpm schema:build');
  });

  it('carries the row-level security the migrations declare', () => {
    // A schema pasted into a fresh database without its policies is a database
    // where every tenant can read every other tenant. Cheap to assert, and the
    // consequence of it being wrong is the worst in the product.
    const schema = read('supabase/schema.sql');
    const enables = schema.match(/enable row level security/g) ?? [];
    const forces = schema.match(/force row level security/g) ?? [];
    expect(enables.length).toBeGreaterThan(20);
    expect(forces.length).toBe(enables.length);
  });
});

describe('the hosting configuration', () => {
  const vercel = JSON.parse(read('vercel.json')) as Record<string, unknown>;

  it('pins an EU region, because the privacy notice says so', () => {
    // The notice is not a description of an intention; it is a statement about
    // where the data is. This is the line that makes it true.
    expect(vercel.regions).toEqual(['fra1']);
  });

  it('builds the monorepo from the root rather than from a dashboard form', () => {
    expect(vercel.buildCommand).toBe('pnpm build');
    expect(vercel.outputDirectory).toBe('apps/web/.next');
    // Frozen: a deployment that silently resolves different dependency versions
    // than the tests ran against is a deployment nothing verified.
    expect(String(vercel.installCommand)).toContain('--frozen-lockfile');
  });

  it('builds the web app and nothing that needs a browser', () => {
    // The worker drives Chromium for minutes at a time; a serverless function
    // cannot hold one. Pretending otherwise produces assessments that hang.
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> })
      .scripts;
    expect(scripts.build).toBe('pnpm --filter @vibefycode/web build');
    expect(read('docs/RUNBOOK.md')).toContain('What this deployment cannot do');
  });
});

describe('the web app can compile the workspace it imports', () => {
  it('transpiles every package, not a subset someone kept by hand', () => {
    // The packages ship TypeScript source. One that is imported and not listed
    // fails at build time — so the list drifting behind the imports is a build
    // that breaks on the day a package is first used, not when it is added.
    const config = read('apps/web/next.config.ts');
    const declared = new Set(
      [...config.matchAll(/'(@vibefycode\/[a-z-]+)'/g)].map((match) => match[1]!),
    );
    const packages = execFileSync('ls', ['packages'], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map((name) => `@vibefycode/${name}`);

    for (const name of packages) {
      expect(declared.has(name), `${name} is missing from transpilePackages`).toBe(true);
    }
  });
});
