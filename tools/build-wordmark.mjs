#!/usr/bin/env node
/**
 * Turns the supplied wordmark into outlines this project can draw.
 *
 * A logo set in live text is a logo that changes shape depending on what fonts
 * the viewer happens to have. For a badge served onto other people's websites
 * that is not a cosmetic problem: the wordmark is the trade mark, and it has to
 * be the same drawing everywhere. So VIBEFYCODE is baked to paths here, once,
 * and committed.
 *
 *   node tools/build-wordmark.mjs [brand/source/supplied-wordmark.svg]
 *
 * This reads the founder's artwork rather than a font. An earlier version set
 * the name in Poppins and outlined that, which was the best available answer
 * while the only supplied files were raster — but it was a lookalike, and PART
 * 0.5 asks for derivation from the artwork rather than a reconstruction of it.
 * The supplied SVG carries the letterforms as real geometry (the mark beside
 * them does not; see `brand/source/README.md`), so the letters are taken from
 * there and the font is out of the picture.
 *
 * Never run the artwork through an SVG compressor first. One pass merged these
 * ten glyphs and flattened their curves — the `O` in `CODE` came back a
 * decagon — and the damage is invisible until about 4×. Decision 265.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2] ?? join(root, 'brand/source/supplied-wordmark.svg');
const svg = readFileSync(source, 'utf8');

/**
 * The glyphs, in the order the artwork draws them.
 *
 * Each sits in its own `<g transform="translate(x, y)">`, which is how a design
 * tool emits outlined text: one shared baseline, one advance per letter. Any
 * other `<path>` in the file — the clip rectangle, the mask frame — has no
 * translate and is skipped by this shape alone.
 */
const glyphs = [
  ...svg.matchAll(
    // The design tool nests a bare `<g>` between the placed group and the
    // outline, so anything between them is stepped over rather than assumed away.
    /<g[^>]*transform="translate\(([-\d.]+),\s*([-\d.]+)\)"[^>]*>(?:\s*<g[^>]*>)*\s*<path[^>]*\bd="([^"]+)"/g,
  ),
].map((match) => ({ x: Number(match[1]), y: Number(match[2]), d: match[3] }));

if (glyphs.length !== 10) {
  console.error(
    `Expected 10 glyphs for VIBEFYCODE, found ${glyphs.length}. The artwork's structure changed; read it before trusting this.`,
  );
  process.exit(1);
}

const baselines = new Set(glyphs.map((glyph) => glyph.y.toFixed(3)));
if (baselines.size !== 1) {
  console.error(
    `The glyphs sit on ${baselines.size} different baselines: ${[...baselines].join(', ')}.`,
  );
  process.exit(1);
}

// Only M, L, C and Z appear, all absolute, all plain coordinate pairs — so an
// affine map is a map over the pairs. This is worth asserting rather than
// assuming: an `H` or `V` takes one number, and transforming it as if it took
// two produces a wordmark shaped like a slab. A first attempt at this did
// exactly that.
for (const glyph of glyphs) {
  const unsupported = [...new Set(glyph.d.match(/[A-Za-z]/g))].filter(
    (c) => !'MLCZmlcz'.includes(c),
  );
  if (unsupported.length > 0) {
    console.error(
      `Path command(s) ${unsupported.join(', ')} are not handled. Extend this before shipping.`,
    );
    process.exit(1);
  }
}

/** Applies `translate(dx, 0)` then `scale(k)` to every coordinate pair. */
function place(d, dx, k) {
  return d.replace(
    /(-?[\d.]+)\s+(-?[\d.]+)/g,
    (_, xs, ys) => `${round((Number(xs) + dx) * k)} ${round(Number(ys) * k)}`,
  );
}

/** Two decimals is finer than a pixel at any size this is ever drawn. */
const round = (n) => Number(n.toFixed(2)).toString();

const yExtent = Math.max(
  ...glyphs.flatMap((glyph) =>
    [...glyph.d.matchAll(/-?[\d.]+\s+(-?[\d.]+)/g)].map((match) => -Number(match[1])),
  ),
);

// Normalised to the same units the previous outline used — cap height 705 on a
// 1000 em — so nothing downstream has to change. `wordmarkSvg` scales to a
// target width anyway; this only keeps the numbers legible.
const CAP_HEIGHT = 705;
const UNITS_PER_EM = 1000;
const scale = CAP_HEIGHT / yExtent;
const originX = glyphs[0].x;

// Each glyph's coordinates are local to its own group, so the shift is that
// group's placement relative to the first — not the first glyph's placement
// subtracted from the coordinates, which puts the whole word left of the origin.
const placed = glyphs.map((glyph) => place(glyph.d, glyph.x - originX, scale));

// VIBEFY is set bold and CODE regular. The split is by letter count rather than
// by measuring weight: it is the word, and the word does not change.
const strong = placed.slice(0, 6).join('');
const light = placed.slice(6).join('');

const advances = glyphs.map((glyph) => (glyph.x - originX) * scale);
const lastGlyphWidth = Math.max(
  ...[...(glyphs.at(-1)?.d.matchAll(/(-?[\d.]+)\s+-?[\d.]+/g) ?? [])].map((m) => Number(m[1])),
);
const width = Math.round((advances.at(-1) ?? 0) + lastGlyphWidth * scale);

const out = `/**
 * The wordmark, outlined. Generated — do not edit.
 *
 * Produced by \`node tools/build-wordmark.mjs\` from
 * \`brand/source/supplied-wordmark.svg\`, which is the founder's artwork and the
 * authority on the letterforms. Baked to paths because a logo set in live text
 * is a logo that changes shape depending on which fonts the viewer happens to
 * have — and this one goes onto other people's websites, where it is the trade
 * mark and has to be the same drawing every time.
 *
 * Already y-flipped by the artwork: the baseline is y = 0 and the caps rise to
 * negative y, as SVG wants. Draw with \`transform="translate(x baselineY) scale(k)"\`.
 */
/*
 * vibefycode-copy-lint-allow-block: the two halves of the wordmark are named
 * separately here because the artwork sets them in two weights. The brand gate
 * asserts they join back to VIBEFYCODE.
 */
export const WORDMARK_OUTLINE = {
  /** The strong half, as the artwork draws it. */
  strong:
    '${strong}',
  /** The light half, as the artwork draws it. */
  light:
    '${light}',
  /** Total advance width, in the units below. */
  width: ${width},
  capHeight: ${CAP_HEIGHT},
  unitsPerEm: ${UNITS_PER_EM},
} as const;
/* vibefycode-copy-lint-allow-block-end */
`;

const target = join(root, 'packages/shared/src/wordmark.generated.ts');
writeFileSync(target, out);
console.log(
  `✓ Wordmark outlined from ${source.replace(`${root}/`, '')} — ${glyphs.length} glyphs, width ${width}, ${(out.length / 1024).toFixed(1)} KB`,
);
