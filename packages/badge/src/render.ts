/**
 * The badge, rendered at request time.
 *
 * Served from our origin on every load rather than handed out as a file — which
 * is the whole mechanism behind revocation. A customer cannot cache a badge that
 * says "verified" after we have suspended it, because they never had one.
 *
 * The mark itself is never altered: no recolouring, no added text inside the
 * circle, no per-app variation of the artwork. What varies is the status variant
 * (active, suspended, expired, revoked) and the accessible description, which is
 * where PART 0.5 permits the rubric version and assessment date to live.
 *
 * The document is deliberately plain: no script, no external reference, no
 * embedded font file. It renders identically in an `<img>` on a third-party page,
 * which is the only place it is ever used.
 */
import { MARK, MARK_OUTLINE, PALETTE, VIEWBOX, badgeAltText } from '@vibefycode/shared';
import { BADGE_ARTWORK } from './artwork.generated.ts';

export type BadgeStatus = 'active' | 'suspended' | 'expired' | 'revoked';

export interface BadgeRenderFacts {
  readonly status: BadgeStatus;
  /**
   * The facts about a specific badge. Absent when rendering the generic brand
   * master for print and marketing, where naming an application would be a lie.
   */
  readonly appName?: string;
  readonly rubricVersion?: string;
  readonly assessedOn?: string;
  readonly verificationUrl?: string;
  /**
   * The width the badge will actually be rendered at, when the caller knows it.
   *
   * The embed snippet knows, because the customer chose it, so it travels in the
   * image URL. Below SEAL.minimumDetailPx the compact layout is served: the same
   * mark and the same words, with the printed furniture removed rather than
   * shrunk into illegibility.
   */
  readonly sizePx?: number;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const GRADIENT_STOPS = [
  { color: PALETTE.teal, offset: '0%' },
  { color: PALETTE.azure, offset: '48%' },
  { color: PALETTE.blue, offset: '100%' },
];

const ARROW_STOPS = [
  { color: PALETTE.azure, offset: '0%' },
  { color: PALETTE.amber, offset: '62%' },
  { color: PALETTE.amberLight, offset: '100%' },
];

/**
 * The V, the arrow and the furniture around them, as one reusable group.
 *
 * `detail` is the switch that keeps the mark honest when it is small: below
 * SEAL.minimumDetailPx the circuit traces and the bars are not drawn faintly,
 * they are not drawn. A texture nobody can resolve is dirt on the mark.
 */
function markGroup(options: {
  idPrefix: string;
  mono?: boolean;
  detail?: boolean;
  onDark?: boolean;
}): string {
  const { idPrefix, mono = false, detail = true } = options;
  const ribbon = mono ? 'currentColor' : `url(#${idPrefix}-ribbon)`;
  const arrow = mono ? 'currentColor' : `url(#${idPrefix}-arrow)`;
  const trace = mono ? 'currentColor' : PALETTE.trace;

  const furniture = detail
    ? `
    <g stroke="${trace}" stroke-width="${MARK.traceWidth}" fill="none" opacity="${mono ? 0.45 : 1}">
${MARK.traces.map((t) => `      <path d="${t.d}"/>`).join('\n')}
    </g>
    <g fill="${trace}" opacity="${mono ? 0.45 : 1}">
${MARK.traces.map((t) => `      <circle cx="${t.dot.cx}" cy="${t.dot.cy}" r="${MARK.traceDotRadius}"/>`).join('\n')}
${MARK.bars.map((b) => `      <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="3"/>`).join('\n')}
    </g>`
    : '';

  const surface = options.onDark ? PALETTE.ink : '#FFFFFF';

  return `  <g fill="none" stroke-linecap="round" stroke-linejoin="round">${furniture}
    <path d="${MARK.arrowShaft}" stroke="${arrow}" stroke-width="${MARK.arrowShaftWidth}"/>
    <path d="${MARK.arrowHead}" fill="${mono ? 'currentColor' : PALETTE.amber}" stroke="none"/>
    <path d="${MARK.ribbonBack}" stroke="${mono ? 'currentColor' : PALETTE.teal}" stroke-width="${MARK.ribbonWidth}"${mono ? ' opacity="0.55"' : ''}/>
    <path d="${MARK.ribbonFront}" stroke="${surface}" stroke-width="${MARK.knockoutWidth}"/>
    <path d="${MARK.ribbonFront}" stroke="${ribbon}" stroke-width="${MARK.ribbonWidth}"/>
  </g>`;
}

/**
 * Two hex colours, blended.
 *
 * Used to build the seal's brushed-metal band out of one ink rather than out of
 * five hand-picked colours: the four states each get the same treatment in
 * their own hue, so a suspended badge reads as the same object in a different
 * mood rather than as a different badge.
 */
function mix(from: string, to: string, amount: number): string {
  const channel = (hex: string, at: number) => Number.parseInt(hex.slice(at, at + 2), 16);
  const blend = (at: number) =>
    Math.round(channel(from, at) + (channel(to, at) - channel(from, at)) * amount)
      .toString(16)
      .padStart(2, '0');
  return `#${blend(1)}${blend(3)}${blend(5)}`;
}

/**
 * The band, the field and the rim.
 *
 * The supplied artwork is a photographic chrome seal on a dark centre. That
 * cannot be reproduced — it is shaded pixels, and this file emits an SVG on
 * every request so a revoked badge stops reading as verified within minutes.
 * What a flat vector *can* do is the thing the chrome is actually saying: a
 * struck metal ring catching light on two sides, around a dark field.
 *
 * So the band is a diagonal sweep from a lit edge through the ink to a shadowed
 * edge, and the field is a dark disc lifted slightly at its centre. Three stops
 * and a radial. It reads as an object rather than as a printed circle, and it
 * survives being scaled to 96px, which the photograph does not.
 */
/**
 * The band's colour when the badge is in force.
 *
 * A warm grey rather than a blue-grey: the mark is teal and blue, and a cold
 * ring around it makes the whole seal read as one temperature with no centre.
 */
const SEAL_STEEL = '#C3C7CE';

function sealGradients(ink: string): string {
  const lit = mix(ink, '#FFFFFF', 0.34);
  const shadow = mix(ink, '#000000', 0.42);
  const fieldCentre = mix(PALETTE.ink, '#FFFFFF', 0.1);

  return `    <linearGradient id="seal-band" x1="0.08" y1="0" x2="0.92" y2="1">
      <stop offset="0%" stop-color="${lit}"/>
      <stop offset="34%" stop-color="${ink}"/>
      <stop offset="72%" stop-color="${shadow}"/>
      <stop offset="100%" stop-color="${mix(ink, '#FFFFFF', 0.18)}"/>
    </linearGradient>
    <radialGradient id="seal-field" cx="0.5" cy="0.42" r="0.72">
      <stop offset="0%" stop-color="${fieldCentre}"/>
      <stop offset="100%" stop-color="${PALETTE.ink}"/>
    </radialGradient>`;
}

function markGradients(idPrefix: string): string {
  return `    <linearGradient id="${idPrefix}-ribbon" x1="0" y1="0" x2="1" y2="1">
${GRADIENT_STOPS.map((stop) => `      <stop offset="${stop.offset}" stop-color="${stop.color}"/>`).join('\n')}
    </linearGradient>
    <linearGradient id="${idPrefix}-arrow" x1="0" y1="1" x2="1" y2="0">
${ARROW_STOPS.map((stop) => `      <stop offset="${stop.offset}" stop-color="${stop.color}"/>`).join('\n')}
    </linearGradient>`;
}

/**
 * What the badge says about itself, to a screen reader and to anything that
 * reads the file rather than looking at it. This is where the rubric version and
 * the assessment date live, per the badge usage rules.
 */
export function badgeDescription(facts: BadgeRenderFacts): string {
  const specific = facts.appName && facts.rubricVersion && facts.assessedOn;

  if (!specific) {
    return facts.status === 'active'
      ? 'Verified by VibefyCode. Scope-limited assessment, not a security guarantee.'
      : `Not currently verified by VibefyCode — ${facts.status}.`;
  }

  if (facts.status === 'active') {
    return badgeAltText({
      appName: facts.appName!,
      rubricVersion: facts.rubricVersion!,
      assessedOn: facts.assessedOn!,
    });
  }

  return `Not currently verified by VibefyCode — ${facts.status}. ${facts.appName} was assessed against Rubric v${facts.rubricVersion} on ${facts.assessedOn}; that assessment is no longer current.${facts.verificationUrl ? ` See ${facts.verificationUrl}.` : ''}`;
}

/**
 * The seal, served at request time.
 *
 * Four states, none of which is ever a broken image, and every one of them the
 * supplied artwork rather than a rendering of it. The three inactive variants
 * are the same seal drained and struck with a band saying what is no longer
 * true — generated by `pnpm brand:build` from the one source, so they cannot
 * drift apart into four separate brands.
 */
export function renderBadgeSvg(facts: BadgeRenderFacts): string {
  const label = badgeDescription(facts);
  const artwork = BADGE_ARTWORK[facts.status];

  // The supplied artwork, embedded, rather than a drawing of it.
  //
  // This used to assemble the seal in code — the traced mark, the generated
  // wordmark, an arc of text, a struck band. It was a careful reconstruction and
  // it was not the trade mark, and the mark is the one thing that has to be
  // identical everywhere it appears. A rating whose own mark drifts is not one
  // to trust with anything else.
  //
  // Two properties survive the change unaltered, and they are the ones that
  // matter: this document is still built per request from our origin, which is
  // what makes revocation take effect within minutes, and the status is still
  // chosen here rather than by the customer. What is gone is the drawing.
  //
  // A data URI rather than a link to a file. An `<img>` on a third-party page
  // will not fetch a second resource from us — many pages forbid it outright —
  // so a badge that referenced its own artwork would render as a blank frame on
  // exactly the sites it exists to appear on.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" role="img"
     aria-label="${escapeXml(label)}" width="${VIEWBOX}" height="${VIEWBOX}">
  <title>${escapeXml(label)}</title>
  <desc>${escapeXml(
    `A VibefyCode assessment is point-in-time and scope-limited. It is not a penetration test, a security audit, or a guarantee.${
      facts.verificationUrl ? ` Verify at ${facts.verificationUrl}` : ''
    }`,
  )}</desc>
  <image href="${artwork.dataUri}" x="0" y="0" width="${VIEWBOX}" height="${VIEWBOX}"
         preserveAspectRatio="xMidYMid meet"/>
</svg>
`;
}

/** The mark on its own, for the console, the app icon and the verification page. */
export function renderMarkSvg(options: { mono?: boolean; onDark?: boolean } = {}): string {
  const mono = options.mono === true;

  // The single-colour master is the traced artwork rather than the drawn
  // geometry. A silhouette is exactly what a trace produces well, and exactly
  // what a mono mark is — so this is the one place the supplied outline can be
  // used without losing anything. The colour mark keeps `MARK`, whose weave is
  // carried by two overlapping strokes and a knockout; the trace has no colours
  // to separate those with, and flattens them into one shape.
  //
  // Its 21 KB is affordable here and nowhere else: these two masters are
  // downloaded once by whoever needs a press asset, not served on every page
  // load like the badge.
  if (mono) {
    const ink = options.onDark ? PALETTE.mist : PALETTE.navy;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK_OUTLINE.viewBox} ${MARK_OUTLINE.viewBox}" role="img" aria-label="VibefyCode">
  <title>VibefyCode</title>
  <g fill="${ink}" fill-rule="evenodd">
${MARK_OUTLINE.paths.map((d) => `    <path d="${d}"/>`).join('\n')}
  </g>
</svg>
`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" role="img" aria-label="VibefyCode">
  <title>VibefyCode</title>
  <defs>
${markGradients('mark')}
  </defs>
${markGroup({ idPrefix: 'mark', ...(options.onDark ? { onDark: true } : {}) })}
</svg>
`;
}
