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
  // In `apps/web`, not at the repository root. Vercel detects the Next.js app
  // there and makes it the root directory, and it reads `vercel.json` from the
  // root directory — so a file at the repository root is silently ignored, and
  // whatever was left in the dashboard keeps applying. That is how the first
  // three deployments failed with the same error after the file was "fixed".
  const vercel = JSON.parse(read('apps/web/vercel.json')) as Record<string, unknown>;

  it('sits where Vercel actually looks for it', () => {
    expect(() => read('apps/web/vercel.json')).not.toThrow();
    // At the repository root it is read by nothing and quietly does nothing.
    expect(() => read('vercel.json')).toThrow();
  });

  it('pins an EU region, because the privacy notice says so', () => {
    // The notice is not a description of an intention; it is a statement about
    // where the data is. This is the line that makes it true.
    expect(vercel.regions).toEqual(['fra1']);
  });

  it('leaves the paths to Vercel rather than restating them', () => {
    // Learned the hard way on the first real deployment. Vercel detects the
    // Next.js app in `apps/web` and makes that the root directory; an
    // `outputDirectory` of `apps/web/.next` is then resolved *relative to it*,
    // and the build failed looking for `apps/web/apps/web/.next`. Two places
    // describing the same path is one place too many, so only the facts Vercel
    // cannot infer are stated here.
    expect(vercel.framework).toBe('nextjs');
    expect(vercel.buildCommand).toBeUndefined();
    expect(vercel.outputDirectory).toBeUndefined();
    expect(vercel.installCommand).toBeUndefined();
  });

  it('says plainly that it cannot run the assessment worker', () => {
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

describe('what the deployed page actually serves', () => {
  const layout = read('apps/web/app/layout.tsx');

  it('builds the brand assets as part of building the app', () => {
    // `apps/web/public/brand/` is generated and gitignored. Before this, the
    // build step that fills it ran only on a developer's machine — so the
    // deployed header asked for a logo that was never uploaded, and got a 404.
    // Nothing catches that: axe does not check whether an image loaded.
    const scripts = (
      JSON.parse(read('apps/web/package.json')) as { scripts: Record<string, string> }
    ).scripts;
    expect(scripts.build).toContain('brand-build');
    expect(read('.gitignore')).toContain('apps/web/public/brand/');
  });

  it('asks for a mark the brand build produces', () => {
    const requested = [...layout.matchAll(/["'](\/brand\/[\w.-]+)["']/g)].map((m) => m[1]!);
    expect(requested.length).toBeGreaterThan(0);

    const pipeline = read('tools/brand-build.mts');
    for (const path of requested) {
      const filename = path.replace('/brand/', '');
      expect(pipeline, `${filename} is requested by the layout but never built`).toContain(
        filename,
      );
    }
  });

  it('loads the brand faces rather than only naming them', () => {
    // Poppins sat in the font stack and was fetched by nothing, so every page
    // rendered in whatever the visitor's system happened to have. A font stack
    // is a wish; `next/font` is a file.
    expect(layout).toContain("from 'next/font/google'");
    expect(layout).toContain('Poppins');
    const css = read('apps/web/app/globals.css');
    expect(css).toContain('var(--font-poppins)');
    // Self-reference: `--font-mono: var(--font-mono)` resolves to nothing.
    expect(css).not.toMatch(/--font-mono:\s*var\(--font-mono\)/);
  });

  it('keeps element rules inside a layer, so utilities still win', () => {
    // Unlayered CSS beats layered CSS whatever the specificity says, and
    // Tailwind's utilities are layered. An unlayered `a { color }` silently
    // overrode every `text-*` class on a link.
    const css = read('apps/web/app/globals.css');
    const base = css.slice(css.indexOf('@layer base'));
    expect(base).toMatch(/^\s*a\s*\{/m);
  });

  it('names the label colour that belongs with the accent', () => {
    // Seven buttons hardcoded `text-white`. That was legible on the old blue
    // accent and 1.86:1 on the new teal one — a palette change should not be
    // able to make a button unreadable.
    const css = read('apps/web/app/globals.css');
    expect(css).toContain('--color-on-accent');
    for (const file of [
      'apps/web/app/page.tsx',
      'apps/web/app/verify/page.tsx',
      'apps/web/components/action-form.tsx',
      'apps/web/components/auth-form.tsx',
    ]) {
      expect(read(file), `${file} still hardcodes a button label colour`).not.toMatch(
        /bg-accent[^"']*text-white/,
      );
    }
  });
});

describe('dark is the product, not a preference', () => {
  // Lower-cased: the generator writes the hex as it appears in tokens.json and
  // Prettier normalises it afterwards, so the test should not care which ran last.
  const tokensCss = read('apps/web/app/tokens.css').toLowerCase();

  it('serves the dark palette to everyone, not only to dark-mode machines', () => {
    const root = tokensCss.slice(tokensCss.indexOf(':root {'), tokensCss.indexOf('}'));
    expect(root).toContain('--vibefycode-surface: #070b1a');
    // The rule, not the word — the generated file explains in a comment why
    // there is no such media query, and that comment is the point.
    expect(tokensCss).not.toMatch(/@media\s*\(\s*prefers-color-scheme/);
  });

  it('keeps light reachable, because a printed report needs it', () => {
    expect(tokensCss).toContain("[data-theme='light']");
    expect(tokensCss).toContain('--vibefycode-surface: #ffffff');
  });
});

describe('CI can actually start', () => {
  // Every run from the first push to 2026-08-25 failed inside eleven seconds,
  // at `pnpm/action-setup`, before one gate had spoken. The cause is a conflict
  // rather than a break: the action refuses to run when the pnpm version is
  // given twice, and `package.json` already gives it. So the repository had a
  // full CI pipeline that had never executed a line of it, and a red tick that
  // meant nothing because it had always been red.
  //
  // Asserted here rather than trusted, because the failure mode is silence: a
  // pipeline that cannot start looks exactly like a pipeline that is failing,
  // and neither looks like a pipeline that is passing.
  const workflow = read('.github/workflows/ci.yml');
  const packageJson = JSON.parse(read('package.json')) as { packageManager?: string };

  it('does not tell the setup action the pnpm version twice', () => {
    expect(packageJson.packageManager).toMatch(/^pnpm@/);

    const setupBlocks = workflow.split('pnpm/action-setup').slice(1);
    expect(setupBlocks.length).toBeGreaterThan(0);
    for (const block of setupBlocks) {
      // Only the block's own inputs — up to the next step in the list.
      const inputs = block.slice(0, block.indexOf('\n      - '));
      expect(inputs).not.toContain('version:');
    }
  });

  it('runs every gate `pnpm verify` runs, so local green and CI green agree', () => {
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> })
      .scripts;
    const verify = scripts.verify ?? '';
    expect(verify, 'package.json has no `verify` script').not.toBe('');
    for (const gate of verify.split('&&').map((part) => part.trim())) {
      expect(workflow, `${gate} is in pnpm verify but not in CI`).toContain(gate);
    }
  });
});

describe('CI installs what the tests actually need', () => {
  const workflow = read('.github/workflows/ci.yml');

  it('installs a browser in every job that runs the suite', () => {
    // The engine drives Chromium and the report renders a PDF through it. On a
    // machine without the browser those stages fail, and what surfaces is three
    // assertions that look unrelated: a narrative field that is undefined, a
    // stage count one short, and a launch error. Cheaper to assert the install.
    const jobs = workflow.split(/^  \w[\w-]*:$/m).filter((job) => job.includes('pnpm test'));
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      expect(job).toContain('playwright install');
    }
  });
});

describe('the worker can be deployed', () => {
  // The engine drives a browser for the minutes an assessment takes, which no
  // serverless function on any plan can hold open. So the worker runs somewhere
  // that keeps a process alive, and how to put it there lives in the repository
  // rather than in somebody's head — the same reason `vercel.json` does.
  const dockerfile = read('apps/worker/Dockerfile');
  const renderConfig = read('render.yaml');
  const workerPackage = JSON.parse(read('apps/worker/package.json')) as {
    dependencies: Record<string, string>;
    scripts: Record<string, string>;
  };

  it('pins the browser image to the Playwright version the worker depends on', () => {
    // A mismatch here is a launch failure naming a missing shared library, at
    // deploy time, on a machine nobody can attach a debugger to. Cheap to assert.
    const pinned = workerPackage.dependencies.playwright;
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
    expect(dockerfile).toContain(`mcr.microsoft.com/playwright:v${pinned}`);
  });

  it('installs from the lockfile rather than resolving afresh', () => {
    expect(dockerfile).toContain('--frozen-lockfile');
  });

  it('tells Playwright where the browsers are', () => {
    // The base image puts them here. Without it Playwright looks under the home
    // directory of whichever user the platform runs as, and finds nothing.
    expect(dockerfile).toContain('PLAYWRIGHT_BROWSERS_PATH=/ms-playwright');
  });

  it('runs the worker as the worker package defines it', () => {
    expect(workerPackage.scripts.start).toBeTruthy();
    expect(dockerfile).toContain('--filter", "@vibefycode/worker", "start');
  });

  it('copies every workspace manifest, because pnpm needs the whole graph', () => {
    // A missing one fails the install with a message about an unresolvable
    // workspace link, which reads like a dependency problem and is a COPY.
    for (const app of ['apps/worker', 'apps/web', 'apps/mobile']) {
      expect(dockerfile, app).toContain(`${app}/package.json`);
    }
    expect(dockerfile).toContain('COPY packages');
  });

  it('is a worker rather than a web service', () => {
    // Nothing calls it over HTTP: it claims from the queue and runs sweeps on a
    // timer. A public port would be attack surface with no use.
    expect(renderConfig).toContain('type: worker');
    expect(renderConfig).not.toMatch(/type:\s*web/);
  });

  it('carries no secret values, only their names', () => {
    // This file is in the repository. `pnpm check:secrets` would fail the build
    // on a credential in the tree, and this says the same thing one layer up.
    for (const key of ['SUPABASE_DB_URL', 'ANTHROPIC_API_KEY', 'RESEND_API_KEY']) {
      expect(renderConfig).toContain(key);
    }
    for (const line of renderConfig.split('\n')) {
      expect(line, line).not.toMatch(/^\s*value:/);
    }
    expect(renderConfig).toContain('sync: false');
  });

  it('names the environment variables the worker actually reads', () => {
    // A deploy config that names a variable nothing reads is a variable somebody
    // will spend an afternoon setting correctly for no effect.
    const worker = read('apps/worker/src/main.ts');
    expect(worker).toContain('SUPABASE_DB_URL');
    expect(renderConfig).toContain('VIBEFYCODE_BADGE_SIGNING_KEY_B64');
  });
});
