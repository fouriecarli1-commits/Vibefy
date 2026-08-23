#!/usr/bin/env node
/**
 * WCAG 2.2 contrast gate.
 *
 * We sell an accessibility score. Shipping a dashboard that would fail our own rubric is
 * not a style problem, it is a credibility problem — so this is a build gate, not a lint
 * warning. It asserts every pair declared in tokens.json and, separately, asserts that the
 * colours we know fail as body text on light surfaces have not been quietly promoted.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tokens = JSON.parse(readFileSync(join(root, 'packages/shared/design/tokens.json'), 'utf8'));

// The arithmetic lives in packages/shared so that this gate and the report
// renderer cannot disagree about what "legible" means.
export { contrastRatio, relativeLuminance } from '../packages/shared/src/contrast.ts';
import { contrastRatio } from '../packages/shared/src/contrast.ts';

/** Resolve a dotted token path such as "light.text" or "brand.teal". */
export function resolveToken(path: string): string {
  const parts = path.split('.');
  const source: unknown = parts[0] === 'brand' ? tokens : tokens.semantic;
  const value = parts.reduce<unknown>(
    (node, key) => (node == null ? node : (node as Record<string, unknown>)[key]),
    source,
  );
  if (typeof value !== 'string') throw new Error(`Unknown token path: ${path}`);
  return value;
}

export function runContrastChecks(): string[] {
  const failures: string[] = [];

  for (const pair of tokens.contrastPairs) {
    const fg = resolveToken(pair.fg);
    const bg = resolveToken(pair.bg);
    const ratio = contrastRatio(fg, bg);
    if (ratio < pair.min) {
      failures.push(
        `${pair.fg} (${fg}) on ${pair.bg} (${bg}) — ${ratio.toFixed(2)}:1, needs ${pair.min}:1 — ${pair.usage}`,
      );
    }
  }

  // These must NEVER reach 4.5:1 on white by accident, because if one ever did, someone
  // would start using it as body text and the guarantee would rest on luck.
  const lightSurface = resolveToken('light.surface');
  for (const path of tokens.forbiddenAsBodyText.onLightSurface) {
    const colour = resolveToken(path);
    const semanticUses = Object.entries(tokens.semantic.light).filter(
      ([key, value]) =>
        String(value).toLowerCase() === colour.toLowerCase() && /^(text|link|textMuted)/.test(key),
    );
    const firstUse = semanticUses[0];
    if (firstUse) {
      failures.push(
        `${path} (${colour}) is declared unusable as body text on light surfaces but is assigned to semantic.light.${firstUse[0]}`,
      );
    }
    const ratio = contrastRatio(colour, lightSurface);
    if (ratio >= 4.5) {
      failures.push(
        `${path} (${colour}) now reaches ${ratio.toFixed(2)}:1 on white. Either it changed, or the forbidden list is stale — resolve deliberately, do not delete this check.`,
      );
    }
  }

  return failures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const failures = runContrastChecks();
  const total = tokens.contrastPairs.length;
  if (failures.length > 0) {
    console.error(`\n✗ Contrast check failed (${failures.length} of ${total} pairs):\n`);
    for (const f of failures) console.error(`  · ${f}`);
    console.error('\nFix the token, not the threshold.\n');
    process.exit(1);
  }
  console.log(`✓ Contrast check passed — ${total} token pairs meet WCAG 2.2 AA.`);
}
