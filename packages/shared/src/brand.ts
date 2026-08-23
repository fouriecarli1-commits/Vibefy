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

import { WORDMARK_OUTLINE } from './wordmark.generated.ts';

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
 * The composition follows the founder-supplied seal renders in
 * `brand/source/reference/`: a legend arced across the top between two stars, the
 * mark on a light field, a banner ribbon carrying the wordmark, and a fan base
 * beneath it.
 *
 * The *artwork* deliberately does not follow them. Those renders are chrome
 * bevels, lens flares and photographic texture; this is flat vector on the
 * palette. Three reasons, none of them aesthetic: the badge is generated as SVG
 * on every request, which is the entire revocation mechanism; the licence
 * permits embedding from 96px, where a rendered-chrome seal is a grey smudge;
 * and every colour in a master has to be a token so the contrast gate can see it.
 *
 * The ring band is filled rather than stroked. Hairline rules disappear first
 * when a seal is scaled down, and this one has to survive being small.
 */
export const SEAL = {
  /** The navy ring band, as an annulus rather than a set of rules. */
  band: { outer: 248, inner: 197 },
  /** A single accent rule inside the band, for the depth the flat fill loses. */
  bandRule: { r: 239, width: 1.5 },
  /** The light field the mark sits on. */
  field: { r: 197 },
  fieldRule: { r: 188, width: 1.5 },

  /** The legend arced across the top of the band, and the stars that close it. */
  topArc: { r: 220, step: 7.6, size: 30, text: 'VERIFIED BY' },
  topStars: { angle: 56, r: 220, size: 13 },

  /**
   * The banner. Two fold tabs behind, then the body, arced so it sits with the
   * circle rather than across it. The ends overhang the disc, as the reference
   * seals have them.
   */
  /**
   * The folded ends, tucked behind the banner in the darker ink.
   *
   * Kept inside the disc. The reference seals let them overhang, which works
   * when the banner is a shaded metal object and reads as two stray rectangles
   * when it is a flat shape.
   */
  bannerFolds: [
    'M100 378 L140 392 L140 450 L100 436 Z',
    'M412 378 L372 392 L372 450 L412 436 Z',
  ],
  banner: 'M120 392 Q256 344 392 392 L392 452 Q256 404 120 452 Z',
  bannerRule: 'M120 402 Q256 354 392 402',
  /** Fitted to the span between the two stars, not to a font size. */
  bannerText: { y: 420, width: 206 },
  bannerStars: [
    { cx: 136, cy: 406, size: 10 },
    { cx: 376, cy: 406, size: 10 },
  ],

  /** Where the mark sits on the field. */
  markCentre: { x: 256, y: 212 },
  markScale: 0.62,

  /**
   * A badge that is not a verification says so in the field, between the mark
   * and the banner — not in the band, where the disc clips it.
   *
   * The mark shrinks to make the room, because the sentence matters more than
   * the artwork on a badge whose whole job is to say the artwork no longer
   * applies.
   */
  inactiveMark: { x: 256, y: 190, scale: 0.5 },
  statusNote: { y: 336, size: 27 },

  /**
   * Below this rendered width the seal is not drawn at all — the compact layout
   * below is used instead. A banner and an arc legend are texture at 512px and
   * illegible at 96px, and the licence permits embedding from 96px.
   */
  minimumDetailPx: 220,
} as const;

/**
 * The seal at embed sizes.
 *
 * Same family, same colours, same banner. What goes is everything that cannot be
 * read at 96px: the arc legend becomes straight text, the stars and the fan base
 * go entirely, and the mark grows into the space they leave.
 */
export const SEAL_COMPACT = {
  band: { outer: 248, inner: 210 },
  field: { r: 210 },
  markCentre: { x: 256, y: 196 },
  markScale: 0.62,
  legend: { y: 338, size: 40, text: 'VERIFIED BY' },
  /** Wider than the disc and clipped to it, so it ends on the edge rather than in the band. */
  banner: 'M20 356 L492 356 L492 424 L20 424 Z',
  bannerText: { y: 410, width: 316 },
  inactiveMark: { x: 256, y: 168, scale: 0.46 },
  inactiveLegend: { y: 292, size: 36 },
  statusNote: { y: 332, size: 26 },
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

/**
 * A five-pointed star, centred on the origin.
 *
 * Generated rather than stored, because the seal uses it at four sizes and a
 * hand-written path per size is four chances to draw a slightly different star.
 */
export function starPath(radius: number, points = 5): string {
  const inner = radius * 0.42;
  const segments: string[] = [];
  for (let index = 0; index < points * 2; index += 1) {
    const r = index % 2 === 0 ? radius : inner;
    const angle = (Math.PI * index) / points - Math.PI / 2;
    segments.push(
      `${index === 0 ? 'M' : 'L'}${(r * Math.cos(angle)).toFixed(2)} ${(r * Math.sin(angle)).toFixed(2)}`,
    );
  }
  return `${segments.join(' ')} Z`;
}

/**
 * An annulus — a filled ring — as a single path with two subpaths and an
 * even-odd fill.
 *
 * Filled rather than stroked because a stroked ring's width is a property of the
 * stroke, and strokes are the first thing a renderer rounds away at small sizes.
 */
export function annulusPath(outer: number, inner: number, cx = 256, cy = 256): string {
  const ring = (r: number) =>
    `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
  return `${ring(outer)} ${ring(inner)}`;
}

/** The wedges of the fan base, radiating from a point below the banner. */
export function fanPaths(fan: {
  x: number;
  y: number;
  radius: number;
  count: number;
  spreadDegrees: number;
}): string[] {
  const step = fan.spreadDegrees / fan.count;
  const first = 90 - fan.spreadDegrees / 2;
  return Array.from({ length: fan.count }, (_, index) => {
    const from = ((first + index * step) * Math.PI) / 180;
    const to = ((first + (index + 0.62) * step) * Math.PI) / 180;
    const point = (angle: number) =>
      `${(fan.x + fan.radius * Math.cos(angle)).toFixed(2)} ${(fan.y + fan.radius * Math.sin(angle)).toFixed(2)}`;
    return `M${fan.x} ${fan.y} L${point(from)} L${point(to)} Z`;
  });
}

/**
 * The wordmark, as SVG markup.
 *
 * Outlines, not text. A logo set in live type changes shape with whatever fonts
 * the viewer happens to have, and this one is served onto other people's
 * websites where it is the trade mark. `textLength` pinned the width and never
 * the letterforms, which was only ever half a fix.
 *
 * Scaled to a width rather than a font size, because what a layout constrains is
 * the space the wordmark has to sit in — and a logo that overflows its banner is
 * worse than one set slightly small.
 */
export function wordmarkSvg(options: {
  x: number;
  y: number;
  width: number;
  fill: string;
}): string {
  const { x, y, width, fill } = options;
  const scale = width / WORDMARK_OUTLINE.width;
  return `  <g fill="${fill}" transform="translate(${(x - width / 2).toFixed(2)} ${y}) scale(${scale.toFixed(6)})">
    <path d="${WORDMARK_OUTLINE.strong}"/>
    <path d="${WORDMARK_OUTLINE.light}"/>
  </g>`;
}
