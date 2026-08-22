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
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svgDir = join(root, 'brand/svg');
const tokens = JSON.parse(readFileSync(join(root, 'packages/shared/design/tokens.json'), 'utf8'));

const REQUIRED_MASTERS = [
  'vibefy-mark.svg',
  'vibefy-mark-mono.svg',
  'vibefy-mark-mono-dark.svg',
  'vibefy-logo-horizontal.svg',
  'vibefy-logo-horizontal-dark.svg',
  'vibefy-badge-verified.svg',
  'vibefy-badge-suspended.svg',
  'vibefy-badge-expired.svg',
  'vibefy-badge-revoked.svg',
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
  // Tints used inside the shield and the check, declared here so that any other
  // colour appearing in a master is a deliberate decision, not a drift.
  for (const tint of ['#2E6FE4', '#2AA6DE', '#39E4D2', '#8FF3E8']) values.add(tint);
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

  // The certification badge carries the wordmark, split across three lines, and
  // nothing that extends it.
  const badge = existsSync(join(svgDir, 'vibefy-badge-verified.svg'))
    ? readFileSync(join(svgDir, 'vibefy-badge-verified.svg'), 'utf8')
    : '';
  for (const word of ['Verified', 'by', 'Vibefy']) {
    if (!new RegExp(`>${word}<`).test(badge)) {
      failures.push(`The certification badge is missing the wordmark line "${word}".`);
    }
  }
  if (/Secure|Certified|Approved|Guaranteed|Compliant/i.test(badge)) {
    failures.push('The certification badge extends the mark beyond "Verified by Vibefy".');
  }

  // Every non-active state must say, in words, that it is not a verification.
  for (const state of ['suspended', 'expired', 'revoked']) {
    const file = join(svgDir, `vibefy-badge-${state}.svg`);
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
      `${file} is in brand/svg/ but is not a generated master. Derivatives come from tools/brand-build.mjs.`,
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
