/**
 * The marks are derived from the founder's artwork, and stay derived.
 *
 * Two pieces of geometry in this project now come from the supplied files
 * rather than from a reconstruction of them: the wordmark's letterforms, and
 * the traced silhouette used for the single-colour masters. Both are generated
 * and committed, which is the arrangement that quietly rots — a generated file
 * edited by hand looks identical to one that was generated.
 *
 * So these assert the properties that make each usable, and the split between
 * where the trace is used and where it is not. That split is a decision with a
 * trade-off in it (decisions 267 and 268), and a decision nothing enforces is a
 * preference.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderMarkSvg } from '@vibefycode/badge';
import { MARK, MARK_OUTLINE, PALETTE, WORDMARK_OUTLINE, VIEWBOX } from '@vibefycode/shared';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('the traced mark outline', () => {
  it('is real geometry rather than a wrapped picture', () => {
    for (const d of MARK_OUTLINE.paths) {
      expect(d).toMatch(/^M-?[\d.]+ -?[\d.]+/);
      expect(d.endsWith('Z')).toBe(true);
      expect(d).not.toContain('image');
    }
  });

  it('carries every element of the artwork, not just the V', () => {
    // The supplied mark draws the ribbon, the arrow, six circuit traces with
    // their dots, and three bars. A trace that returned four contours would
    // have dropped the furniture and still looked plausible in a thumbnail.
    expect(MARK_OUTLINE.paths.length).toBeGreaterThanOrEqual(15);
  });

  it('is fitted to the same box as the drawn mark, so the two are interchangeable', () => {
    expect(MARK_OUTLINE.viewBox).toBe(VIEWBOX);

    const coordinates = MARK_OUTLINE.paths.flatMap((d) =>
      [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].flatMap((m) => [Number(m[1]), Number(m[2])]),
    );
    expect(Math.min(...coordinates)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...coordinates)).toBeLessThanOrEqual(VIEWBOX);
  });

  it('does not contain the canvas frame the tracer emits', () => {
    // potrace reads the background as foreground and returns a contour spanning
    // the whole image. Kept, it inverts the mark into a filled rectangle under
    // an even-odd fill — which is what the first three attempts rendered.
    const spansEverything = MARK_OUTLINE.paths.some((d) => {
      const xs = [...d.matchAll(/(-?[\d.]+) -?[\d.]+/g)].map((m) => Number(m[1]));
      const ys = [...d.matchAll(/-?[\d.]+ (-?[\d.]+)/g)].map((m) => Number(m[1]));
      return (
        Math.max(...xs) - Math.min(...xs) > VIEWBOX * 0.98 &&
        Math.max(...ys) - Math.min(...ys) > VIEWBOX * 0.98
      );
    });
    expect(spansEverything).toBe(false);
  });
});

describe('where the trace is used', () => {
  const mono = renderMarkSvg({ mono: true });
  const monoDark = renderMarkSvg({ mono: true, onDark: true });
  const colour = renderMarkSvg();

  it('draws the single-colour masters from it', () => {
    expect(mono).toContain(MARK_OUTLINE.paths[0]);
    expect(monoDark).toContain(MARK_OUTLINE.paths[0]);
  });

  it('fills them even-odd, so the ribbon keeps its holes', () => {
    // Under a non-zero rule the gaps that carry the weave fill in, and the mark
    // becomes a solid blob that still reads as a V — the failure that looks fine
    // until somebody prints it large.
    expect(mono).toContain('fill-rule="evenodd"');
  });

  it('inks them from the palette rather than from a literal', () => {
    expect(mono).toContain(PALETTE.navy);
    expect(monoDark).toContain(PALETTE.mist);
  });

  it('does not use it for the colour mark', () => {
    // The colour artwork carries its weave in continuous shading. A traced
    // region graph has no colours to separate the overlap with, so it flattens
    // the two ribbons into one shape — which is why the colour mark stays drawn.
    expect(colour).not.toContain(MARK_OUTLINE.paths[0]);
    expect(colour).toContain(MARK.ribbonFront);
    expect(colour).toContain(MARK.ribbonBack);
  });
});

describe('the wordmark', () => {
  it('is taken from the artwork rather than set in a font', () => {
    const generated = read('packages/shared/src/wordmark.generated.ts');
    expect(generated).toContain('brand/source/supplied-wordmark.svg');
    expect(generated).not.toContain('Poppins');
  });

  it('still spells the one word, in two weights', () => {
    // Six glyphs bold and four regular. If a future regeneration splits them
    // anywhere else, the wordmark reads as two words.
    const glyphs = (d: string) => (d.match(/M/g) ?? []).length;
    expect(glyphs(WORDMARK_OUTLINE.strong)).toBeGreaterThanOrEqual(6);
    expect(glyphs(WORDMARK_OUTLINE.light)).toBeGreaterThanOrEqual(4);
  });

  it('sits on the baseline with its caps above it', () => {
    const ys = [
      ...`${WORDMARK_OUTLINE.strong}${WORDMARK_OUTLINE.light}`.matchAll(/-?[\d.]+ (-?[\d.]+)/g),
    ].map((m) => Number(m[1]));
    // Round letters overshoot the cap line and the baseline both — `O` and `C`
    // are drawn a little taller and a little deeper than `I` so that all three
    // read the same height. So this allows 2% either way rather than demanding
    // a flat line the artwork deliberately does not draw.
    const slack = WORDMARK_OUTLINE.capHeight * 0.02;
    expect(Math.max(...ys)).toBeLessThanOrEqual(slack);
    expect(-Math.min(...ys)).toBeGreaterThan(WORDMARK_OUTLINE.capHeight - slack);
    expect(-Math.min(...ys)).toBeLessThan(WORDMARK_OUTLINE.capHeight + slack);
  });

  it('starts at the origin, so the advance width is the drawn width', () => {
    const xs = [...WORDMARK_OUTLINE.strong.matchAll(/(-?[\d.]+) -?[\d.]+/g)].map((m) =>
      Number(m[1]),
    );
    expect(Math.min(...xs)).toBeGreaterThan(-5);
    expect(WORDMARK_OUTLINE.width).toBeGreaterThan(Math.max(...xs));
  });
});

describe('the generators', () => {
  it('say the tracer is a prerequisite of the script and not of the build', () => {
    // `pnpm brand:build` runs on Vercel, where no Python tracer exists. If a
    // future edit calls the tracer from the build, deployment breaks — and it
    // breaks on the deploy rather than in CI, which is the expensive order.
    expect(read('tools/brand-build.mts')).not.toContain('potrace');
    expect(read('package.json')).not.toContain('potrace');
  });

  it('warn that the artwork is never compressed first', () => {
    expect(read('tools/build-wordmark.mjs')).toContain('compressor');
  });
});
