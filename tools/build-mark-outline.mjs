#!/usr/bin/env node
/**
 * Traces the mark out of the supplied artwork.
 *
 * Every SVG the founder supplied draws the V as a placed picture rather than as
 * geometry, and no export reaches it — the artwork was generated as an image, so
 * there is nothing in the source file to export. See `brand/source/README.md`.
 *
 * But `supplied-mark-black.svg` carries a 1600×1472 single-channel silhouette
 * inside it: pure black and white, no gradient, clean edges, and the internal
 * weave of the ribbon drawn as gaps. That is the one input a contour tracer
 * handles well, and tracing is deriving rather than redesigning — which is what
 * PART 0.5 asks for.
 *
 *   pip install potracer pillow
 *   node tools/build-mark-outline.mjs
 *
 * The tracer is a prerequisite of this script and not of the build: this runs
 * once per supplied mark, and its output is committed. `pnpm brand:build` never
 * needs it.
 *
 * What this produces is a **silhouette**, and it is used as one — the two mono
 * masters, where a single-colour outline is the whole point. The colour mark
 * keeps the geometry in `packages/shared/src/brand.ts`, because the colour
 * artwork carries its weave in continuous shading rather than in outlines, and
 * a traced region graph flattens exactly that into one solid shape. Decision 268.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2] ?? join(root, 'brand/source/supplied-mark-black.svg');
const svg = readFileSync(source, 'utf8');

// The first embedded image is the mask; the second is the artwork it masks.
// Taking the first by position rather than by guessing at the colour type,
// because a one-channel PNG is exactly what a mask looks like and exactly what
// a black-and-white artwork looks like too.
const payload = svg.match(/data:image\/png;base64,([A-Za-z0-9+/=\s]+)/);
if (!payload) {
  console.error(`No embedded PNG found in ${source}. Read the file before trusting this.`);
  process.exit(1);
}

const scratch = mkdtempSync(join(tmpdir(), 'vibefycode-trace-'));
const maskPath = join(scratch, 'mask.png');
writeFileSync(maskPath, Buffer.from(payload[1].replace(/\s/g, ''), 'base64'));

/** The viewBox everything else in this brand is drawn in. */
const VIEWBOX = 512;
/** Clear space, so the mark is not flush against its own edge. */
const PAD = 18;

const script = `
import json, sys
import numpy as np, potrace
from PIL import Image

a = np.array(Image.open(sys.argv[1]).convert('L'))
h, w = a.shape
paths = potrace.Bitmap(a > 128).trace(turdsize=8, alphamax=1.0, opttolerance=0.2)

def emit(curve):
    d = ['M%.2f %.2f' % (curve.start_point.x, curve.start_point.y)]
    for seg in curve:
        e = seg.end_point
        if seg.is_corner:
            d.append('L%.2f %.2fL%.2f %.2f' % (seg.c.x, seg.c.y, e.x, e.y))
        else:
            d.append('C%.2f %.2f %.2f %.2f %.2f %.2f'
                     % (seg.c1.x, seg.c1.y, seg.c2.x, seg.c2.y, e.x, e.y))
    return ''.join(d) + 'Z'

out = []
for curve in paths:
    pts = [(curve.start_point.x, curve.start_point.y)] + [(s.end_point.x, s.end_point.y) for s in curve]
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    # potrace reads the canvas frame as foreground and returns a curve spanning
    # the whole image. Kept, it inverts everything under an even-odd fill.
    if (max(xs) - min(xs)) > 0.95 * w and (max(ys) - min(ys)) > 0.95 * h:
        continue
    out.append({'d': emit(curve), 'bbox': [min(xs), min(ys), max(xs), max(ys)]})

json.dump(out, sys.stdout)
`;

let traced;
try {
  traced = JSON.parse(
    execFileSync('python3', ['-c', script, maskPath], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
} catch (error) {
  console.error('The trace failed. Is `potracer` installed?  pip install potracer pillow');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const x0 = Math.min(...traced.map((c) => c.bbox[0]));
const y0 = Math.min(...traced.map((c) => c.bbox[1]));
const x1 = Math.max(...traced.map((c) => c.bbox[2]));
const y1 = Math.max(...traced.map((c) => c.bbox[3]));

// Fitted to the shared 512 box on the longer side, so the traced mark and the
// drawn one are interchangeable in any frame that already holds the drawn one.
const scale = (VIEWBOX - 2 * PAD) / Math.max(x1 - x0, y1 - y0);
const dx = PAD - x0 * scale + (VIEWBOX - 2 * PAD - (x1 - x0) * scale) / 2;
const dy = PAD - y0 * scale + (VIEWBOX - 2 * PAD - (y1 - y0) * scale) / 2;

const round = (n) => Number(n.toFixed(2)).toString();
const placed = traced.map((curve) =>
  curve.d.replace(
    /(-?[\d.]+) (-?[\d.]+)/g,
    (_, xs, ys) => `${round(Number(xs) * scale + dx)} ${round(Number(ys) * scale + dy)}`,
  ),
);

const out = `/**
 * The mark, traced. Generated — do not edit.
 *
 * Produced by \`node tools/build-mark-outline.mjs\` from the 1600×1472 silhouette
 * embedded in \`brand/source/supplied-mark-black.svg\`, which is the founder's
 * artwork. Fitted to the same ${VIEWBOX}-unit box as \`MARK\`, so the two are
 * interchangeable in any frame that holds either.
 *
 * A silhouette, and used as one: the mono masters, where a single-colour
 * outline is the point. The colour mark is drawn from \`MARK\` in
 * \`./brand.ts\` — the colour artwork carries its weave in continuous shading,
 * and a traced region graph flattens that into one solid shape.
 *
 * Fill with \`fill-rule="evenodd"\`: the ribbon's holes are separate curves,
 * and under a non-zero rule they fill in.
 */
export const MARK_OUTLINE = {
  /** Every closed contour, in draw order. */
  paths: [
${placed.map((d) => `    '${d}',`).join('\n')}
  ],
  viewBox: ${VIEWBOX},
} as const;
`;

const target = join(root, 'packages/shared/src/mark-outline.generated.ts');
writeFileSync(target, out);
console.log(
  `✓ Mark traced from ${source.replace(`${root}/`, '')} — ${placed.length} contours, ${(out.length / 1024).toFixed(1)} KB`,
);
