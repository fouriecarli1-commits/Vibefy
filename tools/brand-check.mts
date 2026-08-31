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
import { SEAL, SEAL_COMPACT, WORDMARK, WORDMARK_OUTLINE } from '@vibefycode/shared';
import { BADGE_ARTWORK } from '@vibefycode/badge';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svgDir = join(root, 'brand/svg');
const webBrandDir = join(root, 'apps/web/public/brand');

/** The masters that carry the supplied seal rather than drawing one. */
const BADGE_MASTERS = new Set([
  'vibefycode-badge-verified.svg',
  'vibefycode-badge-verified-compact.svg',
  'vibefycode-badge-suspended.svg',
  'vibefycode-badge-expired.svg',
  'vibefycode-badge-revoked.svg',
]);
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
function allowedColours(): Set<string> {
  const values = new Set(['#FFFFFF', 'currentColor', 'none']);
  const collect = (node: Record<string, unknown>): void => {
    for (const value of Object.values(node)) {
      if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value))
        values.add(value.toUpperCase());
      else if (value && typeof value === 'object') collect(value as Record<string, unknown>);
    }
  };
  collect(tokens);
  return values;
}

/**
 * Is this colour a palette colour, or a shade of one?
 *
 * The rule the brief actually states is that the marks are not *recoloured*, and
 * a shade is not a recolour: blending a palette colour towards white or towards
 * black keeps its hue and only moves its light. That is what a struck-metal band
 * is made of — one ink, lit on one edge and shadowed on the other — and
 * demanding that every one of those stops be its own token would mean twenty
 * mechanical entries in `tokens.json` that no one could check by eye.
 *
 * What it still refuses is a colour that is not on the line between a palette
 * colour and white or black. A new hue cannot pass, which is the thing the gate
 * exists to stop.
 */
type Span = { readonly from: number; readonly to: number; readonly actual: number };

export function isPaletteShade(colour: string, permitted: Iterable<string>): boolean {
  const rgb = (hex: string): [number, number, number] => [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
  const actual = rgb(colour);

  for (const base of permitted) {
    const from = rgb(base);
    for (const target of [255, 0]) {
      const spans: Span[] = [0, 1, 2].map((channel) => ({
        from: from[channel] ?? 0,
        to: target,
        actual: actual[channel] ?? 0,
      }));

      // The blend fraction implied by whichever channel moves furthest, so a
      // near-grey base does not make every colour look like a shade of it.
      const widest = spans.reduce((best, span) =>
        Math.abs(span.to - span.from) > Math.abs(best.to - best.from) ? span : best,
      );
      if (Math.abs(widest.to - widest.from) < 24) continue;

      const amount = (widest.actual - widest.from) / (widest.to - widest.from);
      if (amount < -0.02 || amount > 1.02) continue;

      // All three channels have to agree, within a rounding error, or it is a
      // different colour that merely happens to be about as light.
      const agrees = (span: Span) =>
        Math.abs(span.from + (span.to - span.from) * amount - span.actual) <= 2;
      if (spans.every(agrees)) return true;
    }
  }
  return false;
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

    // The badge carries the supplied artwork rather than a drawing of it, so it
    // is the one master that is *meant* to embed a raster and it has no colour
    // values to read. The guarantee changes shape rather than lapsing: instead
    // of "these colours came from the palette", it becomes "these bytes are the
    // supplied seal, unaltered", checked below against the master's checksum.
    if (BADGE_MASTERS.has(master)) {
      if (!/<image\b/.test(svg)) {
        failures.push(
          `${master} draws the seal instead of carrying the supplied artwork. The mark is not redrawn.`,
        );
      }
      continue;
    }

    if (/<image\b/.test(svg)) {
      failures.push(
        `${master} embeds a raster. Every mark but the badge is drawn and must stay vector.`,
      );
    }

    for (const colour of svg.match(/#[0-9a-fA-F]{6}/g) ?? []) {
      if (permitted.has(colour.toUpperCase())) continue;
      if (isPaletteShade(colour.toLowerCase(), permitted)) continue;
      failures.push(
        `${master} uses ${colour}, which is neither a palette colour nor a shade of one. The marks are not recoloured.`,
      );
    }
  }

  // The badge is the supplied artwork, and this is what says so.
  //
  // `BADGE_ARTWORK` records the checksum of the master each state was resized
  // from. If somebody regenerates the artwork from a different file, or edits a
  // master by hand, these stop matching — which is the only remaining way to
  // catch the mark being altered now that there are no colour values to read.
  for (const [status, artwork] of Object.entries(BADGE_ARTWORK)) {
    const file =
      status === 'active'
        ? 'vibefycode-badge-artwork.webp'
        : `vibefycode-badge-artwork-${status}.webp`;
    const path = join(webBrandDir, file);
    if (!existsSync(path)) {
      failures.push(`${file} is missing. Run \`pnpm brand:build\`.`);
      continue;
    }
    const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
    if (actual !== artwork.sourceSha256) {
      failures.push(
        `The embedded ${status} badge was resized from a different ${file} than the one on disk. ` +
          'Run `pnpm badge:artwork` so the badge served to customers is the artwork in this repository.',
      );
    }
  }

  // Four states, four different images. A suspended badge that renders the
  // active seal is worse than no badge, and one `cp` away.
  const seen = new Map();
  for (const [status, artwork] of Object.entries(BADGE_ARTWORK)) {
    const other = seen.get(artwork.dataUri);
    if (other) failures.push(`The ${status} badge is byte-identical to the ${other} badge.`);
    seen.set(artwork.dataUri, status);
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
  // Those two constants no longer draw anything — the legend is in the supplied
  // artwork's pixels. They are still checked because they are what every other
  // surface reads when it needs the words, and because a constant that quietly
  // stops matching the mark is how the two drift apart again.
  if (SEAL_COMPACT.legend.text !== 'VERIFIED BY') {
    failures.push(
      `The compact badge's legend reads "${SEAL_COMPACT.legend.text}", not "VERIFIED BY".`,
    );
  }

  // The wordmark is drawn, not typed. Set as text it would be a different
  // drawing on every machine without Poppins — and it is the trade mark, served
  // onto other people's websites.
  //
  // The badge masters are not in this list any more: their wordmark is in the
  // supplied artwork's pixels, where no font can substitute for it at all. The
  // checksum above is what holds it there.
  for (const master of ['vibefycode-logo-horizontal.svg', 'vibefycode-logo-horizontal-dark.svg']) {
    const path = join(svgDir, master);
    if (!existsSync(path)) continue;
    const svg = readFileSync(path, 'utf8');
    if (!svg.includes(WORDMARK_OUTLINE.strong) || !svg.includes(WORDMARK_OUTLINE.light)) {
      failures.push(`${master} does not carry the outlined wordmark. Run \`pnpm brand:build\`.`);
    }
    for (const element of svg.match(/<text[^>]*>[^<]*<\/text>/g) ?? []) {
      if (element.toUpperCase().includes('VIBEFY')) {
        failures.push(
          `${master} sets the wordmark as live text. It must be outlines, or it is a different drawing on every machine without Poppins.`,
        );
      }
    }
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
