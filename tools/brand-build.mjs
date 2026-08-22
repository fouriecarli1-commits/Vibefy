#!/usr/bin/env node
/**
 * Brand asset pipeline.
 *
 * One geometry source (brand/geometry.mjs) produces every SVG variant, every
 * PNG export and the full app-icon set. Derivatives are generated, never
 * hand-edited: a mark that drifts between the header, the PDF and the badge is
 * a mark nobody recognises.
 *
 *   node tools/brand-build.mjs            build SVG masters and raster exports
 *   node tools/brand-build.mjs --svg-only skip rasterisation (no sharp needed)
 */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BADGE, FONT_STACK, MARK, PALETTE, VIEWBOX } from '../brand/geometry.mjs';
import tokens from '../packages/shared/design/tokens.json' with { type: 'json' };

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svgDir = join(root, 'brand/svg');
const pngDir = join(root, 'brand/png');
const iconDir = join(root, 'brand/icons');
// The web app serves the marks from its own public directory. It is populated
// by this pipeline rather than by a manual copy, so the header, the PDF and the
// badge can never end up showing three different vintages of the same logo.
const webPublicDir = join(root, 'apps/web/public/brand');

const gradientStops = tokens.gradient.primaryStops
  .map((stop) => `      <stop offset="${stop.offset}" stop-color="${stop.color}"/>`)
  .join('\n');

// ---------------------------------------------------------------------------
// SVG masters
// ---------------------------------------------------------------------------

function markSvg({ mono = false, onDark = false } = {}) {
  const stroke = mono ? 'currentColor' : 'url(#vibefy-mark-gradient)';
  const chevron = mono ? 'currentColor' : 'url(#vibefy-check-gradient)';
  const arcColour = mono ? 'currentColor' : PALETTE.teal;
  const defs = mono
    ? ''
    : `  <defs>
    <linearGradient id="vibefy-mark-gradient" x1="0" y1="1" x2="1" y2="0">
${gradientStops}
    </linearGradient>
    <linearGradient id="vibefy-check-gradient" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stop-color="${PALETTE.azure}"/>
      <stop offset="100%" stop-color="#39E4D2"/>
    </linearGradient>
  </defs>\n`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" role="img" aria-label="Vibefy"${
    mono ? ` color="${onDark ? PALETTE.mist : PALETTE.navy}"` : ''
  }>
  <title>Vibefy</title>
${defs}  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="${MARK.swoosh}" stroke="${stroke}" stroke-width="${MARK.swooshWidth}"/>
    <path d="${MARK.chevron}" stroke="${chevron}" stroke-width="${MARK.chevronWidth}"/>
    <g stroke="${arcColour}" stroke-width="${MARK.arcWidth}">
${MARK.arcs.map((arc) => `      <path d="${arc.d}" opacity="${mono ? 1 : arc.opacity}"/>`).join('\n')}
    </g>
  </g>
</svg>
`;
}

function badgeSvg(status = 'active') {
  const colours = tokens.badgeStatus[status];
  if (!colours) throw new Error(`Unknown badge status: ${status}`);
  const active = status === 'active';

  const ring = active ? 'url(#vibefy-badge-ring)' : colours.ring;
  const shieldFill = active ? 'url(#vibefy-badge-shield)' : colours.accent;
  const markFill = active ? 'url(#vibefy-badge-check)' : '#FFFFFF';

  const defs = active
    ? `  <defs>
    <linearGradient id="vibefy-badge-ring" x1="0.15" y1="0" x2="0.2" y2="1">
${gradientStops}
    </linearGradient>
    <linearGradient id="vibefy-badge-shield" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2E6FE4"/>
      <stop offset="100%" stop-color="#2AA6DE"/>
    </linearGradient>
    <linearGradient id="vibefy-badge-check" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stop-color="#39E4D2"/>
      <stop offset="100%" stop-color="#8FF3E8"/>
    </linearGradient>
  </defs>\n`
    : '';

  // An inactive badge is never a broken image and never the active mark in a
  // different colour. It says, in words, that the application is not currently
  // verified, and names the state. The layout is centred rather than the active
  // lockup, so the two are distinguishable at a glance and at thumbnail size.
  const label = active
    ? 'Verified by Vibefy'
    : `Not currently verified by Vibefy — ${colours.label}`;

  const activeLines = `  <g fill="${PALETTE.navy}" font-family="${FONT_STACK}" font-weight="700" lengthAdjust="spacingAndGlyphs">
    <text x="280" y="238" textLength="182" font-size="58">Verified</text>
    <text x="280" y="306" textLength="62" font-size="58">by</text>
    <text x="280" y="374" textLength="148" font-size="58">Vibefy</text>
  </g>`;

  const inactiveLines = `  <g fill="${active ? PALETTE.navy : colours.text}" font-family="${FONT_STACK}"
     text-anchor="middle" lengthAdjust="spacingAndGlyphs">
    <text x="256" y="308" font-size="46" font-weight="700" textLength="190">${colours.label}</text>
    <text x="256" y="358" font-size="31" font-weight="500" textLength="176">Not currently</text>
    <text x="256" y="396" font-size="31" font-weight="500" textLength="266">verified by Vibefy</text>
  </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" role="img" aria-label="${label}">
  <title>${label}</title>
${defs}  <g fill="none" stroke="${ring}">
    <circle cx="256" cy="256" r="${BADGE.outerRing.r}" stroke-width="${BADGE.outerRing.width}"/>
    <circle cx="256" cy="256" r="${BADGE.innerRing.r}" stroke-width="${BADGE.innerRing.width}"/>
  </g>
  <g${active ? '' : ' transform="translate(256 190) scale(0.58) translate(-204 -272)"'}>
    <path d="${BADGE.shield}" fill="${shieldFill}"/>
    <path d="${BADGE.shieldInner}" fill="none" stroke="${active ? PALETTE.blue : colours.ring}" stroke-width="9" opacity="0.55"/>
    <path d="${active ? BADGE.check : BADGE.bar}" fill="none" stroke="${markFill}"
          stroke-width="${active ? BADGE.checkWidth : BADGE.barWidth}" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
${active ? activeLines : inactiveLines}
</svg>
`;
}

function horizontalLockupSvg({ onDark = false } = {}) {
  const wordmarkColour = onDark ? PALETTE.mist : PALETTE.navy;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 420" role="img" aria-label="Vibefy — vibe app rating system">
  <title>Vibefy — vibe app rating system</title>
  <defs>
    <linearGradient id="vibefy-lockup-gradient" x1="0" y1="1" x2="1" y2="0">
${gradientStops}
    </linearGradient>
    <linearGradient id="vibefy-lockup-check" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stop-color="${PALETTE.azure}"/>
      <stop offset="100%" stop-color="#39E4D2"/>
    </linearGradient>
  </defs>
  <g transform="translate(20 30) scale(0.72)" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="${MARK.swoosh}" stroke="url(#vibefy-lockup-gradient)" stroke-width="${MARK.swooshWidth}"/>
    <path d="${MARK.chevron}" stroke="url(#vibefy-lockup-check)" stroke-width="${MARK.chevronWidth}"/>
    <g stroke="${PALETTE.teal}" stroke-width="${MARK.arcWidth}">
${MARK.arcs.map((arc) => `      <path d="${arc.d}" opacity="${arc.opacity}"/>`).join('\n')}
    </g>
  </g>
  <g font-family="${FONT_STACK}" lengthAdjust="spacingAndGlyphs" fill="${wordmarkColour}">
    <text x="430" y="262" font-size="180" font-weight="700" textLength="520">Vibefy</text>
    <text x="436" y="330" font-size="60" font-weight="500" textLength="500">vibe app rating system</text>
  </g>
</svg>
`;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const SVG_TARGETS = [
  ['vibefy-mark.svg', markSvg()],
  ['vibefy-mark-mono.svg', markSvg({ mono: true })],
  ['vibefy-mark-mono-dark.svg', markSvg({ mono: true, onDark: true })],
  ['vibefy-logo-horizontal.svg', horizontalLockupSvg()],
  ['vibefy-logo-horizontal-dark.svg', horizontalLockupSvg({ onDark: true })],
  ...Object.keys(tokens.badgeStatus)
    .filter((key) => !key.startsWith('$'))
    .map((status) => [
      status === 'active' ? 'vibefy-badge-verified.svg' : `vibefy-badge-${status}.svg`,
      badgeSvg(status),
    ]),
];

/** Raster exports. Sizes are the ones an actual consumer asks for. */
const PNG_TARGETS = [
  { source: 'vibefy-mark.svg', name: 'vibefy-mark', width: 512 },
  { source: 'vibefy-badge-verified.svg', name: 'vibefy-badge-verified', width: 512 },
  { source: 'vibefy-logo-horizontal.svg', name: 'vibefy-logo-horizontal', width: 1200 },
];

const ICON_TARGETS = [
  { name: 'favicon-16.png', size: 16 },
  { name: 'favicon-32.png', size: 32 },
  { name: 'favicon-48.png', size: 48 },
  { name: 'apple-touch-icon-180.png', size: 180, background: '#FFFFFF', padding: 0.14 },
  { name: 'android-chrome-192.png', size: 192 },
  { name: 'android-chrome-512.png', size: 512 },
  { name: 'maskable-512.png', size: 512, background: '#FFFFFF', padding: 0.2 },
];

async function main() {
  const svgOnly = process.argv.includes('--svg-only');
  mkdirSync(svgDir, { recursive: true });

  for (const [name, contents] of SVG_TARGETS) {
    writeFileSync(join(svgDir, name), contents);
  }
  console.log(`✓ ${SVG_TARGETS.length} SVG masters written to brand/svg/`);

  if (svgOnly) return;

  let sharp;
  try {
    ({ default: sharp } = await import('sharp'));
  } catch {
    console.log(
      '· sharp is not installed — skipping raster exports. Run with --svg-only to silence this.',
    );
    return;
  }

  mkdirSync(pngDir, { recursive: true });
  mkdirSync(iconDir, { recursive: true });

  for (const target of PNG_TARGETS) {
    for (const scale of [1, 2, 3]) {
      const file = join(pngDir, `${target.name}@${scale}x.png`);
      await sharp(join(svgDir, target.source), { density: 300 * scale })
        .resize({ width: target.width * scale })
        .png({ compressionLevel: 9 })
        .toFile(file);
    }
  }
  console.log(`✓ ${PNG_TARGETS.length * 3} PNG exports written to brand/png/ (1x, 2x, 3x)`);

  for (const icon of ICON_TARGETS) {
    const inner = Math.round(icon.size * (1 - (icon.padding ?? 0) * 2));
    let pipeline = sharp(join(svgDir, 'vibefy-mark.svg'), { density: 600 }).resize({
      width: inner,
      height: inner,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
    if (icon.padding) {
      const pad = Math.round((icon.size - inner) / 2);
      pipeline = pipeline.extend({
        top: pad,
        bottom: icon.size - inner - pad,
        left: pad,
        right: icon.size - inner - pad,
        background: icon.background ?? { r: 0, g: 0, b: 0, alpha: 0 },
      });
    }
    if (icon.background) pipeline = pipeline.flatten({ background: icon.background });
    await pipeline.png({ compressionLevel: 9 }).toFile(join(iconDir, icon.name));
  }
  console.log(`✓ ${ICON_TARGETS.length} app icons written to brand/icons/`);

  mkdirSync(webPublicDir, { recursive: true });
  for (const [name] of SVG_TARGETS) copyFileSync(join(svgDir, name), join(webPublicDir, name));
  for (const icon of ICON_TARGETS)
    copyFileSync(join(iconDir, icon.name), join(webPublicDir, icon.name));
  console.log('✓ Web public assets refreshed in apps/web/public/brand/');
}

await main();
