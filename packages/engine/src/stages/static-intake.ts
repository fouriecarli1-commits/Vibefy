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
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
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
]);
const MAX_FILE_BYTES = 1_000_000;

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
    const files = walk(root, root);

    notes.push(`Analysed ${files.length} source file(s).`);

    findings.push(...scanForCredentials(root, files, context));
    findings.push(...checkDependencies(root, context, notes));
    findings.push(...checkLicence(root, context));
    findings.push(...checkIgnoreHygiene(root, files, context));

    context.meter.recordCompute('static_intake', (Date.now() - startedAt) / 1000);

    return { stage: 'static_intake', status: 'succeeded', findings, notes };
  },
};

function walk(dir: string, root: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      walk(full, root, out);
    } else if (
      stats.size <= MAX_FILE_BYTES &&
      (TEXT_EXTENSIONS.has(extname(entry)) || entry.startsWith('.env'))
    ) {
      out.push(full);
    }
  }
  return out;
}

function scanForCredentials(root: string, files: string[], context: StageContext): RawFinding[] {
  const hits: { file: string; line: number; label: string; severity: RawFinding['severity'] }[] =
    [];

  for (const file of files) {
    const relativePath = relative(root, file);
    // A committed .env is itself the finding; an example file is not.
    const isExample = /\.example$|\.sample$|\.template$/.test(relativePath);
    const contents = readFileSync(file, 'utf8');
    contents.split('\n').forEach((line, index) => {
      for (const { pattern, label, severity } of CREDENTIAL_PATTERNS) {
        if (pattern.test(line)) {
          hits.push({
            file: relativePath,
            line: index + 1,
            label,
            severity: isExample ? 'low' : severity,
          });
        }
      }
    });
  }

  if (hits.length === 0) return [];

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

  return [
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
  ];
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
    notes.push('package.json could not be parsed, so the dependency check did not run.');
    return [];
  }

  const declared = { ...manifest.dependencies, ...manifest.devDependencies };
  const matched: { name: string; declared: string; advisory: Advisory }[] = [];

  for (const [name, range] of Object.entries(declared)) {
    for (const advisory of ADVISORIES) {
      if (advisory.package === name && satisfiesVulnerable(range, advisory.vulnerable)) {
        matched.push({ name, declared: range, advisory });
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
        'Matched against a curated high-confidence advisory set, not a complete vulnerability feed. Absence of a match here is not evidence that a dependency is unaffected.',
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
  return [
    {
      ruleId: 'SEC-10',
      dimension: 'security_posture',
      severity: worst,
      confidence: 'high',
      title: `${matched.length} dependenc${matched.length === 1 ? 'y' : 'ies'} declared at a version with a known advisory`,
      description: `${matched
        .map(
          (entry) =>
            `${entry.name}@${entry.declared} (${entry.advisory.id}: ${entry.advisory.summary})`,
        )
        .join(
          '; ',
        )}. These were matched against a curated advisory set rather than a complete feed, so this is a floor, not a full audit.`,
      remediation: `Upgrade ${matched.map((entry) => entry.name).join(', ')} past the affected range, then run your package manager's own audit command for the dependencies this curated set does not cover.`,
      evidenceIds: [artefact.id],
    },
  ];
}

/** Conservative range check: only flags when the declared range clearly sits inside the affected one. */
function satisfiesVulnerable(declaredRange: string, vulnerableRange: string): boolean {
  const bound = /^<\s*(\d+)\.(\d+)\.(\d+)/.exec(vulnerableRange);
  const declared = /(\d+)\.(\d+)\.(\d+)/.exec(declaredRange);
  if (!bound || !declared) return false;
  const toNumber = (match: RegExpExecArray) =>
    Number(match[1]) * 1_000_000 + Number(match[2]) * 1_000 + Number(match[3]);
  return toNumber(declared) < toNumber(bound);
}

function checkLicence(root: string, context: StageContext): RawFinding[] {
  const manifestPath = join(root, 'package.json');
  if (!existsSync(manifestPath)) return [];

  let manifest: { license?: string; dependencies?: Record<string, string> };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return [];
  }

  const hasLicenceFile = ['LICENSE', 'LICENCE', 'LICENSE.md', 'LICENCE.md'].some((name) =>
    existsSync(join(root, name)),
  );
  if (manifest.license || hasLicenceFile) {
    if (
      manifest.license &&
      COPYLEFT.some((licence) => manifest.license!.toLowerCase().includes(licence))
    ) {
      const artefact = context.evidence.capture({
        kind: 'dependency_report',
        summary: 'Declared licence',
        body: { license: manifest.license },
      });
      return [
        {
          ruleId: 'PRD-04',
          dimension: 'production_readiness',
          severity: 'info',
          confidence: 'high',
          title: `The project declares a copyleft licence (${manifest.license})`,
          description: `package.json declares "${manifest.license}". That is a legitimate choice, but it carries obligations for anyone distributing the software, and it is worth confirming it is the choice you meant to make.`,
          remediation:
            'Confirm the licence is intentional and compatible with how you plan to distribute the application.',
          evidenceIds: [artefact.id],
        },
      ];
    }
    return [];
  }

  const artefact = context.evidence.capture({
    kind: 'dependency_report',
    summary: 'No licence declared',
    body: { license: null, licenceFilePresent: false },
  });
  return [
    {
      ruleId: 'PRD-04',
      dimension: 'production_readiness',
      severity: 'info',
      confidence: 'high',
      title: 'No licence is declared',
      description:
        'The repository declares no licence in package.json and carries no LICENSE file. Without one, others have no permission to use the code, and contributors have no clarity about what they are agreeing to.',
      remediation: 'Add a LICENSE file and a "license" field to package.json.',
      evidenceIds: [artefact.id],
    },
  ];
}

function checkIgnoreHygiene(root: string, files: string[], context: StageContext): RawFinding[] {
  const committedEnv = files
    .map((file) => relative(root, file))
    .filter((path) => /(^|\/)\.env(\.|$)/.test(path) && !/\.(example|sample|template)$/.test(path));

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
      description: `${committedEnv.join(', ')} ${committedEnv.length === 1 ? 'is' : 'are'} in the repository. Environment files are where credentials live, and once one is committed it is in the history permanently.`,
      remediation:
        'Add .env and .env.* to .gitignore, remove the files from the working tree, and rotate anything they contained. Keep a .env.example with the keys but no values.',
      evidenceIds: [artefact.id],
    },
  ];
}

function rank(severity: RawFinding['severity']): number {
  return ['info', 'low', 'medium', 'high', 'critical'].indexOf(severity);
}
