/**
 * The static intake stage, against the repositories that break a file walk.
 *
 * This stage is the one place the engine reads somebody else's directory with
 * our own process's privileges, and a repository is customer input. The tests
 * here are about what the walk refuses to do — follow a link out of the
 * directory, recurse into itself, open something that is not a file — and about
 * the stage saying what it did not cover rather than reporting a narrow scan as
 * a clean one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CostMeter,
  DEFAULT_CEILING,
  EvidenceStore,
  ScopeGuard,
  staticIntakeStage,
  type StageContext,
  type StageResult,
} from '../packages/engine/src/index.ts';

const temporaries: string[] = [];
const sockets: Server[] = [];

/** A fabricated key shaped like the real thing, assembled so the scanner over our own repository does not match it. */
const FABRICATED_STRIPE_KEY = `${'sk'}_live_${'51ZZZZZZZZZZZZZZZZZZZ'}`;

function makeRepo(name: string): string {
  const path = mkdtempSync(join(tmpdir(), `vibefycode-static-${name}-`));
  temporaries.push(path);
  return path;
}

async function runAgainst(repositoryPath: string | null): Promise<StageResult> {
  const context: StageContext = {
    assessmentId: 'assessment-static-intake',
    depth: 'full',
    guard: new ScopeGuard({
      allowedHosts: ['example.test'],
      exclusions: [],
      ceiling: DEFAULT_CEILING,
    }),
    meter: new CostMeter({ maxRunCostUsd: 1 }),
    evidence: new EvidenceStore('assessment-static-intake'),
    model: null as never, // this stage runs no model
    log: () => undefined,
    target: {
      appId: 'app-static',
      organisationId: 'org-static',
      appName: 'Kettle',
      appType: 'web_url',
      primaryUrl: 'https://example.test',
      repositoryPath,
      intendedForAppStore: false,
      isGame: false,
      hasAuthentication: true,
      hasPayments: false,
      processesPersonalData: false,
      description: 'A shop that sells kettles.',
    },
  };
  return staticIntakeStage.run(context);
}

afterAll(async () => {
  for (const server of sockets) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const path of temporaries) rmSync(path, { recursive: true, force: true });
});

describe('the walk stays inside the repository', () => {
  let outside: string;
  let result: StageResult;

  beforeAll(async () => {
    // Somewhere the customer's repository has no business reaching: a stand-in
    // for the runner's own filesystem, holding something the scanner would
    // certainly match if it were ever read.
    outside = makeRepo('outside');
    writeFileSync(join(outside, '.env'), `ANTHROPIC_API_KEY=${'sk-ant'}-notarealkeyatall000000\n`);

    const repo = makeRepo('escape');
    writeFileSync(join(repo, 'index.js'), 'console.log("hello");\n');
    symlinkSync(outside, join(repo, 'elsewhere'));

    result = await runAgainst(repo);
  });

  it('does not follow a symbolic link that points out of the repository', () => {
    // The finding would name a path under the runner's own filesystem, and the
    // evidence artefact — which the customer receives — would carry it.
    const text = JSON.stringify(result);
    expect(text).not.toContain(outside);
    expect(result.findings.some((finding) => /credential/i.test(finding.title))).toBe(false);
  });

  it('says the link was not followed rather than leaving the gap unmentioned', () => {
    expect(result.notes.join(' ')).toMatch(/symbolic link\(s\) were not followed/i);
  });
});

describe('a repository that points at itself', () => {
  it('walks each file once instead of round and round', async () => {
    const repo = makeRepo('loop');
    mkdirSync(join(repo, 'src'));
    writeFileSync(join(repo, 'src', 'index.js'), 'console.log("hello");\n');
    symlinkSync(repo, join(repo, 'src', 'again'));
    symlinkSync('..', join(repo, 'src', 'up'));

    // Following these does terminate — the kernel refuses the path once it is
    // long enough — but only after hundreds of descents that scan the same file
    // over and over, which is both seconds of work and a file count that is a
    // fiction.
    const result = await runAgainst(repo);
    expect(result.status).toBe('succeeded');
    expect(result.notes.join(' ')).toMatch(/Analysed 1 source file\(s\)/);
  }, 20_000);
});

describe('an entry that is not a readable file', () => {
  it('is skipped without losing everything the scan had already found', async () => {
    const repo = makeRepo('socket');
    writeFileSync(join(repo, '.env'), `STRIPE_SECRET_KEY=${FABRICATED_STRIPE_KEY}\n`);

    // A unix socket named like a source file. lstat reports it, and opening it
    // fails. The stage used to collect anything that was not a directory and
    // read it with no guard, so one of these threw out of `run` and took the
    // credential above — already found — with it.
    const socketPath = join(repo, 'config.ts');
    const server = createServer();
    sockets.push(server);
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    const result = await runAgainst(repo);
    expect(result.status).toBe('succeeded');
    expect(result.findings.some((finding) => /apparent credential/i.test(finding.title))).toBe(
      true,
    );
  });
});

describe('a repository with nothing readable in it', () => {
  it('reports a failure rather than a clean result', async () => {
    const result = await runAgainst(makeRepo('empty'));

    // No findings and "succeeded" is how a clean bill of health looks. This
    // stage scanned nothing at all, which is a different statement.
    expect(result.status).toBe('failed');
    expect(result.findings).toHaveLength(0);
    expect(result.notes.join(' ')).toMatch(/absence of a scan, not a clean result/i);
  });
});

describe('the file types the scanner can actually match', () => {
  it('opens the file a private key lives in', async () => {
    const repo = makeRepo('pem');
    writeFileSync(
      join(repo, 'server.pem'),
      // Assembled at runtime, the same way the fabricated Stripe key above is:
      // the stage sees a whole private-key block, and the scanner over our own
      // repository sees a source file that has no such block in it.
      `-----BEGIN ${'RSA'} PRIVATE KEY-----\nQUJDREVG\n-----END ${'RSA'} PRIVATE KEY-----\n`,
    );

    const result = await runAgainst(repo);
    const credential = result.findings.find((finding) =>
      /apparent credential/i.test(finding.title),
    );
    expect(
      credential,
      'a .pem was never read, so the private-key pattern could not fire',
    ).toBeDefined();
    expect(credential?.description).toMatch(/private key/i);
    expect(credential?.severity).toBe('critical');
  });
});

describe('one committed .env', () => {
  it('is charged once, not once by each check that noticed it', async () => {
    const repo = makeRepo('double');
    writeFileSync(join(repo, '.env'), `STRIPE_SECRET_KEY=${FABRICATED_STRIPE_KEY}\n`);

    const result = await runAgainst(repo);
    // Both the credential scan and the hygiene check see this file. Nothing in
    // the rubric collapses two findings with the same rule id, so reporting
    // both takes the security dimension down twice for one fact.
    const security = result.findings.filter((finding) => finding.ruleId === 'SEC-04');
    expect(security).toHaveLength(1);
  });

  it('is still reported when it carries no key we recognise', async () => {
    const repo = makeRepo('bare-env');
    writeFileSync(join(repo, '.env'), 'DATABASE_HOST=localhost\n');

    const result = await runAgainst(repo);
    expect(result.findings.some((finding) => /environment file/i.test(finding.title))).toBe(true);
  });
});

describe('a dependency matched against a declared range', () => {
  it('is high confidence when the version is pinned', async () => {
    const repo = makeRepo('pinned');
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({ name: 'kettle', license: 'MIT', dependencies: { minimist: '1.2.0' } }),
    );

    const result = await runAgainst(repo);
    const advisory = result.findings.find((finding) => finding.ruleId === 'SEC-10');
    expect(advisory?.confidence).toBe('high');
  });

  it('is lowered where the range permits a fixed version too', async () => {
    const repo = makeRepo('caret');
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({ name: 'kettle', license: 'MIT', dependencies: { minimist: '^1.2.0' } }),
    );

    const result = await runAgainst(repo);
    const advisory = result.findings.find((finding) => finding.ruleId === 'SEC-10');
    // ^1.2.0 installs 1.2.8 as readily as 1.2.0, and which one is on disk is
    // decided by a lockfile this check does not read. Reporting that at high
    // confidence claims something we did not establish.
    expect(advisory?.confidence).toBe('medium');
    expect(advisory?.description).toMatch(/permits an affected version/i);
  });
});

describe('the lockfile', () => {
  it('is what the advisory match is made against, where there is one', async () => {
    // The finding used to say, in the customer's report, that it matched
    // against the ranges in package.json rather than the versions their
    // lockfile resolves — an honest sentence about a check that was guessing
    // with the answer sitting in the next file along.
    const repo = makeRepo('locked');
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({ name: 'kettle', license: 'MIT', dependencies: { minimist: '^1.2.0' } }),
    );
    writeFileSync(
      join(repo, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: { '': { name: 'kettle' }, 'node_modules/minimist': { version: '1.2.0' } },
      }),
    );

    const result = await runAgainst(repo);
    const advisory = result.findings.find((finding) => finding.ruleId === 'SEC-10');
    // A caret permits an affected version and a fixed one alike. The lockfile
    // says which is on disk, so this is certain rather than possible.
    expect(advisory?.confidence).toBe('high');
    expect(advisory?.description).toMatch(/1\.2\.0, which is what your lockfile installs/);
    expect(result.notes.join(' ')).toMatch(/Resolved package-lock\.json/);
  });

  it('clears a dependency the range would have flagged', async () => {
    // The other half, and the half that makes this worth doing: ^1.2.0 with
    // 1.2.8 installed is not affected, and saying it is at medium confidence
    // is a false alarm in somebody's report.
    const repo = makeRepo('locked-clean');
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({ name: 'kettle', license: 'MIT', dependencies: { minimist: '^1.2.0' } }),
    );
    writeFileSync(
      join(repo, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: { '': { name: 'kettle' }, 'node_modules/minimist': { version: '1.2.8' } },
      }),
    );

    const result = await runAgainst(repo);
    expect(result.findings.some((finding) => finding.ruleId === 'SEC-10')).toBe(false);
  });

  it('reads pnpm and yarn too', async () => {
    const pnpmRepo = makeRepo('pnpm');
    writeFileSync(
      join(pnpmRepo, 'package.json'),
      JSON.stringify({ name: 'kettle', license: 'MIT', dependencies: { minimist: '^1.2.0' } }),
    );
    writeFileSync(
      join(pnpmRepo, 'pnpm-lock.yaml'),
      "lockfileVersion: '9.0'\n\npackages:\n\n  minimist@1.2.0:\n    resolution: {integrity: sha512-x}\n",
    );
    expect((await runAgainst(pnpmRepo)).notes.join(' ')).toMatch(/Resolved pnpm-lock\.yaml/);

    const yarnRepo = makeRepo('yarn');
    writeFileSync(
      join(yarnRepo, 'package.json'),
      JSON.stringify({ name: 'kettle', license: 'MIT', dependencies: { minimist: '^1.2.0' } }),
    );
    writeFileSync(
      join(yarnRepo, 'yarn.lock'),
      'minimist@^1.2.0:\n  version "1.2.0"\n  resolved "https://registry.example/minimist"\n',
    );
    expect((await runAgainst(yarnRepo)).notes.join(' ')).toMatch(/Resolved yarn\.lock/);
  });
});

describe('the licence check', () => {
  it('runs on a repository that has no package.json at all', async () => {
    const repo = makeRepo('nomanifest');
    writeFileSync(join(repo, 'main.py'), 'print("hello")\n');

    const result = await runAgainst(repo);
    const licence = result.findings.find((finding) => finding.ruleId === 'PRD-04');
    expect(licence, 'a Python repository got no licence check at all').toBeDefined();
    expect(licence?.description).toMatch(/no package\.json/i);
  });

  it('accepts COPYING as the licence file it plainly is', async () => {
    const repo = makeRepo('copying');
    writeFileSync(join(repo, 'main.py'), 'print("hello")\n');
    writeFileSync(join(repo, 'COPYING'), 'GNU GENERAL PUBLIC LICENSE\n');

    const result = await runAgainst(repo);
    expect(result.findings.some((finding) => finding.ruleId === 'PRD-04')).toBe(false);
  });
});

describe('a file too large to read', () => {
  it('is counted in the notes rather than passed over in silence', async () => {
    const repo = makeRepo('large');
    writeFileSync(join(repo, 'bundle.js'), 'x'.repeat(1_100_000));
    writeFileSync(join(repo, 'index.js'), 'console.log("hello");\n');

    const result = await runAgainst(repo);
    expect(result.notes.join(' ')).toMatch(/1 file\(s\) larger than 1 MB were not read/i);
  });
});

describe('a credential-shaped string in an example file', () => {
  it('is a note, not a finding, because that is what an example file is for', async () => {
    // The comment above the check has always said an example file is not the
    // finding. It produced one anyway, at `low` — a downgrade meant to say
    // "this is not a leak". GATE-EXPOSED-SECRET carries no trigger severity, so
    // it fires on any SEC-04 whatever: a placeholder like sk_live_xxxxxxxxxxxx,
    // which is what a well-kept example file contains, capped the whole
    // assessment at 39 and blocked the badge.
    const repo = makeRepo('example-only');
    writeFileSync(join(repo, '.env.example'), `STRIPE_SECRET_KEY=${'sk'}_live_xxxxxxxxxxxx\n`);

    const result = await runAgainst(repo);
    expect(result.findings.filter((finding) => finding.ruleId === 'SEC-04')).toEqual([]);
    // Still told: a real key does sometimes get pasted into the example file.
    expect(result.notes.join(' ')).toMatch(/found in example files/i);
    expect(result.notes.join(' ')).toMatch(/\.env\.example/);
  });

  it('does not hide a real one in a real file beside it', async () => {
    const repo = makeRepo('example-and-real');
    writeFileSync(join(repo, '.env.example'), `STRIPE_SECRET_KEY=${'sk'}_live_xxxxxxxxxxxx\n`);
    writeFileSync(join(repo, '.env'), `STRIPE_SECRET_KEY=${FABRICATED_STRIPE_KEY}\n`);

    const result = await runAgainst(repo);
    const credential = result.findings.find((finding) => finding.ruleId === 'SEC-04');
    expect(credential?.severity).toBe('critical');
    // One match, not two: the example is counted in the note instead.
    expect(credential?.title).toMatch(/^1 apparent credential /);
  });
});
