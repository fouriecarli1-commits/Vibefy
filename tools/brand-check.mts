#!/usr/bin/env node
/**
 * Brand and badge usage gate.
 *
 * The entire business rests on being the only party who can issue that mark, and
 * on the mark meaning exactly one thing. This checks the generated masters
 * against the rules in PART 0.5 of the build brief: the full state set exists,
 * nothing has been recoloured off-palette, the marks are vector rather than a
 * wrapped raster, and the certification badge carries the wordmark unextended.
 */
import { SEAL, SEAL_COMPACT, WORDMARK } from '@vibefycode/shared';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svgDir = join(root, 'brand/svg');
const tokens = JSON.parse(readFileSync(join(root, 'packages/shared/design/tokens.json'), 'utf8'));

const REQUIRED_MASTERS = [
  'vibefycode-mark.svg',
  'vibefycode-mark-mono.svg',
  'vibefycode-mark-mono-dark.svg',
  'vibefycode-logo-horizontal.svg',
  'vibefycode-logo-horizontal-dark.svg',
  'vibefycode-badge-verified.svg',
  'vibefycode-badge-verified-compact.svg',
  'vibefycode-badge-suspended.svg',
  'vibefycode-badge-expired.svg',
  'vibefycode-badge-revoked.svg',
];

/** Every colour any master is allowed to contain. */
function allowedColours() {
  const values = new Set(['#FFFFFF', 'currentColor', 'none']);
  const collect = (node) => {
    for (const value of Object.values(node)) {
      if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value))
        values.add(value.toUpperCase());
      else if (value && typeof value === 'object') collect(value);
    }
  };
  collect(tokens);
  // No allowance beyond the palette. Every colour in every master is a token, so
  // a new one appearing is a deliberate decision that has to be made in
  // tokens.json — where the contrast gate can see it.
  return values;
}

export function runBrandCheck() {
  const failures = [];
  const permitted = allowedColours();

  for (const master of REQUIRED_MASTERS) {
    const path = join(svgDir, master);
    if (!existsSync(path)) {
      failures.push(`${master} is missing. Run \`pnpm brand:build\`.`);
      continue;
    }
    const svg = readFileSync(path, 'utf8');

    if (!/<title>/.test(svg))
      failures.push(`${master} has no <title>; screen readers would announce nothing.`);
    if (!/aria-label=/.test(svg)) failures.push(`${master} has no aria-label.`);
    if (/<image\b/.test(svg)) {
      failures.push(
        `${master} embeds a raster. The badge is served as SVG at runtime and must stay vector.`,
      );
    }

    for (const colour of svg.match(/#[0-9a-fA-F]{6}/g) ?? []) {
      if (!permitted.has(colour.toUpperCase())) {
        failures.push(
          `${master} uses ${colour}, which is not in the palette. The marks are not recoloured.`,
        );
      }
    }
  }

  // The wordmark, checked where it is decided rather than where it is drawn.
  //
  // The seal sets its legends one glyph per <text> so that no renderer's
  // `textPath` support can decide whether our name appears — which means the
  // rendered SVG has no contiguous "VERIFIED BY VIBEFYCODE" string to grep for.
  // So the constants that produce those glyphs are checked instead, and the
  // accessible name — the thing a screen reader actually announces, and the
  // thing alt text carries — is checked in the file.
  if (`${WORDMARK.strong}${WORDMARK.light}` !== 'VIBEFYCODE') {
    failures.push(
      `The wordmark halves spell "${WORDMARK.strong}${WORDMARK.light}", not "VIBEFYCODE". The mark is one word in two weights.`,
    );
  }
  // The seal says "VERIFIED BY" on the band and the wordmark on the banner. Read
  // together they are the mark, and neither half may drift.
  if (SEAL.topArc.text !== 'VERIFIED BY') {
    failures.push(`The seal's legend reads "${SEAL.topArc.text}", not "VERIFIED BY".`);
  }
  if (SEAL_COMPACT.legend.text !== 'VERIFIED BY') {
    failures.push(
      `The compact badge's legend reads "${SEAL_COMPACT.legend.text}", not "VERIFIED BY".`,
    );
  }

  for (const master of ['vibefycode-badge-verified.svg', 'vibefycode-badge-verified-compact.svg']) {
    const path = join(svgDir, master);
    if (!existsSync(path)) continue;
    const badge = readFileSync(path, 'utf8');
    if (!/Verified by VibefyCode/.test(badge)) {
      failures.push(`${master} does not announce "Verified by VibefyCode" as its accessible name.`);
    }
    if (/Secure|Certified|Approved|Guaranteed|Compliant/i.test(badge)) {
      failures.push(`${master} extends the mark beyond "Verified by VibefyCode".`);
    }
  }

  // Every non-active state must say, in words, that it is not a verification.
  for (const state of ['suspended', 'expired', 'revoked']) {
    const file = join(svgDir, `vibefycode-badge-${state}.svg`);
    if (!existsSync(file)) continue;
    const contents = readFileSync(file, 'utf8');
    if (!/Not currently/i.test(contents)) {
      failures.push(
        `The ${state} badge does not state that the application is not currently verified. A non-active badge must never read as a verification.`,
      );
    }
  }

  const unexpected = readdirSync(svgDir).filter((file) => !REQUIRED_MASTERS.includes(file));
  for (const file of unexpected) {
    failures.push(
      `${file} is in brand/svg/ but is not a generated master. Derivatives come from tools/brand-build.mts.`,
    );
  }

  return failures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const failures = runBrandCheck();
  if (failures.length > 0) {
    console.error(`\n✗ Brand check failed — ${failures.length} problem(s):\n`);
    for (const failure of failures) console.error(`  · ${failure}`);
    console.error('');
    process.exit(1);
  }
  console.log(
    `✓ Brand check passed — ${REQUIRED_MASTERS.length} masters, palette and wordmark intact.`,
  );
}
