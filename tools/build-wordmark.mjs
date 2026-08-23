#!/usr/bin/env node
/**
 * Turns the wordmark into outlines.
 *
 * A logo set in live text is a logo that changes shape depending on what fonts
 * the viewer happens to have. For a badge served onto other people's websites
 * that is not a cosmetic problem: the wordmark is the trade mark, and it has to
 * be the same drawing everywhere.
 *
 * So VIBEFYCODE is baked to a single path here, once, and committed. This is
 * what every brand does with its wordmark, and it is why `textLength` — which
 * pins the width but not the letterforms — was only ever half a fix.
 *
 *   node tools/build-wordmark.mjs <Poppins-Bold.ttf> <Poppins-Regular.ttf>
 *
 * Poppins is licensed under the SIL Open Font License 1.1, which permits
 * embedding and permits the outlines of a name set in it to be used as a logo.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [bold, regular] = process.argv.slice(2);
if (!bold || !regular) {
  console.error('Usage: node tools/build-wordmark.mjs <Bold.ttf> <Regular.ttf>');
  process.exit(1);
}

// The extraction is fontTools, because reading glyph outlines out of a TrueType
// file by hand is a bad way to spend a day — and because the offset between
// glyphs has to be an affine transform applied to the outline, not a find and
// replace on the path string. A first attempt did the latter and shifted the
// arguments of `H` and `V` commands, which produced a wordmark shaped like a slab.
const script = `
import json, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

def run(path, text, letter_spacing, x0):
    font = TTFont(path)
    cmap = font.getBestCmap()
    glyphs = font.getGlyphSet()
    hmtx = font['hmtx']
    pen = SVGPathPen(glyphs)
    x = x0
    for ch in text:
        name = cmap[ord(ch)]
        # Flip y here: fonts draw upwards from the baseline, SVG draws downwards.
        glyphs[name].draw(TransformPen(pen, (1, 0, 0, -1, x, 0)))
        x += hmtx[name][0] + letter_spacing
    os2 = font['OS/2']
    return {
        'd': pen.getCommands(),
        'end': x - letter_spacing,
        'upem': font['head'].unitsPerEm,
        'capHeight': getattr(os2, 'sCapHeight', 700) or 700,
    }

spacing = 34
strong = run(sys.argv[1], 'VIBEFY', spacing, 0)
light = run(sys.argv[2], 'CODE', spacing, strong['end'] + spacing)
print(json.dumps({'strong': strong, 'light': light}))
`;

const raw = execFileSync('python3', ['-c', script, bold, regular], { encoding: 'utf8' });
const data = JSON.parse(raw);

const strongPath = data.strong.d;
const lightPath = data.light.d;
const width = data.light.end;

const out = `/**
 * The wordmark, outlined. Generated — do not edit.
 *
 * Produced by \`node tools/build-wordmark.mjs\` from Poppins Bold and Poppins
 * Regular (SIL Open Font License 1.1). Baked to paths because a logo set in live
 * text is a logo that changes shape depending on which fonts the viewer happens
 * to have — and this one goes onto other people's websites, where it is the
 * trade mark and has to be the same drawing every time.
 *
 * Already y-flipped: the baseline is y = 0 and the caps rise to negative y, as
 * SVG wants. Draw with \`transform="translate(x baselineY) scale(k)"\`.
 */
/*
 * vibefycode-copy-lint-allow-block: the two halves of the wordmark are named
 * separately here because the artwork sets them in two weights. The brand gate
 * asserts they join back to VIBEFYCODE.
 */
export const WORDMARK_OUTLINE = {
  /** The strong half, set bold. */
  strong: '${strongPath}',
  /** The light half, set regular. */
  light: '${lightPath}',
  /** Total advance width, in font units. */
  width: ${Math.round(width)},
  capHeight: ${data.strong.capHeight},
  unitsPerEm: ${data.strong.upem},
} as const;
/* vibefycode-copy-lint-allow-block-end */
`;

const target = join(root, 'packages/shared/src/wordmark.generated.ts');
writeFileSync(target, out);
console.log(
  `✓ Wordmark outlined to packages/shared/src/wordmark.generated.ts (${Math.round(width)} units wide, ${strongPath.length + lightPath.length} chars of path)`,
);
