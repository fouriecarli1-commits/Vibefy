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
  PALETTE,
  SEAL,
  SEAL_COMPACT,
  VIEWBOX,
  WORDMARK,
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
    <path d="${MARK.leftRibbon}" stroke="${ribbon}" stroke-width="${MARK.ribbonWidth}"/>
    <path d="${MARK.knot}" stroke="${ribbon}" stroke-width="${MARK.knotWidth}"/>
    <circle cx="${MARK.counter.cx}" cy="${MARK.counter.cy}" r="${MARK.counter.r}" fill="${surface}" stroke="none"/>
    <path d="${MARK.rightRibbon}" stroke="${surface}" stroke-width="${MARK.knockoutWidth}"/>
    <path d="${MARK.rightRibbon}" stroke="${ribbon}" stroke-width="${MARK.ribbonWidth}"/>
  </g>`;
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
 * The wordmark, set as one word in two weights. Never two words.
 *
 * Width is pinned with `textLength`, because the badge embeds no font file: on a
 * machine without Poppins the letterforms change, and without the pin the
 * lockup would change with them.
 */
function wordmarkText(options: {
  x: number;
  y: number;
  size: number;
  fill: string;
  anchor?: string;
}): string {
  const { x, y, size, fill, anchor = 'middle' } = options;
  return `  <text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${FONT_STACK}" font-size="${size}" fill="${fill}" textLength="${(size * 6.6).toFixed(0)}" lengthAdjust="spacingAndGlyphs"><tspan font-weight="700">${WORDMARK.strong}</tspan><tspan font-weight="400">${WORDMARK.light}</tspan></text>`;
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
 * Four states, none of which is ever a broken image. The active one is the
 * printed seal: rings, a band of repeating trust text, guilloche patches, the
 * wordmark on two arcs and the mark in the middle. The other three keep the
 * silhouette and drop the celebration — same rings, same geometry, a bar where
 * the checks are, and wording that says plainly what is no longer true.
 */
export function renderBadgeSvg(facts: BadgeRenderFacts): string {
  const colours = badgeStatusColours[facts.status];
  const active = facts.status === 'active';
  const label = badgeDescription(facts);
  const compact = typeof facts.sizePx === 'number' && facts.sizePx < SEAL.minimumDetailPx;
  const detail = active && !compact;

  const furniture = active ? PALETTE.sand : colours.ring;
  const furnitureLight = active ? PALETTE.sandLight : colours.ring;

  const rings = (compact ? SEAL_COMPACT.rings : SEAL.rings)
    .map(
      (ring) =>
        `    <circle cx="256" cy="256" r="${ring.r}" stroke-width="${ring.width}" opacity="${
          ring.width > 2 ? 1 : 0.65
        }"/>`,
    )
    .join('\n');

  // Repeated rather than stretched: a seal's micro-text is a repeating legend,
  // and stretching one phrase around the ring is the tell of a fake one.
  const microLegend = Array.from({ length: SEAL.microTextRepeats }, () => SEAL.microText).join(
    ' \u00B7 ',
  );
  const microText = detail
    ? `  <g aria-hidden="true" opacity="0.85">
${arcText({
  text: microLegend,
  radius: SEAL.microTextRadius,
  centreAngle: 0,
  step: 360 / microLegend.length,
  size: SEAL.microTextSize,
  weight: 600,
  fill: furniture,
})}
  </g>`
    : '';

  const guilloche = detail
    ? `  <g aria-hidden="true" stroke="${furnitureLight}" stroke-width="0.7" fill="none" opacity="0.45">
${SEAL.guilloche
  .map((patch) =>
    Array.from(
      { length: 7 },
      (_, index) =>
        `      <path d="M${patch.cx - patch.w / 2} ${patch.cy - patch.h / 2 + (index * patch.h) / 6} q${patch.w / 2} ${patch.h / 12} ${patch.w} 0"/>`,
    ).join('\n'),
  )
  .join('\n')}
${SEAL.guilloche
  .map((patch) =>
    Array.from(
      { length: 5 },
      (_, index) =>
        `      <path d="M${patch.cx - patch.w / 2 + (index * patch.w) / 4} ${patch.cy - patch.h / 2} q${patch.w / 10} ${patch.h / 2} 0 ${patch.h}"/>`,
    ).join('\n'),
  )
  .join('\n')}
  </g>`
    : '';

  const checks = detail
    ? `  <g aria-hidden="true" fill="none" stroke="${furniture}" stroke-width="${SEAL.checkWidth}"
       stroke-linecap="round" stroke-linejoin="round" opacity="0.75">
${SEAL.checks
  .map(
    (check) =>
      `      <path d="${SEAL.check}" transform="translate(${check.cx} ${check.cy}) scale(${check.scale})"/>`,
  )
  .join('\n')}
  </g>`
    : '';

  const legend = compact
    ? `  <g aria-hidden="true" text-anchor="middle" font-family="${FONT_STACK}">
    <text x="256" y="${SEAL_COMPACT.legend.y}" font-size="${SEAL_COMPACT.legend.size}" font-weight="700"
          letter-spacing="4" fill="${active ? PALETTE.sand : colours.text}">${
            active ? SEAL_COMPACT.legend.text : colours.label.toUpperCase()
          }</text>
  </g>`
    : active
    ? `  <g aria-hidden="true">
${arcText({
  text: SEAL.topArc.text,
  radius: SEAL.topArc.r,
  centreAngle: 0,
  step: SEAL.topArc.step,
  size: SEAL.topArc.size,
  weight: 700,
  fill: PALETTE.sand,
})}
${arcText({
  text: SEAL.bottomArc.text,
  radius: SEAL.bottomArc.r,
  centreAngle: 180,
  step: SEAL.bottomArc.step,
  size: SEAL.bottomArc.size,
  weight: 700,
  fill: PALETTE.navy,
  flip: true,
})}
  </g>`
      : `  <g aria-hidden="true" font-family="${FONT_STACK}" fill="${colours.text}" text-anchor="middle">
    <text x="256" y="120" font-size="40" font-weight="700" letter-spacing="3" textLength="${
      colours.label.length * 26
    }">${colours.label.toUpperCase()}</text>
    <text x="256" y="452" font-size="28" font-weight="600">Not currently verified by VibefyCode</text>
  </g>`;

  const layout = compact ? SEAL_COMPACT : SEAL;
  const centre = active
    ? `  <g transform="translate(${layout.markCentre.x} ${layout.markCentre.y}) scale(${layout.markScale}) translate(-256 -256)">
${markGroup({ idPrefix: 'seal', detail })}
  </g>
${wordmarkText({ x: 256, y: layout.wordmark.y, size: layout.wordmark.size, fill: PALETTE.navy })}`
    : `  <g transform="translate(${layout.markCentre.x} ${layout.markCentre.y}) scale(${layout.markScale}) translate(-256 -256)" opacity="0.5">
${markGroup({ idPrefix: 'seal', mono: true, detail: false })}
  </g>
${wordmarkText({ x: 256, y: layout.wordmark.y, size: layout.wordmark.size, fill: colours.text })}
  <path d="M180 ${layout.wordmark.y + 26} L332 ${layout.wordmark.y + 26}" stroke="${colours.accent}" stroke-width="14" stroke-linecap="round"/>`;

  // Both spellings of the reference: browsers honour `href`, and librsvg — which
  // is what rasterises our own PNG masters — still only honours `xlink:href`.
  // Emitting one of the two produces a seal with no wordmark on it somewhere.
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" role="img"
     aria-label="${escapeXml(label)}" width="${VIEWBOX}" height="${VIEWBOX}">
  <title>${escapeXml(label)}</title>
  <desc>${escapeXml(
    `A VibefyCode assessment is point-in-time and scope-limited. It is not a penetration test, a security audit, or a guarantee.${
      facts.verificationUrl ? ` Verify at ${facts.verificationUrl}` : ''
    }`,
  )}</desc>
  <defs>
${markGradients('seal')}
  </defs>
  <circle cx="256" cy="256" r="252" fill="#FFFFFF"/>
  <g fill="none" stroke="${furniture}">
${rings}
  </g>
${guilloche}
${microText}
${checks}
${legend}
${centre}
</svg>
`;
}

/** The mark on its own, for the console, the app icon and the verification page. */
export function renderMarkSvg(options: { mono?: boolean; onDark?: boolean } = {}): string {
  const mono = options.mono === true;
  const defs = mono ? '' : `  <defs>\n${markGradients('mark')}\n  </defs>\n`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" role="img" aria-label="VibefyCode"${
    mono ? ` color="${options.onDark ? PALETTE.mist : PALETTE.navy}"` : ''
  }>
  <title>VibefyCode</title>
${defs}${markGroup({
    idPrefix: 'mark',
    ...(mono ? { mono: true } : {}),
    ...(options.onDark ? { onDark: true } : {}),
  })}
</svg>
`;
}
