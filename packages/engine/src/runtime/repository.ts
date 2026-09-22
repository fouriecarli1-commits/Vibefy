/**
 * Fetching the repository an assessment was granted.
 *
 * `packages/engine/src/stages/static-intake.ts` opens by calling the secret
 * scan "the single highest-value check" in this engine, and it has never run
 * against a customer. The stage is built, it is tested, and the only thing it
 * was ever given was `repositoryPath: null` — a literal in the worker with no
 * note beside it. So every paid assessment said, in the report, that findings
 * about secrets in source, dependency risk and licensing were outside its
 * scope, for the tier whose whole differentiator is that they are not.
 *
 * This is the missing half. What it will and will not do:
 *
 * **Public repositories over HTTPS only.** No credentials are accepted, sent,
 * or stored — a URL carrying a username or a password is refused rather than
 * cleaned, because a credential in a URL is a credential somebody pasted
 * somewhere it will be logged. A private repository needs a short-lived,
 * narrowly-scoped token, which is its own piece of work and is not this.
 *
 * **Only the forges, and only the repository the customer declared.** The host
 * has to be one of a handful of names, and the path has to look like a
 * repository rather than an arbitrary route into one of them.
 *
 * **Bounded in time and in bytes, while it runs.** A clone is the one thing
 * here that writes to disk without asking first, so the directory is measured
 * as it grows and the process is killed if it passes the cap. A repository
 * nobody could have meant to submit does not get to fill the runner.
 *
 * **Deleted afterwards, always.** The safest place to store a customer's
 * source is nowhere, and `dispose` runs in a `finally` at the call site.
 */
import { spawn, type SpawnOptions } from 'node:child_process';
import { mkdtemp, rm, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Forges whose URLs name a repository rather than an arbitrary server. */
export const REPOSITORY_HOSTS: readonly string[] = [
  'github.com',
  'www.github.com',
  'gitlab.com',
  'www.gitlab.com',
  'bitbucket.org',
  'codeberg.org',
  'git.sr.ht',
];

/** Beyond this nobody meant to submit it, and the runner has a fixed disk. */
export const MAX_REPOSITORY_BYTES = 500_000_000;
export const CLONE_TIMEOUT_MS = 180_000;
/** How often the growing clone is measured while it runs. */
const SIZE_POLL_MS = 2_000;

export class RepositoryRefusedError extends Error {
  constructor(
    readonly url: string,
    readonly reason: string,
  ) {
    super(`Repository refused: ${reason}`);
    this.name = 'RepositoryRefusedError';
  }
}

export interface FetchedRepository {
  /** Where it was put. Inside the runner's temporary space, and nowhere else. */
  readonly path: string;
  readonly bytes: number;
  /** Deletes it. Safe to call twice, and never throws. */
  dispose(): Promise<void>;
}

export interface FetchRepositoryOptions {
  /** Local paths, for fixtures. A real app row can never set this. */
  readonly allowLocalForTesting?: boolean;
  readonly log?: (message: string, detail?: Record<string, unknown>) => void;
}

/**
 * Checks the URL names a repository we are willing to clone, and returns it in
 * the form git should be given.
 */
export function repositoryUrlOrRefuse(
  rawUrl: string,
  options: FetchRepositoryOptions = {},
): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new RepositoryRefusedError(rawUrl, 'it is not a URL');
  }

  if (options.allowLocalForTesting && url.protocol === 'file:') return url.toString();

  if (url.protocol !== 'https:') {
    throw new RepositoryRefusedError(rawUrl, 'only https is accepted');
  }
  // Refused rather than stripped. A credential in a URL is one somebody has
  // already pasted somewhere it will be logged, and quietly removing it here
  // would leave them believing it was used.
  if (url.username || url.password) {
    throw new RepositoryRefusedError(rawUrl, 'it carries a username or a password');
  }
  if (url.search || url.hash) {
    throw new RepositoryRefusedError(rawUrl, 'it carries a query string or a fragment');
  }
  if (!REPOSITORY_HOSTS.includes(url.hostname.toLowerCase())) {
    throw new RepositoryRefusedError(rawUrl, `${url.hostname} is not a repository host we clone`);
  }
  // owner/repo, and nothing that walks out of it.
  if (!/^\/[\w.-]+\/[\w.-]+?(\.git)?\/?$/.test(url.pathname) || url.pathname.includes('..')) {
    throw new RepositoryRefusedError(rawUrl, 'the path does not name a repository');
  }
  return url.toString();
}

async function directorySize(path: string): Promise<number> {
  let total = 0;
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      try {
        total += (await stat(full)).size;
      } catch {
        // Gone between reading the directory and asking about it, which a
        // clone in progress does constantly.
      }
    }
  };
  await walk(path);
  return total;
}

export async function fetchRepository(
  rawUrl: string,
  options: FetchRepositoryOptions = {},
): Promise<FetchedRepository> {
  const url = repositoryUrlOrRefuse(rawUrl, options);
  const parent = await mkdtemp(join(tmpdir(), 'vibefycode-repo-'));
  const path = join(parent, 'source');
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    await rm(parent, { recursive: true, force: true }).catch(() => undefined);
  };

  try {
    await clone(url, path, parent, options.log);
    const bytes = await directorySize(path);
    options.log?.('repository fetched', { bytes });
    return { path, bytes, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

/**
 * The environment git is given, which is the whole environment it gets.
 *
 * Nothing may prompt and nothing may reach a credential helper: a clone that
 * asks for a password has found a repository we were not given, and it must
 * fail rather than borrow ours. `HOME` points at the temporary directory so a
 * global config cannot be read either.
 */
function cloneOptions(home: string): SpawnOptions {
  // Deliberately minimal, and cast through `unknown` because of it: `apps/web`
  // pulls in Next's augmentation of ProcessEnv, which makes NODE_ENV required.
  // Git is given exactly these six variables and nothing else — handing it our
  // whole environment would hand it every secret in the runner.
  const env = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '/bin/false',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    HOME: home,
  } as unknown as NodeJS.ProcessEnv;
  return { env, stdio: ['ignore', 'ignore', 'pipe'] };
}

function clone(
  url: string,
  path: string,
  home: string,
  log?: (message: string, detail?: Record<string, unknown>) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'git',
      [
        'clone',
        '--depth',
        '1',
        '--single-branch',
        '--no-tags',
        // Submodules are other people's repositories at other people's URLs,
        // and none of them is the one the customer declared.
        '--recurse-submodules=no',
        url,
        path,
      ],
      cloneOptions(home),
    );

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-2_000);
    });

    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(sizeCheck);
      if (error) {
        child.kill('SIGKILL');
        reject(error);
      } else {
        resolve();
      }
    };

    const timer = setTimeout(
      () =>
        finish(
          new RepositoryRefusedError(
            url,
            `it was still cloning after ${CLONE_TIMEOUT_MS / 1000} seconds`,
          ),
        ),
      CLONE_TIMEOUT_MS,
    );

    // Measured while it grows rather than after it lands. A clone is the one
    // thing here that writes to disk without asking first.
    const sizeCheck = setInterval(() => {
      void directorySize(path).then((bytes) => {
        if (bytes > MAX_REPOSITORY_BYTES) {
          finish(
            new RepositoryRefusedError(
              url,
              `it passed ${Math.round(MAX_REPOSITORY_BYTES / 1_000_000)} MB while cloning`,
            ),
          );
        }
      });
    }, SIZE_POLL_MS);

    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (code === 0) {
        finish();
        return;
      }
      log?.('repository clone failed', { code, stderr: stderr.slice(-400) });
      finish(new RepositoryRefusedError(url, `git exited ${code}`));
    });
  });
}
