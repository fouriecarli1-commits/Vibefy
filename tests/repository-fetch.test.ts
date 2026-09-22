/**
 * The repository half of an assessment, which had never run.
 *
 * `static-intake.ts` opens by calling the secret scan the single highest-value
 * check in this engine. It is built, it is tested, and the only thing it was
 * ever given was `repositoryPath: null` — a literal in the worker with nothing
 * beside it. So every paid assessment said in writing that findings about
 * secrets in source, dependency risk and licensing were outside its scope, for
 * the tier whose whole differentiator is that they are not.
 *
 * Half of this file is what it now fetches. The other half is what it refuses,
 * which matters more: a clone is the one thing in this engine that writes to
 * disk and runs another program to do it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_REPOSITORY_BYTES,
  REPOSITORY_HOSTS,
  RepositoryRefusedError,
  fetchRepository,
  repositoryUrlOrRefuse,
} from '../packages/engine/src/runtime/repository.ts';

let origin: string;
let workspace: string;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'vibefycode-origin-'));
  const source = join(workspace, 'kettle');
  mkdirSync(join(source, 'src'), { recursive: true });
  writeFileSync(
    join(source, 'package.json'),
    JSON.stringify({ name: 'kettle', version: '1.0.0', dependencies: { minimist: '1.2.0' } }),
  );
  writeFileSync(
    join(source, '.env'),
    // secret-scan-allow: assembled at runtime so our own scanner sees nothing
    `STRIPE_SECRET_KEY=${'sk'}_live_${'51ZZZZZZZZZZZZZZZZZZZ'}\n`,
  );
  writeFileSync(join(source, 'src', 'index.js'), 'console.log("hello");\n');
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: source,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Fixture',
        GIT_AUTHOR_EMAIL: 'fixture@example.test',
        GIT_COMMITTER_NAME: 'Fixture',
        GIT_COMMITTER_EMAIL: 'fixture@example.test',
      },
    });
  git('init', '--initial-branch=main', '--quiet');
  git('add', '.');
  git('commit', '--quiet', '-m', 'A shop that sells kettles');
  origin = `file://${source}`;
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('what it clones', () => {
  it('puts the repository on disk and takes it away again', async () => {
    const repository = await fetchRepository(origin, { allowLocalForTesting: true });
    try {
      expect(existsSync(join(repository.path, 'package.json'))).toBe(true);
      expect(existsSync(join(repository.path, '.env'))).toBe(true);
      expect(repository.bytes).toBeGreaterThan(0);
    } finally {
      await repository.dispose();
    }
    // Decision 008: the safest place to store a customer's source is nowhere.
    expect(existsSync(repository.path)).toBe(false);
  }, 60_000);

  it('can be disposed twice without complaining', async () => {
    const repository = await fetchRepository(origin, { allowLocalForTesting: true });
    await repository.dispose();
    await expect(repository.dispose()).resolves.toBeUndefined();
  }, 60_000);
});

describe('what it refuses', () => {
  const refusal = (url: string) => {
    try {
      repositoryUrlOrRefuse(url);
      return null;
    } catch (error) {
      return error instanceof RepositoryRefusedError ? error.reason : String(error);
    }
  };

  it('refuses a URL carrying a credential rather than stripping it', () => {
    // A credential in a URL is one somebody has already pasted somewhere it
    // will be logged. Quietly removing it would leave them believing it was
    // used, and believing it is still a secret.
    expect(refusal('https://ghp_notarealtoken@github.com/owner/repo.git')).toMatch(
      /username or a password/,
    );
    expect(refusal('https://user:pass@github.com/owner/repo')).toMatch(/username or a password/);
  });

  it('refuses anything that is not https', () => {
    expect(refusal('http://github.com/owner/repo')).toMatch(/only https/);
    expect(refusal('file:///etc')).toMatch(/only https/);
    expect(refusal('ssh://git@github.com/owner/repo')).toMatch(/only https/);
    // The local seam is a test option and cannot come from an app row.
    expect(repositoryUrlOrRefuse('file:///tmp/x', { allowLocalForTesting: true })).toContain(
      'file://',
    );
  });

  it('refuses a host that is not a forge', () => {
    expect(refusal('https://internal.example.test/owner/repo')).toMatch(/not a repository host/);
    expect(refusal('https://169.254.169.254/latest/meta-data')).toMatch(/not a repository host/);
    // And the ones it does accept are named rather than pattern-matched.
    expect(REPOSITORY_HOSTS).toContain('github.com');
    expect(REPOSITORY_HOSTS.some((host) => host.includes('*'))).toBe(false);
  });

  it('refuses a path that is not a repository', () => {
    expect(refusal('https://github.com/owner/repo/settings/secrets')).toMatch(
      /does not name a repository/,
    );
    expect(refusal('https://github.com/owner')).toMatch(/does not name a repository/);
    expect(refusal('https://github.com/owner/repo?token=x')).toMatch(/query string/);
  });

  it('accepts the shapes a customer actually pastes', () => {
    for (const url of [
      'https://github.com/owner/repo',
      'https://github.com/owner/repo.git',
      'https://gitlab.com/owner/repo/',
      'https://codeberg.org/owner/repo',
    ]) {
      expect(() => repositoryUrlOrRefuse(url), url).not.toThrow();
    }
  });

  it('refuses a repository that does not exist, without hanging', async () => {
    await expect(
      fetchRepository(`file://${join(workspace, 'nothing-here')}`, { allowLocalForTesting: true }),
    ).rejects.toBeInstanceOf(RepositoryRefusedError);
  }, 60_000);
});

describe('the bounds it clones inside', () => {
  it('has a byte cap measured while the clone runs, not after', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('packages/engine/src/runtime/repository.ts', 'utf8');
    // Measured after, a repository nobody could have meant to submit has
    // already filled the runner by the time anybody looks.
    expect(source).toMatch(/setInterval\(/);
    expect(source).toMatch(/passed \$\{Math\.round\(MAX_REPOSITORY_BYTES/);
    expect(MAX_REPOSITORY_BYTES).toBeLessThanOrEqual(1_000_000_000);
  });

  it('never lets git prompt for, or borrow, a credential', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('packages/engine/src/runtime/repository.ts', 'utf8');
    // A clone that asks for a password has found a repository we were not
    // given, and it must fail rather than reach for ours.
    expect(source).toMatch(/GIT_TERMINAL_PROMPT: '0'/);
    expect(source).toMatch(/GIT_ASKPASS: '\/bin\/false'/);
    expect(source).toMatch(/GIT_CONFIG_GLOBAL: '\/dev\/null'/);
    // Submodules are other people's repositories at other people's URLs.
    expect(source).toMatch(/--recurse-submodules=no/);
  });
});

describe('the assessment that reads it', () => {
  it('finds the committed key, which no assessment has ever done', async () => {
    // The two halves together: the clone, and the stage that has been waiting
    // for one since it was written.
    const { staticIntakeStage, CostMeter, EvidenceStore, ScopeGuard, DEFAULT_CEILING } =
      await import('../packages/engine/src/index.ts');
    const repository = await fetchRepository(origin, { allowLocalForTesting: true });
    try {
      const result = await staticIntakeStage.run({
        assessmentId: 'assessment-repo',
        depth: 'full',
        guard: new ScopeGuard({
          allowedHosts: ['example.test'],
          exclusions: [],
          ceiling: DEFAULT_CEILING,
        }),
        meter: new CostMeter({ maxRunCostUsd: 1 }),
        evidence: new EvidenceStore('assessment-repo'),
        model: null as never,
        log: () => undefined,
        target: {
          appId: 'app-repo',
          organisationId: 'org-repo',
          appName: 'Kettle',
          appType: 'web_url',
          primaryUrl: 'https://example.test',
          repositoryPath: repository.path,
          intendedForAppStore: false,
          isGame: false,
          hasAuthentication: false,
          hasPayments: true,
          processesPersonalData: false,
          description: 'A shop that sells kettles.',
        },
      });
      expect(result.status).toBe('succeeded');
      const titles = result.findings.map((finding) => finding.title).join(' | ');
      expect(titles).toMatch(/apparent credential/i);
      expect(titles).toMatch(/known advisory/i);
      // Once, not twice: the hygiene check skips a file the credential scan
      // already reported, because a committed .env carrying a key is one fact.
      expect(result.findings.filter((finding) => finding.ruleId === 'SEC-04')).toHaveLength(1);
    } finally {
      await repository.dispose();
    }
  }, 60_000);

  it('says a declared repository could not be read, rather than that none was given', async () => {
    const { staticIntakeStage, CostMeter, EvidenceStore, ScopeGuard, DEFAULT_CEILING } =
      await import('../packages/engine/src/index.ts');
    const result = await staticIntakeStage.run({
      assessmentId: 'assessment-repo-missing',
      depth: 'full',
      guard: new ScopeGuard({
        allowedHosts: ['example.test'],
        exclusions: [],
        ceiling: DEFAULT_CEILING,
      }),
      meter: new CostMeter({ maxRunCostUsd: 1 }),
      evidence: new EvidenceStore('assessment-repo-missing'),
      model: null as never,
      log: () => undefined,
      target: {
        appId: 'app-repo',
        organisationId: 'org-repo',
        appName: 'Kettle',
        appType: 'web_url',
        primaryUrl: 'https://example.test',
        repositoryPath: null,
        repositoryUnavailable: 'Repository refused: git exited 128',
        intendedForAppStore: false,
        isGame: false,
        hasAuthentication: false,
        hasPayments: false,
        processesPersonalData: false,
        description: 'A shop that sells kettles.',
      },
    });
    // One is the scope the customer chose. The other is a thing to fix, and
    // reporting it as the first would hide it.
    expect(result.status).toBe('failed');
    expect(result.notes.join(' ')).toMatch(/could not be read/i);
    expect(result.notes.join(' ')).toMatch(/not a clean result/i);
  });

  it('is fetched by the worker and deleted whatever happens', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('apps/worker/src/run-assessment.ts', 'utf8');
    expect(source).toMatch(/repositoryPath: repository\?\.path \?\? null/);
    // Decision 008. In a `finally`, so a run that throws still takes it away.
    expect(source).toMatch(/} finally \{[\s\S]{0,400}?await repository\?\.dispose\(\);/);
  });
});
