/**
 * Vibefy mark geometry — the single source for every derived asset, and for the
 * badge rendered at request time.
 *
 * The founder's artwork in brand/source/ is the authority. These paths are a
 * clean vector reconstruction of it, not a redesign: same forms, same palette,
 * same proportions. Nothing here may be "improved" — see PART 0.5 of the build
 * brief and the badge usage rules. When the original vector files arrive, the
 * paths below are replaced from them; every derivative regenerates unchanged in
 * shape and count.
 */

export const VIEWBOX = 512;

/** The swoosh check, its inner chevron, and the three signal arcs. */
export const MARK = {
  swoosh: 'M88 176 C112 306 162 378 212 398 C266 418 306 360 334 302 C368 230 404 164 434 122',
  swooshWidth: 60,
  chevron: 'M196 272 L250 328 L332 218',
  chevronWidth: 32,
  arcs: [
    { d: 'M394.8 90.2 A60 60 0 0 1 454.4 124.6', opacity: 0.95 },
    { d: 'M392.5 64.3 A86 86 0 0 1 477.9 113.7', opacity: 0.8 },
    { d: 'M390.2 38.4 A112 112 0 0 1 501.5 102.7', opacity: 0.65 },
  ],
  arcWidth: 14,
};

/** The certification badge: double ring, shield, check. */
export const BADGE = {
  outerRing: { r: 243, width: 17 },
  innerRing: { r: 219, width: 11 },
  shield:
    'M204 116 C240 148 286 164 318 167 L318 288 C318 354 272 400 204 428 C136 400 90 354 90 288 L90 167 C122 164 168 148 204 116 Z',
  shieldInner:
    'M204 132 C238 161 280 176 308 179 L308 287 C308 346 266 388 204 413 C142 388 100 346 100 287 L100 179 C128 176 170 161 204 132 Z',
  check: 'M150 278 L192 322 L280 214',
  checkWidth: 30,
  /** Drawn instead of the check on any state that is not currently verified. */
  bar: 'M150 272 L262 272',
  barWidth: 26,
};

/**
 * Type stack. The runtime badge in M3 embeds a subset webfont so that a badge
 * on someone else's site never depends on a font that machine happens to have;
 * until then every text element pins its width with textLength so substitution
 * changes the letterforms but never the lockup.
 */
export const FONT_STACK = "Poppins, Montserrat, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

export const PALETTE: Readonly<Record<string, string>> = {
  navy: '#16205A',
  blue: '#1F5FE0',
  azure: '#2E9BE0',
  teal: '#2FD3C4',
  ink: '#0B1230',
  mist: '#F4F7FC',
};
