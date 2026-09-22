/**
 * Static intake analysis.
 *
 * Runs over the repository, where the tier includes source. No model, no
 * network: everything here is derived from files on disk, which makes it the
 * cheapest stage and the one whose findings are hardest to argue with.
 *
 * The single highest-value check is the secret scan. A live key committed to a
 * repository is the most common serious defect in this class of application, and
 * it stays exploitable after the file is deleted — so the remediation always
 * leads with rotation, never with "remove the file".
 *
 * Two things this stage has to be careful about, because the repository is
 * somebody else's and we are reading it with our own process's privileges:
 *
 *  - It walks with `lstat` and never follows a symbolic link. A link is a
 *    pointer to anywhere, including out of the repository and into the runner's
 *    own filesystem, or back at an ancestor of itself.
 *  - No single unreadable file may end the stage. It used to: one `readFileSync`
 *    that threw took the secret scan, the dependency check, the licence check
 *    and everything already found with it.
 *
 * Where coverage is narrower than the whole tree — files too large to read,
 * links not followed, directories we could not open — the stage says so in its
 * notes. A count of what was analysed, with no mention of what was not, reads
 * like a statement about the whole repository.
 */
import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import advisoryData from '../data/advisories.json' with { type: 'json' };
import type { RawFinding, Stage, StageContext, StageResult } from './types.ts';

interface Advisory {
  package: string;
  vulnerable: string;
  severity: string;
  id: string;
  summary: string;
}

const ADVISORIES = advisoryData.advisories as Advisory[];

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'out',
  'coverage',
  'vendor',
  '.venv',
  '__pycache__',
]);
const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.env',
  '.yml',
  '.yaml',
  '.py',
  '.rb',
  '.go',
  '.php',
  '.java',
  '.sh',
  '.sql',
  '.html',
  '.svelte',
  '.vue',
  '.toml',
  '.ini',
  '.txt',
  '.md',
  // Mobile and desktop sources, because store readiness is part of what we
  // assess and a key hard-coded into a Swift or Kotlin file is the same defect
  // as one hard-coded into a route handler.
  '.swift',
  '.kt',
  '.kts',
  '.gradle',
  '.dart',
  '.cs',
  '.rs',
  '.c',
  '.cpp',
  '.h',
  '.xml',
  '.plist',
  '.properties',
  '.conf',
  '.cfg',
  '.tf',
  '.tfvars',
  // Key material. The private-key pattern below is the highest-severity thing
  // this scanner knows how to find, and until these were listed it could not
  // fire on the file types that actually carry one.
  '.pem',
  '.key',
  '.crt',
  '.cer',
  '.p8',
  '.asc',
]);
/** Files whose whole name is the signal; `extname` gives these nothing to match on. */
const SCANNED_FILENAMES = new Set([
  'Dockerfile',
  'Procfile',
  '.npmrc',
  '.netrc',
  '.pgpass',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
]);
const MAX_FILE_BYTES = 1_000_000;
/**
 * A ceiling on how many files one walk will collect. A repository is customer
 * input; without a ceiling a very large or generated tree turns the cheapest
 * stage into the longest one.
 */
const MAX_FILES = 20_000;

/**
 * Credential shapes specific enough that a match is a live key rather than a
 * false alarm. Deliberately the same list the scanner over our own repository
 * uses — we hold ourselves to the standard we score customers against.
 */
const CREDENTIAL_PATTERNS: readonly {
  pattern: RegExp;
  label: string;
  severity: RawFinding['severity'];
}[] = [
  { pattern: /sk-ant-[A-Za-z0-9_-]{16,}/, label: 'an Anthropic API key', severity: 'critical' },
  {
    pattern: /\b[rs]k_live_[A-Za-z0-9]{12,}\b/,
    label: 'a Stripe live secret key',
    severity: 'critical',
  },
  {
    pattern: /\b[rs]k_test_[A-Za-z0-9]{12,}\b/,
    label: 'a Stripe test secret key',
    severity: 'medium',
  },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/, label: 'an AWS access key id', severity: 'critical' },
  { pattern: /\bAIza[0-9A-Za-z_-]{35}\b/, label: 'a Google API key', severity: 'high' },
  {
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/,
    label: 'a GitHub token',
    severity: 'critical',
  },
  {
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
    label: 'a private key',
    severity: 'critical',
  },
  {
    pattern: /postgres(?:ql)?:\/\/[^\s:@/]+:(?!password@|postgres@)[^\s:@/]{6,}@/,
    label: 'a database connection string with a password',
    severity: 'critical',
  },
  { pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, label: 'a Slack token', severity: 'high' },
];

/** Licences that make a dependency a commercial problem rather than a technical one. */
const COPYLEFT = ['gpl-3.0', 'gpl-2.0', 'agpl-3.0', 'agpl', 'sspl'];

const LICENCE_FILENAMES = [
  'LICENSE',
  'LICENCE',
  'LICENSE.md',
  'LICENCE.md',
  'LICENSE.txt',
  'LICENCE.txt',
  'COPYING',
];

export const staticIntakeStage: Stage = {
  id: 'static_intake',

  appliesTo(context) {
    return Boolean(context.target.repositoryPath);
  },

  async run(context): Promise<StageResult> {
    const root = context.target.repositoryPath;
    if (!root || !existsSync(root)) {
      return {
        stage: 'static_intake',
        status: 'skipped',
        findings: [],
        notes: [
          'No repository was provided, so static analysis did not run. Findings about secrets in source, dependency risk and licensing are outside the scope of this assessment.',
        ],
      };
    }

    const startedAt = Date.now();
    const findings: RawFinding[] = [];
    const notes: string[] = [];
    const walked = walk(root);
    const files = walked.files;

    notes.push(`Analysed ${files.length} source file(s).`);
    const gap = coverageGap(walked);
    if (gap) notes.push(gap);

    if (files.length === 0) {
      context.meter.recordCompute('static_intake', (Date.now() - startedAt) / 1000);
      return {
        stage: 'static_intake',
        status: 'failed',
        findings: [],
        notes: [
          ...notes,
          'No readable file was found under the repository path, so nothing was scanned. No findings here is the absence of a scan, not a clean result.',
        ],
      };
    }

    const credentials = scanForCredentials(root, files, context);
    findings.push(...credentials.findings);
    if (credentials.unreadable.length > 0) {
      notes.push(
        `${credentials.unreadable.length} file(s) could not be opened and were not scanned` +
          `${credentials.unreadable.length <= 5 ? `: ${credentials.unreadable.join(', ')}` : ''}.`,
      );
    }

    findings.push(...checkDependencies(root, context, notes));
    findings.push(...checkLicence(root, context, notes));
    findings.push(...checkIgnoreHygiene(root, files, context, credentials.filesWithHits));

    context.meter.recordCompute('static_intake', (Date.now() - startedAt) / 1000);

    // Every file we collected turned out to be unopenable: the checks below ran
    // over nothing, and saying "succeeded" would present that as a clean read.
    if (credentials.unreadable.length === files.length) {
      return {
        stage: 'static_intake',
        status: 'failed',
        findings,
        notes: [
          ...notes,
          'Every file found under the repository path failed to open, so the secret scan read nothing.',
        ],
      };
    }

    return { stage: 'static_intake', status: 'succeeded', findings, notes };
  },
};

interface Walk {
  readonly files: string[];
  /** Counted, never followed. A link can point out of the repository, or at itself. */
  readonly symlinks: number;
  readonly tooLarge: number;
  readonly unreadableDirectories: number;
  readonly truncated: boolean;
}

function walk(root: string): Walk {
  const files: string[] = [];
  let symlinks = 0;
  let tooLarge = 0;
  let unreadableDirectories = 0;
  let truncated = false;

  const visit = (dir: string): void => {
    if (truncated) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      unreadableDirectories += 1;
      return;
    }
    for (const entry of entries) {
      if (truncated) return;
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      let stats;
      try {
        // lstat, never stat. `stat` resolves the link, so a repository
        // containing `everything -> /` would have walked us through the
        // runner's own filesystem, and `loop -> ..` would have walked for ever.
        stats = lstatSync(full);
      } catch {
        continue;
      }
      if (stats.isSymbolicLink()) {
        symlinks += 1;
        continue;
      }
      if (stats.isDirectory()) {
        visit(full);
        continue;
      }
      if (!stats.isFile() || !scannable(entry)) continue;
      if (stats.size > MAX_FILE_BYTES) {
        tooLarge += 1;
        continue;
      }
      files.push(full);
      if (files.length >= MAX_FILES) truncated = true;
    }
  };

  visit(root);
  return { files, symlinks, tooLarge, unreadableDirectories, truncated };
}

function scannable(name: string): boolean {
  if (name.startsWith('.env')) return true;
  if (SCANNED_FILENAMES.has(name)) return true;
  return TEXT_EXTENSIONS.has(extname(name).toLowerCase());
}

/**
 * What the walk did not look at, in one sentence, or null where it looked at
 * everything. The file count on its own reads as a statement about the whole
 * repository, and a secret in a file we never opened is still a secret.
 */
function coverageGap(walked: Walk): string | null {
  const clauses: string[] = [];
  if (walked.tooLarge > 0) {
    clauses.push(`${walked.tooLarge} file(s) larger than 1 MB were not read`);
  }
  if (walked.symlinks > 0) {
    clauses.push(
      `${walked.symlinks} symbolic link(s) were not followed, because a link can point outside the repository`,
    );
  }
  if (walked.unreadableDirectories > 0) {
    clauses.push(`${walked.unreadableDirectories} director(y/ies) could not be opened`);
  }
  if (walked.truncated) {
    clauses.push(`the walk stopped at ${MAX_FILES} files`);
  }
  if (clauses.length === 0) return null;
  return `Not everything was covered: ${clauses.join('; ')}. Nothing in them was scanned, which is not evidence that there was nothing there.`;
}

interface CredentialScan {
  readonly findings: RawFinding[];
  /** Paths that could not be opened, so that the notes can say the scan was short. */
  readonly unreadable: string[];
  /** Paths that produced a hit, so hygiene does not charge for the same file twice. */
  readonly filesWithHits: ReadonlySet<string>;
}

function scanForCredentials(root: string, files: string[], context: StageContext): CredentialScan {
  const hits: { file: string; line: number; label: string; severity: RawFinding['severity'] }[] =
    [];
  const unreadable: string[] = [];
  const filesWithHits = new Set<string>();

  for (const file of files) {
    const relativePath = relative(root, file);
    // A committed .env is itself the finding; an example file is not.
    const isExample = /\.example$|\.sample$|\.template$/.test(relativePath);
    let contents: string;
    try {
      contents = readFileSync(file, 'utf8');
    } catch {
      // One file we cannot open is not a reason to lose every other file. This
      // used to throw out of the stage, taking the whole static analysis with
      // it — including credentials already found.
      unreadable.push(relativePath);
      continue;
    }
    contents.split('\n').forEach((line, index) => {
      for (const { pattern, label, severity } of CREDENTIAL_PATTERNS) {
        if (pattern.test(line)) {
          hits.push({
            file: relativePath,
            line: index + 1,
            label,
            severity: isExample ? 'low' : severity,
          });
          filesWithHits.add(relativePath);
        }
      }
    });
  }

  if (hits.length === 0) return { findings: [], unreadable, filesWithHits };

  const worst = hits.reduce((current, hit) =>
    rank(hit.severity) > rank(current.severity) ? hit : current,
  );
  const artefact = context.evidence.capture({
    kind: 'dependency_report',
    summary: `Credential scan over the repository — ${hits.length} match(es)`,
    body: {
      // Locations only. The values themselves are never written to an artefact,
      // because that would move the leak into our systems.
      matches: hits.map((hit) => ({
        file: hit.file,
        line: hit.line,
        kind: hit.label,
        severity: hit.severity,
      })),
    },
  });

  return {
    unreadable,
    filesWithHits,
    findings: [
      {
        ruleId: 'SEC-04',
        dimension: 'security_posture',
        severity: worst.severity,
        confidence: 'high',
        title: `${hits.length} apparent credential${hits.length === 1 ? '' : 's'} committed to the repository`,
        description: `The scan matched ${hits.length} credential-shaped string(s), including ${worst.label} at ${worst.file}:${worst.line}. Anything committed to a repository stays in its history after the file is deleted, and is readable by anyone who has ever had access to a clone.`,
        remediation:
          'Rotate every matched credential first — a deleted commit is not a rotated key. Then move the values to environment variables held by your host, add the files to .gitignore, and consider rewriting history if the repository was ever public.',
        evidenceIds: [artefact.id],
      },
    ],
  };
}

function checkDependencies(root: string, context: StageContext, notes: string[]): RawFinding[] {
  const manifestPath = join(root, 'package.json');
  if (!existsSync(manifestPath)) {
    notes.push('No package.json was found, so the dependency check did not run.');
    return [];
  }

  let manifest: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    notes.push('package.json could not be read or parsed, so the dependency check did not run.');
    return [];
  }

  const declared = { ...manifest.dependencies, ...manifest.devDependencies };
  const matched: { name: string; declared: string; advisory: Advisory; pinned: boolean }[] = [];

  for (const [name, range] of Object.entries(declared)) {
    for (const advisory of ADVISORIES) {
      if (advisory.package === name && permitsVulnerable(range, advisory.vulnerable)) {
        matched.push({ name, declared: range, advisory, pinned: isPinned(range) });
      }
    }
  }

  const artefact = context.evidence.capture({
    kind: 'dependency_report',
    summary: `Dependency manifest — ${Object.keys(declared).length} declared, ${matched.length} matched a known advisory`,
    body: {
      declared,
      matched,
      coverage:
        'Matched against a curated high-confidence advisory set, not a complete vulnerability feed. Absence of a match here is not evidence that a dependency is unaffected. Matching is against the range declared in package.json; the lockfile, which decides the version actually installed, is not read.',
      source: advisoryData.source,
    },
  });

  if (matched.length === 0) {
    notes.push(
      `No dependency matched the curated advisory set. That set is deliberately narrow — it is not a full audit, and a clean result here does not mean the dependency tree is clear.`,
    );
    return [];
  }

  const worst = matched.some((entry) => entry.advisory.severity === 'critical')
    ? 'critical'
    : 'high';
  // A pinned version that sits inside an advisory's range is affected. A caret
  // or tilde range permits an affected version and a fixed one alike, and which
  // is installed is decided by a lockfile this check does not read — so a match
  // on a range is reported as what it is, at lower confidence.
  const allPinned = matched.every((entry) => entry.pinned);
  return [
    {
      ruleId: 'SEC-10',
      dimension: 'security_posture',
      severity: worst,
      confidence: allPinned ? 'high' : 'medium',
      title: `${matched.length} dependenc${matched.length === 1 ? 'y' : 'ies'} declared at a version with a known advisory`,
      description: `${matched
        .map(
          (entry) =>
            `${entry.name}@${entry.declared}${
              entry.pinned ? '' : ', a range that permits an affected version,'
            } (${entry.advisory.id}: ${entry.advisory.summary})`,
        )
        .join(
          '; ',
        )}. These were matched against a curated advisory set rather than a complete feed, and against the ranges in package.json rather than the versions your lockfile resolves, so this is a floor, not a full audit.`,
      remediation: `Upgrade ${matched.map((entry) => entry.name).join(', ')} past the affected range, then run your package manager's own audit command for the dependencies this curated set does not cover.`,
      evidenceIds: [artefact.id],
    },
  ];
}

/**
 * Whether the declared range permits a version inside the advisory's affected
 * range.
 *
 * It is not a claim that the installed version is affected. The old name said
 * "satisfies", and the old comment said it "only flags when the declared range
 * clearly sits inside the affected one", which was not true of the ranges people
 * actually write: `^1.2.3` permits 1.2.3 and 1.9.0 alike. Whether it flags is
 * unchanged; what the finding says about the match is what changed.
 */
function permitsVulnerable(declaredRange: string, vulnerableRange: string): boolean {
  const bound = /^<\s*(\d+)\.(\d+)\.(\d+)/.exec(vulnerableRange);
  const declared = /(\d+)\.(\d+)\.(\d+)/.exec(declaredRange);
  if (!bound || !declared) return false;
  const toNumber = (match: RegExpExecArray) =>
    Number(match[1]) * 1_000_000 + Number(match[2]) * 1_000 + Number(match[3]);
  return toNumber(declared) < toNumber(bound);
}

/** True where the declared range names one version and no other. */
function isPinned(declaredRange: string): boolean {
  return /^v?=?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(declaredRange.trim());
}

function readDeclaredLicence(manifestPath: string): { licence: string | null; readable: boolean } {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { license?: unknown };
    return {
      licence: typeof manifest.license === 'string' ? manifest.license : null,
      readable: true,
    };
  } catch {
    return { licence: null, readable: false };
  }
}

function isCopyleft(licence: string): boolean {
  const lowered = licence.toLowerCase();
  return COPYLEFT.some((candidate) => lowered.includes(candidate));
}

function checkLicence(root: string, context: StageContext, notes: string[]): RawFinding[] {
  const manifestPath = join(root, 'package.json');
  const manifestPresent = existsSync(manifestPath);
  const { licence: declaredLicence, readable: manifestReadable } = manifestPresent
    ? readDeclaredLicence(manifestPath)
    : { licence: null, readable: true };

  const licenceFile = LICENCE_FILENAMES.find((name) => existsSync(join(root, name)));

  if (declaredLicence !== null && isCopyleft(declaredLicence)) {
    const artefact = context.evidence.capture({
      kind: 'dependency_report',
      summary: 'Declared licence',
      body: { license: declaredLicence },
    });
    return [
      {
        ruleId: 'PRD-04',
        dimension: 'production_readiness',
        severity: 'info',
        confidence: 'high',
        title: `The project declares a copyleft licence (${declaredLicence})`,
        description: `package.json declares "${declaredLicence}". That is a legitimate choice, but it carries obligations for anyone distributing the software, and it is worth confirming it is the choice you meant to make.`,
        remediation:
          'Confirm the licence is intentional and compatible with how you plan to distribute the application.',
        evidenceIds: [artefact.id],
      },
    ];
  }

  if (declaredLicence !== null || licenceFile !== undefined) return [];

  // A manifest we could not parse might have declared one. Saying "no licence is
  // declared" on the strength of a file we failed to read would be asserting
  // something we did not establish.
  if (!manifestReadable) {
    notes.push(
      'package.json could not be read or parsed, so whether a licence is declared could not be established. No licence file was found beside it.',
    );
    return [];
  }

  const artefact = context.evidence.capture({
    kind: 'dependency_report',
    summary: 'No licence declared',
    body: { license: null, licenceFilePresent: false, manifestPresent },
  });
  return [
    {
      ruleId: 'PRD-04',
      dimension: 'production_readiness',
      severity: 'info',
      confidence: 'high',
      title: 'No licence is declared',
      description: manifestPresent
        ? 'The repository declares no licence in package.json and carries no LICENSE file. Without one, others have no permission to use the code, and contributors have no clarity about what they are agreeing to.'
        : 'The repository carries no LICENSE file, and no package.json in which a licence might be declared. Without one, others have no permission to use the code, and contributors have no clarity about what they are agreeing to.',
      remediation: manifestPresent
        ? 'Add a LICENSE file and a "license" field to package.json.'
        : 'Add a LICENSE file at the root of the repository.',
      evidenceIds: [artefact.id],
    },
  ];
}

function checkIgnoreHygiene(
  root: string,
  files: string[],
  context: StageContext,
  alreadyCharged: ReadonlySet<string>,
): RawFinding[] {
  const committedEnv = files
    .map((file) => relative(root, file))
    .filter((path) => /(^|\/)\.env(\.|$)/.test(path) && !/\.(example|sample|template)$/.test(path))
    // A file the credential scan already reported is one fact, not two. Listing
    // it here as well would penalise the same .env twice in the same dimension.
    .filter((path) => !alreadyCharged.has(path));

  if (committedEnv.length === 0) return [];

  const artefact = context.evidence.capture({
    kind: 'dependency_report',
    summary: 'Environment files present in the repository',
    body: { files: committedEnv },
  });

  return [
    {
      ruleId: 'SEC-04',
      dimension: 'security_posture',
      severity: 'high',
      confidence: 'high',
      title: `${committedEnv.length} environment file${committedEnv.length === 1 ? '' : 's'} present in the repository`,
      description: `${committedEnv.join(', ')} ${committedEnv.length === 1 ? 'is' : 'are'} present in the repository directory that was analysed. Environment files are where credentials live, and anything that was ever committed stays in the history after the file is deleted.`,
      remediation:
        'Add .env and .env.* to .gitignore, remove the files from the working tree, and rotate anything they contained. Keep a .env.example with the keys but no values.',
      evidenceIds: [artefact.id],
    },
  ];
}

function rank(severity: RawFinding['severity']): number {
  return ['info', 'low', 'medium', 'high', 'critical'].indexOf(severity);
}
