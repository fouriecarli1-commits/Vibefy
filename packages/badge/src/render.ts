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
  BADGE,
  FONT_STACK,
  MARK,
  PALETTE,
  VIEWBOX,
  badgeAltText,
  badgeStatusColours,
} from '@vibefy/shared';

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
  { color: '#1F5FE0', offset: '0%' },
  { color: '#2E9BE0', offset: '55%' },
  { color: '#2FD3C4', offset: '100%' },
];

/**
 * What the badge says about itself, to a screen reader and to anything that
 * reads the file rather than looking at it. This is where the rubric version and
 * the assessment date live, per the badge usage rules.
 */
export function badgeDescription(facts: BadgeRenderFacts): string {
  const specific = facts.appName && facts.rubricVersion && facts.assessedOn;

  if (!specific) {
    return facts.status === 'active'
      ? 'Verified by Vibefy. Scope-limited assessment, not a security guarantee.'
      : `Not currently verified by Vibefy — ${facts.status}.`;
  }

  if (facts.status === 'active') {
    return badgeAltText({
      appName: facts.appName!,
      rubricVersion: facts.rubricVersion!,
      assessedOn: facts.assessedOn!,
    });
  }

  return `Not currently verified by Vibefy — ${facts.status}. ${facts.appName} was assessed against Rubric v${facts.rubricVersion} on ${facts.assessedOn}; that assessment is no longer current.${facts.verificationUrl ? ` See ${facts.verificationUrl}.` : ''}`;
}

export function renderBadgeSvg(facts: BadgeRenderFacts): string {
  const colours = badgeStatusColours[facts.status];
  const active = facts.status === 'active';
  const label = badgeDescription(facts);

  const gradientStops = GRADIENT_STOPS.map(
    (stop) => `      <stop offset="${stop.offset}" stop-color="${stop.color}"/>`,
  ).join('\n');

  const defs = active
    ? `  <defs>
    <linearGradient id="ring" x1="0.15" y1="0" x2="0.2" y2="1">
${gradientStops}
    </linearGradient>
    <linearGradient id="shield" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2E6FE4"/>
      <stop offset="100%" stop-color="#2AA6DE"/>
    </linearGradient>
    <linearGradient id="check" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stop-color="#39E4D2"/>
      <stop offset="100%" stop-color="#8FF3E8"/>
    </linearGradient>
  </defs>
`
    : '';

  const ring = active ? 'url(#ring)' : colours.ring;
  const shieldFill = active ? 'url(#shield)' : colours.accent;
  const markFill = active ? 'url(#check)' : '#FFFFFF';

  const wordmark = active
    ? `  <g fill="${PALETTE.navy}" font-family="${FONT_STACK}" font-weight="700" lengthAdjust="spacingAndGlyphs">
    <text x="280" y="238" textLength="182" font-size="58">Verified</text>
    <text x="280" y="306" textLength="62" font-size="58">by</text>
    <text x="280" y="374" textLength="148" font-size="58">Vibefy</text>
  </g>`
    : `  <g fill="${colours.text}" font-family="${FONT_STACK}" text-anchor="middle" lengthAdjust="spacingAndGlyphs">
    <text x="256" y="308" font-size="46" font-weight="700" textLength="190">${colours.label}</text>
    <text x="256" y="358" font-size="31" font-weight="500" textLength="176">Not currently</text>
    <text x="256" y="396" font-size="31" font-weight="500" textLength="266">verified by Vibefy</text>
  </g>`;

  const shieldGroup = active
    ? ''
    : ' transform="translate(256 190) scale(0.58) translate(-204 -272)"';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" role="img"
     aria-label="${escapeXml(label)}" width="${VIEWBOX}" height="${VIEWBOX}">
  <title>${escapeXml(label)}</title>
  <desc>${escapeXml(
    `A Vibefy assessment is point-in-time and scope-limited. It is not a penetration test, a security audit, or a guarantee.${
      facts.verificationUrl ? ` Verify at ${facts.verificationUrl}` : ''
    }`,
  )}</desc>
${defs}  <g fill="none" stroke="${ring}">
    <circle cx="256" cy="256" r="${BADGE.outerRing.r}" stroke-width="${BADGE.outerRing.width}"/>
    <circle cx="256" cy="256" r="${BADGE.innerRing.r}" stroke-width="${BADGE.innerRing.width}"/>
  </g>
  <g${shieldGroup}>
    <path d="${BADGE.shield}" fill="${shieldFill}"/>
    <path d="${BADGE.shieldInner}" fill="none" stroke="${active ? PALETTE.blue : colours.ring}" stroke-width="9" opacity="0.55"/>
    <path d="${active ? BADGE.check : BADGE.bar}" fill="none" stroke="${markFill}"
          stroke-width="${active ? BADGE.checkWidth : BADGE.barWidth}" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
${wordmark}
</svg>
`;
}

/** The mark on its own, for the console and the verification page. */
export function renderMarkSvg(options: { mono?: boolean; onDark?: boolean } = {}): string {
  const stroke = options.mono ? 'currentColor' : 'url(#mark)';
  const defs = options.mono
    ? ''
    : `  <defs>
    <linearGradient id="mark" x1="0" y1="1" x2="1" y2="0">
${GRADIENT_STOPS.map((stop) => `      <stop offset="${stop.offset}" stop-color="${stop.color}"/>`).join('\n')}
    </linearGradient>
    <linearGradient id="markCheck" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stop-color="${PALETTE.azure}"/>
      <stop offset="100%" stop-color="#39E4D2"/>
    </linearGradient>
  </defs>
`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" role="img" aria-label="Vibefy"${
    options.mono ? ` color="${options.onDark ? PALETTE.mist : PALETTE.navy}"` : ''
  }>
  <title>Vibefy</title>
${defs}  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="${MARK.swoosh}" stroke="${stroke}" stroke-width="${MARK.swooshWidth}"/>
    <path d="${MARK.chevron}" stroke="${options.mono ? 'currentColor' : 'url(#markCheck)'}" stroke-width="${MARK.chevronWidth}"/>
    <g stroke="${options.mono ? 'currentColor' : PALETTE.teal}" stroke-width="${MARK.arcWidth}">
${MARK.arcs.map((arc) => `      <path d="${arc.d}" opacity="${options.mono ? 1 : arc.opacity}"/>`).join('\n')}
    </g>
  </g>
</svg>
`;
}
