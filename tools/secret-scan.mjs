#!/usr/bin/env node
/**
 * Secret scanner.
 *
 * Vibefy's rubric penalises apps for hardcoded credentials. Leaking our own would end the
 * business's credibility before its first customer, so this runs in CI and as a pre-commit
 * hook. It is deliberately dependency-free: a scanner that stops working when an install
 * fails is not a scanner.
 *
 * Usage:
 *   node tools/secret-scan.mjs           scan the working tree
 *   node tools/secret-scan.mjs --staged  scan what is about to be committed
 */
import { readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, extname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const SECRET_PATTERNS = [
  { name: 'Anthropic API key', pattern: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI API key', pattern: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: 'Stripe live secret key', pattern: /\b[rs]k_live_[A-Za-z0-9]{16,}\b/ },
  { name: 'Stripe test secret key', pattern: /\b[rs]k_test_[A-Za-z0-9]{16,}\b/ },
  { name: 'Stripe webhook signing secret', pattern: /\bwhsec_[A-Za-z0-9]{16,}\b/ },
  { name: 'AWS access key id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  {
    name: 'GitHub token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  {
    name: 'Private key block',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/,
  },
  {
    name: 'JSON Web Token (Supabase service role keys look like this)',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    name: 'Postgres connection string with a password',
    pattern: /postgres(?:ql)?:\/\/[^\s:@/]+:(?!postgres@|password@)[^\s:@/]{6,}@/,
  },
  {
    name: 'Assignment of a long opaque value to a secret-looking name',
    pattern:
      /\b(?:api[_-]?key|secret|token|password|passwd|private[_-]?key|signing[_-]?key|service[_-]?role)\b\s*[:=]\s*["'`]([A-Za-z0-9+/=_-]{24,})["'`]/i,
  },
];

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.pnpm-store',
]);
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.gz',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.mp4',
]);
/** This file necessarily contains the shapes it is looking for. */
const SKIP_FILES = new Set(['tools/secret-scan.mjs', 'tools/secret-scan.test.ts']);
const MAX_BYTES = 2_000_000;

/** Placeholders that exist so a human knows what to paste. They are not secrets. */
const PLACEHOLDER =
  /^(?:|x{3,}|\.{3,}|<[^>]+>|\$\{[^}]+\}|your[-_].*|replace[-_]me|changeme|example|placeholder|dummy|test)$/i;

function gitFiles(staged) {
  // Untracked-but-not-ignored files are included deliberately: a credential in a
  // brand-new file is exactly the case where scanning only tracked files would
  // wave it through until the moment it is committed.
  const args = staged
    ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR']
    : ['ls-files', '--cached', '--others', '--exclude-standard'];
  const out = execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

/**
 * A suppression must give a reason, and may sit on the flagged line or the one
 * above it — formatters move long strings onto their own line, and a rule that
 * only reads the flagged line quietly stops working the first time that happens.
 */
function suppressed(line, previous) {
  const match =
    /secret-scan-allow:?([^\n]*)/.exec(line) ?? /secret-scan-allow:?([^\n]*)/.exec(previous);
  if (!match) return false;
  const reason = match[1]
    .replace(/(-->|\*\/)\s*$/, '')
    .replace(/^[:\s]+/, '')
    .trim();
  return reason.length > 0;
}

export function scanText(text, path = '<input>') {
  const findings = [];
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (suppressed(line, lines[index - 1] ?? '')) return;
    for (const { name, pattern } of SECRET_PATTERNS) {
      const match = pattern.exec(line);
      if (!match) continue;
      const captured = match[1] ?? match[0];
      if (PLACEHOLDER.test(captured)) continue;
      findings.push({
        path,
        line: index + 1,
        rule: name,
        // Never echo the full value into CI logs — that would publish what we just caught.
        preview: `${captured.slice(0, 6)}…${captured.slice(-3)} (${captured.length} chars)`,
      });
    }
  });
  return findings;
}

export function runSecretScan({ staged = false } = {}) {
  const findings = [];
  let scanned = 0;
  for (const file of gitFiles(staged)) {
    if (SKIP_FILES.has(file)) continue;
    if (file.split('/').some((part) => SKIP_DIRS.has(part))) continue;
    if (BINARY_EXTENSIONS.has(extname(file))) continue;
    const full = join(root, file);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue; // staged deletion
    }
    if (stats.size > MAX_BYTES) continue;
    scanned += 1;
    findings.push(...scanText(readFileSync(full, 'utf8'), relative(root, full)));
  }
  return { findings, scanned };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { findings, scanned } = runSecretScan({ staged: process.argv.includes('--staged') });
  if (findings.length > 0) {
    console.error(`\n✗ Secret scan failed — ${findings.length} potential credential(s):\n`);
    for (const f of findings) console.error(`  ${f.path}:${f.line}  [${f.rule}]  ${f.preview}`);
    console.error(
      '\nRotate the credential first, then remove it. A deleted commit is not a rotated key.',
    );
    console.error(
      'If this is a false positive, append a `secret-scan-allow` comment on that line.\n',
    );
    process.exit(1);
  }
  console.log(`✓ Secret scan passed — ${scanned} files, no credentials found.`);
}
