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
import {
  arcTextPlacements,
  FONT_STACK,
  MARK,
  MARK_OUTLINE,
  PALETTE,
  SEAL,
  SEAL_COMPACT,
  VIEWBOX,
  annulusPath,
  starPath,
  wordmarkSvg,
  badgeAltText,
  badgeStatusColours,
} from '@vibefycode/shared';

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
 * One `<text>` per glyph, rotated to sit tangent to the circle.
 *
 * See `arcTextPlacements` for why this is arithmetic rather than `textPath`.
 */
function arcText(options: {
  text: string;
  radius: number;
  centreAngle: number;
  step: number;
  size: number;
  weight: number;
  fill: string;
  flip?: boolean;
}): string {
  const { text, radius, centreAngle, step, size, weight, fill, flip = false } = options;
  return arcTextPlacements({ text, radius, centreAngle, step, ...(flip ? { flip } : {}) })
    .map(
      (glyph) =>
        `    <text x="0" y="0" transform="translate(${glyph.x.toFixed(2)} ${glyph.y.toFixed(2)}) rotate(${glyph.rotation.toFixed(2)})" text-anchor="middle" font-family="${FONT_STACK}" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeXml(glyph.char)}</text>`,
    )
    .join('\n');
}

/**
 * The seal, rendered at request time.
 *
 * Four states, none of which is ever a broken image. The active one is the full
 * seal: a navy band carrying the legend between two stars, the mark on a light
 * field, a banner with the wordmark, and a fan base. The other three keep the
 * silhouette and drop the celebration — same band, same banner, a bar where the
 * mark's colour was, and wording that says plainly what is no longer true.
 */
export function renderBadgeSvg(facts: BadgeRenderFacts): string {
  const colours = badgeStatusColours[facts.status];
  const active = facts.status === 'active';
  const label = badgeDescription(facts);
  const compact = typeof facts.sizePx === 'number' && facts.sizePx < SEAL.minimumDetailPx;

  // The band and the banner carry the same ink in every state; only its colour
  // changes, so a suspended badge reads as the same object in a different mood.
  // The active band is struck steel; the other three are struck in their own
  // colour. That is what the supplied artwork does — a silver seal — and it has
  // a second use here: a badge that is in force looks like a different metal
  // from one that is not, before any word is read.
  const ink = active ? SEAL_STEEL : colours.accent;
  // Dark legend on the steel, light legend on the coloured bands. The band is
  // the badge's only large text and it has to carry at any size, so the ink is
  // chosen against its own background rather than fixed.
  const onInk = active ? PALETTE.ink : PALETTE.mist;
  const layout = compact ? SEAL_COMPACT : SEAL;

  // The field is dark, as the supplied artwork has it. That is not decoration:
  // the mark is a luminous ribbon, and it glows on ink where on white it merely
  // sits. It also puts the badge on the same ground as the rest of the product.
  const band = `  <path d="${annulusPath(layout.band.outer, layout.band.inner)}" fill="url(#seal-band)" fill-rule="evenodd"/>
  <circle cx="256" cy="256" r="${layout.field.r}" fill="url(#seal-field)"/>`;

  // Two bright rims and one inside the field. A struck seal is read by its
  // edges: without them the band is a coloured ring, and with them it is a
  // raised object with a lip. Drawn even when compact, unlike the printed
  // furniture, because an edge is legible at any size and a legend is not.
  const rims = `  <circle cx="256" cy="256" r="${layout.band.outer - 2}" fill="none" stroke="${mix(ink, '#FFFFFF', 0.55)}" stroke-width="2.5" opacity="0.55"/>
  <circle cx="256" cy="256" r="${layout.band.inner + 2}" fill="none" stroke="${mix(ink, '#000000', 0.55)}" stroke-width="2.5" opacity="0.5"/>`;

  const rules = compact
    ? rims
    : `${rims}
  <circle cx="256" cy="256" r="${SEAL.bandRule.r}" fill="none" stroke="${onInk}" stroke-width="${SEAL.bandRule.width}" opacity="0.4"/>
  <circle cx="256" cy="256" r="${SEAL.fieldRule.r}" fill="none" stroke="${onInk}" stroke-width="${SEAL.fieldRule.width}" opacity="0.22"/>`;

  const star = (cx: number, cy: number, size: number, fill: string) =>
    `    <path d="${starPath(size)}" transform="translate(${cx} ${cy})" fill="${fill}"/>`;

  const legend = compact
    ? `  <g aria-hidden="true" text-anchor="middle" font-family="${FONT_STACK}">
    <text x="256" y="${active ? SEAL_COMPACT.legend.y : SEAL_COMPACT.inactiveLegend.y}"
          font-size="${active ? SEAL_COMPACT.legend.size : SEAL_COMPACT.inactiveLegend.size}"
          font-weight="700" letter-spacing="3" fill="${ink}"
          textLength="248" lengthAdjust="spacingAndGlyphs">${
            active ? SEAL_COMPACT.legend.text : colours.label.toUpperCase()
          }</text>
  </g>`
    : `  <g aria-hidden="true">
${arcText({
  text: active ? SEAL.topArc.text : colours.label.toUpperCase(),
  radius: SEAL.topArc.r,
  centreAngle: 0,
  step: SEAL.topArc.step,
  size: SEAL.topArc.size,
  weight: 700,
  fill: onInk,
})}
${[-SEAL.topStars.angle, SEAL.topStars.angle]
  .map((angle) => {
    const radians = (angle * Math.PI) / 180;
    return star(
      256 + SEAL.topStars.r * Math.sin(radians),
      256 - SEAL.topStars.r * Math.cos(radians),
      SEAL.topStars.size,
      onInk,
    );
  })
  .join('\n')}
  </g>`;

  // The reference seals put a fan of flutes beneath the banner. It is left out
  // here: it reads as a flourish when it is shaded metal and as a scribble when
  // it is a flat shape, and a trust mark cannot afford an element that looks
  // like a rendering fault.

  const banner = compact
    ? `  <g aria-hidden="true" clip-path="url(#seal-disc)">
    <path d="${SEAL_COMPACT.banner}" fill="${ink}"/>
  </g>
${wordmarkSvg({ x: 256, y: SEAL_COMPACT.bannerText.y, width: SEAL_COMPACT.bannerText.width, fill: onInk })}`
    : `  <g aria-hidden="true">
${SEAL.bannerFolds.map((fold) => `    <path d="${fold}" fill="${active ? PALETTE.ink : colours.ring}"/>`).join('\n')}
    <path d="${SEAL.banner}" fill="${ink}"/>
    <path d="${SEAL.bannerRule}" fill="none" stroke="${onInk}" stroke-width="1.5" opacity="0.4"/>
${SEAL.bannerStars.map((s) => star(s.cx, s.cy, s.size, onInk)).join('\n')}
  </g>
${wordmarkSvg({ x: 256, y: SEAL.bannerText.y, width: SEAL.bannerText.width, fill: onInk })}`;

  // Non-active states say so in words, under the banner, where the eye lands
  // after the wordmark. Never inside the mark, which is never altered.
  const note = compact ? SEAL_COMPACT.statusNote : SEAL.statusNote;
  const disclaimer = active
    ? ''
    : `  <g aria-hidden="true" font-family="${FONT_STACK}" text-anchor="middle" fill="${onInk}">
    <text x="256" y="${note.y}" font-size="${note.size}" font-weight="600">Not currently verified</text>
  </g>`;

  const placement = active ? layout.markCentre : layout.inactiveMark;
  const scale = active ? layout.markScale : layout.inactiveMark.scale;
  // A dimmed mark on a dark field has to be dimmed *towards* the light, not
  // towards the ink. In mono the group paints with `currentColor`, which
  // defaults to black — on the dark field that made the three inactive states
  // render an almost invisible mark, which reads as a broken image rather than
  // as a withdrawn one. So the colour is stated, and the opacity lifted to suit
  // it.
  const mark = `  <g transform="translate(${placement.x} ${placement.y}) scale(${scale}) translate(-256 -256)"${
    active ? '' : ` color="${PALETTE.mist}" opacity="0.3"`
  }>
${markGroup({ idPrefix: 'seal', detail: active && !compact, onDark: true, ...(active ? {} : { mono: true }) })}
  </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" role="img"
     aria-label="${escapeXml(label)}" width="${VIEWBOX}" height="${VIEWBOX}">
  <title>${escapeXml(label)}</title>
  <desc>${escapeXml(
    `A VibefyCode assessment is point-in-time and scope-limited. It is not a penetration test, a security audit, or a guarantee.${
      facts.verificationUrl ? ` Verify at ${facts.verificationUrl}` : ''
    }`,
  )}</desc>
  <defs>
${markGradients('seal')}
${sealGradients(ink)}
    <clipPath id="seal-disc"><circle cx="256" cy="256" r="${layout.band.outer}"/></clipPath>
  </defs>
${band}
${rules}
${legend}
${mark}
${disclaimer}
${banner}
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
