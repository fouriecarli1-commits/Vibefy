#!/usr/bin/env node
/**
 * Copy lint — the language-discipline gate.
 *
 * "Verified by Vibefy" is defensible only because it is narrow. The moment any surface
 * says the word this file forbids, the mark stops meaning "assessed against a published
 * rubric on a date" and starts meaning "safe", which is a claim we cannot support and did
 * not sell. This gate exists so that drift is caught by CI rather than by a regulator or a
 * customer's lawyer.
 *
 * Two rule classes:
 *   1. FORBIDDEN — phrases that are never permissible anywhere. No escape hatch.
 *   2. RESTRICTED — absolute words permitted only inside a sentence that negates or scopes
 *      them ("this is not a guarantee that the application is secure"). An unavoidable
 *      exception can be marked on the preceding line with:
 *          vibefy-copy-lint-allow: <reason>
 *      The reason is mandatory; a bare suppression is itself a failure.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, extname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Surfaces whose words reach a customer, a regulator or a court. */
const SCAN_DIRS = ['apps', 'packages', 'legal', 'brand', 'supabase'];
const SCAN_FILES = ['README.md'];
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.md', '.mdx', '.sql', '.html', '.txt']);
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', 'coverage', '.git', 'source', 'png', 'icons']);
/** This file necessarily contains every forbidden phrase, and the tests assert on them. */
const SKIP_FILES = new Set(['tools/copy-lint.mjs', 'tools/copy-lint.test.ts']);

/** Never permitted. These extend the mark into a claim we do not make. */
export const FORBIDDEN_PHRASES = [
  'vibefy verified secure',
  'vibefy certified safe',
  'vibefy approved',
  'guaranteed by vibefy',
  'vibefy compliant',
  'vibefy certified secure',
  'certified secure',
  'hack-proof',
  'hackproof',
  'unhackable',
  'bank-grade security',
  'military-grade security',
  '100% secure',
  'fully secure',
  'guaranteed secure',
  'penetration tested by vibefy',
];

/**
 * The wordmark is exactly "Verified by Vibefy". Anything of the shape
 * "Vibefy <strong-adjective>" or "<strong-adjective> by Vibefy" is an extension of the mark.
 */
export const MARK_EXTENSION_PATTERN =
  /\bvibefy[\s-]+(verified|certified|approved|secure|safe|compliant|guaranteed|trusted)\b|\b(certified|approved|guaranteed|secured)\s+by\s+vibefy\b/i;

/** Absolute words that require a negation or a scope qualifier in the same sentence. */
export const RESTRICTED_WORDS = [
  'secure',
  'safe',
  'guaranteed',
  'guarantee',
  'compliant',
  'risk-free',
  'bug-free',
  'error-free',
  'approved by',
];

/** Markers that make a restricted word acceptable, because the sentence limits it. */
const QUALIFIERS = [
  'not',
  'never',
  'no ',
  'nor ',
  'cannot',
  "isn't",
  "doesn't",
  "does not",
  'without',
  'rather than',
  'instead of',
  'forbidden',
  'prohibited',
  'must not',
  'may not',
  'do not',
  'stops short of',
  'absence of',
];

function collectFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) collectFiles(full, out);
    else if (SCAN_EXTENSIONS.has(extname(entry))) out.push(full);
  }
  return out;
}

/** Split on sentence boundaries so a negation three sentences away cannot launder a claim. */
function sentencesOf(line) {
  return line.split(/(?<=[.!?;:])\s+|\s+[—–|]\s+/);
}

export function lintText(text, path = '<input>') {
  const violations = [];
  const lines = text.split('\n');

  // Phrase-level rules are line-local: a forbidden phrase is forbidden wherever it appears.
  lines.forEach((line, index) => {
    const lower = line.toLowerCase();
    for (const phrase of FORBIDDEN_PHRASES) {
      if (lower.includes(phrase)) {
        violations.push({
          path,
          line: index + 1,
          rule: 'forbidden-phrase',
          detail: `"${phrase}" is never permitted. The mark is exactly "Verified by Vibefy".`,
        });
      }
    }
    const markMatch = MARK_EXTENSION_PATTERN.exec(line);
    if (markMatch && !/verified by vibefy/i.test(line)) {
      violations.push({
        path,
        line: index + 1,
        rule: 'mark-extension',
        detail: `"${markMatch[0]}" extends the certification mark. Permitted forms: "Verified by Vibefy", "Vibefy-assessed", "Vibefy Rubric vX — score N/100".`,
      });
    }
    if (/vibefy-copy-lint-allow:\s*$/.test(lower)) {
      violations.push({
        path,
        line: index + 1,
        rule: 'suppression-without-reason',
        detail: 'A copy-lint suppression must state why the wording is correct.',
      });
    }
  });

  // Restricted words are judged per paragraph, not per line: prose wraps, and a negation
  // that lands on the previous physical line still scopes the sentence it belongs to.
  for (const block of paragraphsOf(lines)) {
    if (/vibefy-copy-lint-allow:\s*\S/.test(block.text)) continue;
    const lower = block.text.toLowerCase();
    for (const sentence of sentencesOf(lower)) {
      for (const word of RESTRICTED_WORDS) {
        const pattern = new RegExp(`\\b${word.replace(/[-\s]/g, '[-\\s]')}\\b`);
        if (!pattern.test(sentence)) continue;
        if (QUALIFIERS.some((q) => sentence.includes(q))) continue;
        violations.push({
          path,
          line: block.line,
          rule: 'unqualified-absolute',
          detail: `"${word}" used without a negation or scope qualifier in "${sentence.trim().slice(0, 90)}". Say what was assessed, not what is true.`,
        });
      }
    }
  }

  return violations;
}

/** Consecutive non-blank lines, joined, so wrapped prose is judged as the sentence it is. */
function paragraphsOf(lines) {
  const blocks = [];
  let current = null;
  lines.forEach((line, index) => {
    if (line.trim() === '') {
      current = null;
      return;
    }
    if (current === null) {
      current = { line: index + 1, text: line };
      blocks.push(current);
    } else {
      current.text += ' ' + line;
    }
  });
  return blocks;
}

export function runCopyLint() {
  const files = [
    ...SCAN_DIRS.flatMap((dir) => collectFiles(join(root, dir))),
    ...SCAN_FILES.map((file) => join(root, file)),
  ];
  const violations = [];
  for (const file of files) {
    const rel = relative(root, file);
    if (SKIP_FILES.has(rel)) continue;
    violations.push(...lintText(readFileSync(file, 'utf8'), rel));
  }
  return { violations, fileCount: files.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { violations, fileCount } = runCopyLint();
  if (violations.length > 0) {
    console.error(`\n✗ Copy lint failed — ${violations.length} violation(s):\n`);
    for (const v of violations) console.error(`  ${v.path}:${v.line}  [${v.rule}]\n      ${v.detail}`);
    console.error('\nIf the wording is genuinely unavoidable, add on the line above:');
    console.error('  vibefy-copy-lint-allow: <why this wording is correct>\n');
    process.exit(1);
  }
  console.log(`✓ Copy lint passed — ${fileCount} files, no over-claiming language.`);
}
