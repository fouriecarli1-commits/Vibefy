/**
 * VibefyCode mark geometry — the single source for every derived asset, and for
 * the badge rendered at request time.
 *
 * The founder's artwork in brand/source/ is the authority. These paths are a
 * clean vector reconstruction of it, not a redesign: same forms, same palette,
 * same proportions. Nothing here may be "improved" — see PART 0.5 of the build
 * brief and the badge usage rules. When the original vector files arrive, the
 * paths below are replaced from them; every derivative regenerates unchanged in
 * shape and count.
 *
 * The reconstruction is registered in docs/OPEN_ITEMS.md and brand/source/README.md,
 * because "close enough that nobody complained" is not the standard a trust mark
 * gets held to.
 */

export const VIEWBOX = 512;

/**
 * The mark: an interlocking ribbon V, a rising arrow, and the technical
 * furniture around them.
 *
 * The V is two ribbons rather than one stroke — they cross near the vertex and
 * one passes behind the other, which is the whole character of the artwork and
 * the first thing lost by anyone redrawing it as a plain chevron.
 */
export const MARK = {
  /** Left ribbon: upper-left down to the vertex, carrying the teal end of the gradient. */
  leftRibbon: 'M132 118 C160 214 200 306 244 372',
  /** Right ribbon: vertex up to upper-right, carrying the blue end. */
  rightRibbon: 'M256 372 C300 306 340 214 368 118',
  ribbonWidth: 44,

  /**
   * The knot: the left ribbon curls back beneath the vertex and returns.
   *
   * Drawn as an open curl around a counter rather than a closed blob — the hole
   * is what makes it read as a ribbon passing through itself instead of a
   * thickening of the stroke.
   */
  knot: 'M244 372 C238 404 208 416 186 400 C164 384 168 350 194 342 C220 334 240 352 240 374',
  knotWidth: 22,
  counter: { cx: 200, cy: 372, r: 13 },

  /**
   * The interlace. The right ribbon crosses in front of the left, so it is drawn
   * a second time in the surface colour, slightly wider, immediately beneath
   * itself: the gap that leaves is what the eye reads as "over".
   */
  knockoutWidth: 62,

  /** The rising arrow. Emerges from behind the right ribbon and climbs out of the frame. */
  arrowShaft: 'M268 402 C312 360 356 320 398 276',
  arrowShaftWidth: 26,
  /** Solid head, continuing the shaft's angle so the two read as one stroke. */
  arrowHead: 'M452 232 L414 302 L374 256 Z',

  /** Circuit traces. Decorative, and the first thing dropped at small sizes. */
  traces: [
    { d: 'M96 300 L138 300 L160 278', dot: { cx: 92, cy: 300 } },
    { d: 'M110 366 L152 366 L172 346', dot: { cx: 106, cy: 366 } },
    { d: 'M150 232 L120 232 L104 216', dot: { cx: 100, cy: 212 } },
    { d: 'M118 424 L166 424', dot: { cx: 114, cy: 424 } },
    { d: 'M404 300 L440 300 L456 284', dot: { cx: 460, cy: 280 } },
    { d: 'M398 232 L432 232', dot: { cx: 436, cy: 232 } },
  ],
  traceWidth: 6,
  traceDotRadius: 8,

  /** The ascending bars, clear of the traces so neither reads as a fault in the other. */
  bars: [
    { x: 388, y: 400, w: 15, h: 26 },
    { x: 411, y: 384, w: 15, h: 42 },
    { x: 434, y: 362, w: 15, h: 64 },
  ],
} as const;

/**
 * The certification seal.
 *
 * Concentric rings, a band of repeating micro-text, guilloche patches, and the
 * wordmark set on an arc — the vocabulary of a printed seal, which is the point:
 * it has to read as a stamp at a glance and survive being scaled down to 96px on
 * somebody else's website.
 *
 * `minimumDetailPx` is where the micro-text and guilloche stop being texture and
 * start being dirt. Below it they are not rendered at all rather than rendered
 * illegibly.
 */
export const SEAL = {
  /** Concentric rules, outermost first. Two heavy, the rest hairlines. */
  rings: [
    { r: 246, width: 3 },
    { r: 239, width: 1.2 },
    { r: 206, width: 1.6 },
    { r: 199, width: 1 },
    { r: 151, width: 1 },
    { r: 144, width: 1 },
  ],

  /**
   * The repeating trust legend, running the whole way round its own band.
   *
   * Repeated rather than stretched: a seal's micro-text is a legend that recurs,
   * and one phrase spaced out around the ring is the tell of a fake one.
   */
  microTextRadius: 228,
  microTextSize: 9,
  microText: 'VIBEFYCODE TRUST',
  microTextRepeats: 9,

  /**
   * The two legend arcs. Angles are degrees clockwise from twelve o'clock, and
   * the spans are chosen so nothing meets anything: the top run occupies roughly
   * ±36°, the bottom ±66°, and the flanks are left for the furniture.
   */
  topArc: { r: 186, step: 6.5, size: 32, text: 'VERIFIED BY' },
  bottomArc: { r: 192, step: 6, size: 26, text: 'VERIFIED BY VIBEFYCODE' },

  /** Guilloche patches at ten and two o'clock, as the printed original has them. */
  guilloche: [
    { cx: 106, cy: 139, w: 40, h: 78 },
    { cx: 406, cy: 139, w: 40, h: 78 },
  ],

  /**
   * The two verification checks, on the flanks at nine and three o'clock — the
   * one band where neither legend arc nor the mark reaches.
   */
  checks: [
    { cx: 126, cy: 262, scale: 0.9 },
    { cx: 386, cy: 262, scale: 0.9 },
  ],
  check: 'M-16 0 L-5 12 L16 -13',
  checkWidth: 5,

  /** Where the mark and the wordmark sit inside the inner field. */
  markCentre: { x: 256, y: 206 },
  markScale: 0.38,
  wordmark: { y: 332, size: 28 },

  /**
   * Below this rendered width the seal is not drawn at all — the compact layout
   * below is used instead.
   *
   * A seal's furniture is texture at 512px and dirt at 96px, and the licence
   * permits embedding from 96px. Shrinking the full artwork to fit would ship a
   * trust mark that looks like a smudge, which is worse than shipping a plainer
   * one that can be read.
   */
  minimumDetailPx: 220,
} as const;

/**
 * The seal at embed sizes.
 *
 * Same silhouette, same colours, same wordmark — everything that cannot survive
 * being 96px across is removed rather than shrunk. What is left has to answer
 * one question at a glance: whose mark is this, and does it say verified.
 */
export const SEAL_COMPACT = {
  rings: [
    { r: 246, width: 7 },
    { r: 229, width: 2 },
  ],
  markCentre: { x: 256, y: 196 },
  markScale: 0.6,
  legend: { y: 356, size: 40, text: 'VERIFIED BY' },
  wordmark: { y: 412, size: 46 },
} as const;

/**
 * Type stack. The runtime badge embeds no font file, so every text element pins
 * its width with textLength: substitution changes the letterforms but never the
 * lockup.
 */
export const FONT_STACK = "Poppins, Montserrat, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

/*
 * vibefycode-copy-lint-allow-block: this is the one place the two halves of the
 * wordmark are named separately, because the artwork sets them in two weights.
 * The brand gate asserts they join back to VIBEFYCODE, so the halves cannot
 * drift apart into two words here.
 */
/**
 * The wordmark, split.
 *
 * The strong half is set bold and "CODE" regular, as the supplied artwork sets
 * them. They are two runs of one word, never two words — the mark is VibefyCode.
 */
export const WORDMARK = { strong: 'VIBEFY', light: 'CODE' } as const;
/* vibefycode-copy-lint-allow-block-end */

export const PALETTE = {
  navy: '#16205A',
  blue: '#1F5FE0',
  azure: '#2E9BE0',
  teal: '#2FD3C4',
  ink: '#0B1230',
  mist: '#F4F7FC',
  /** The arrow. Decorative only — it fails AA as body text and is banned as such. */
  amber: '#E8730C',
  amberLight: '#F9A03F',
  /** The seal's printed furniture: ring text, guilloche, rules. */
  sand: '#9C8F79',
  sandLight: '#C9C0B0',
  /** Circuit traces. */
  trace: '#C7D0DE',
} as const;

/**
 * Text set around a circle, placed glyph by glyph.
 *
 * SVG has `textPath` for exactly this, and we do not use it. The seal is the one
 * artefact that has to render identically in a browser, in a PDF, in whatever
 * rasteriser a customer's CMS reaches for, and in our own PNG pipeline —
 * and `textPath` is unevenly supported outside browsers. librsvg silently
 * renders nothing, which is how you ship a trust mark with no wordmark on it.
 *
 * So the placement is arithmetic instead: one glyph, one rotation, no renderer
 * feature beyond `transform`. Angles are degrees clockwise from twelve o'clock.
 */
export interface ArcGlyph {
  readonly char: string;
  readonly x: number;
  readonly y: number;
  /** Degrees, for a `rotate()` transform about the glyph's own origin. */
  readonly rotation: number;
}

export function arcTextPlacements(options: {
  text: string;
  radius: number;
  /** Angle the run is centred on. 0 is twelve o'clock, 180 is six o'clock. */
  centreAngle: number;
  /** Degrees between adjacent glyph centres. */
  step: number;
  cx?: number;
  cy?: number;
  /** True for a run along the bottom, so the glyphs stay upright to the reader. */
  flip?: boolean;
}): ArcGlyph[] {
  const { text, radius, centreAngle, step, cx = 256, cy = 256, flip = false } = options;
  const chars = [...text];
  const direction = flip ? -1 : 1;
  const first = centreAngle - (direction * step * (chars.length - 1)) / 2;

  return chars.map((char, index) => {
    const angle = first + direction * step * index;
    const radians = (angle * Math.PI) / 180;
    return {
      char,
      x: cx + radius * Math.sin(radians),
      y: cy - radius * Math.cos(radians),
      rotation: flip ? angle + 180 : angle,
    };
  });
}
