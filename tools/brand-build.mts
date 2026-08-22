#!/usr/bin/env tsx
/**
 * Brand asset pipeline.
 *
 * One geometry source — `@vibefy/shared` — produces every SVG master, every PNG
 * export and the full app-icon set, and the same renderer produces the badge
 * served at request time. Before this, the build-time masters and the runtime
 * badge were separate implementations of the same artwork, which is precisely
 * how a mark ends up looking different on a customer's site than in our own
 * header.
 *
 *   pnpm brand:build              build SVG masters and raster exports
 *   pnpm brand:build --svg-only   skip rasterisation
 */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderBadgeSvg, renderMarkSvg, type BadgeStatus } from '@vibefy/badge';
import { FONT_STACK, MARK, PALETTE, badgeStatusColours, gradient } from '@vibefy/shared';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svgDir = join(root, 'brand/svg');
const pngDir = join(root, 'brand/png');
const iconDir = join(root, 'brand/icons');
const mobileAssetDir = join(root, 'apps/mobile/assets');
// The web app serves the marks from its own public directory, populated by this
// pipeline rather than by a manual copy.
const webPublicDir = join(root, 'apps/web/public/brand');

const gradientStops = gradient.primaryStops
  .map((stop) => `      <stop offset="${stop.offset}" stop-color="${stop.color}"/>`)
  .join('\n');

function horizontalLockupSvg({ onDark = false } = {}): string {
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

const SVG_TARGETS: readonly [string, string][] = [
  ['vibefy-mark.svg', renderMarkSvg()],
  ['vibefy-mark-mono.svg', renderMarkSvg({ mono: true })],
  ['vibefy-mark-mono-dark.svg', renderMarkSvg({ mono: true, onDark: true })],
  ['vibefy-logo-horizontal.svg', horizontalLockupSvg()],
  ['vibefy-logo-horizontal-dark.svg', horizontalLockupSvg({ onDark: true })],
  ...(Object.keys(badgeStatusColours).filter((key) => !key.startsWith('$')) as BadgeStatus[]).map(
    (status): [string, string] => [
      status === 'active' ? 'vibefy-badge-verified.svg' : `vibefy-badge-${status}.svg`,
      // No app, no date: a generic master that named an application would be a lie.
      renderBadgeSvg({ status }),
    ],
  ),
];

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
  // Expo. `icon` is the App Store / Play listing icon and must be opaque;
  // `adaptive-icon` is the Android foreground layer and carries its own safe-area
  // padding, because Android crops it to whatever shape the launcher wants.
  { name: 'icon.png', size: 1024, background: '#FFFFFF', padding: 0.12 },
  { name: 'adaptive-icon.png', size: 1024, padding: 0.26 },
] as const;

async function main(): Promise<void> {
  const svgOnly = process.argv.includes('--svg-only');
  mkdirSync(svgDir, { recursive: true });

  for (const [name, contents] of SVG_TARGETS) writeFileSync(join(svgDir, name), contents);
  console.log(`✓ ${SVG_TARGETS.length} SVG masters written to brand/svg/`);

  if (svgOnly) return;

  let sharp;
  try {
    ({ default: sharp } = await import('sharp'));
  } catch {
    console.log('· sharp is not installed — skipping raster exports.');
    return;
  }

  mkdirSync(pngDir, { recursive: true });
  mkdirSync(iconDir, { recursive: true });

  for (const target of PNG_TARGETS) {
    for (const scale of [1, 2, 3]) {
      await sharp(join(svgDir, target.source), { density: 300 * scale })
        .resize({ width: target.width * scale })
        .png({ compressionLevel: 9 })
        .toFile(join(pngDir, `${target.name}@${scale}x.png`));
    }
  }
  console.log(`✓ ${PNG_TARGETS.length * 3} PNG exports written to brand/png/ (1x, 2x, 3x)`);

  for (const icon of ICON_TARGETS) {
    const padding = 'padding' in icon ? icon.padding : 0;
    const inner = Math.round(icon.size * (1 - padding * 2));
    let pipeline = sharp(join(svgDir, 'vibefy-mark.svg'), { density: 600 }).resize({
      width: inner,
      height: inner,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
    if (padding) {
      const pad = Math.round((icon.size - inner) / 2);
      pipeline = pipeline.extend({
        top: pad,
        bottom: icon.size - inner - pad,
        left: pad,
        right: icon.size - inner - pad,
        background: 'background' in icon ? icon.background : { r: 0, g: 0, b: 0, alpha: 0 },
      });
    }
    if ('background' in icon) pipeline = pipeline.flatten({ background: icon.background });
    await pipeline.png({ compressionLevel: 9 }).toFile(join(iconDir, icon.name));
  }
  console.log(`✓ ${ICON_TARGETS.length} app icons written to brand/icons/`);

  // The mobile app gets its icons from the same masters as the favicon and the
  // badge, so a phone icon cannot drift away from the mark on the website.
  mkdirSync(mobileAssetDir, { recursive: true });
  for (const name of ['icon.png', 'adaptive-icon.png']) {
    copyFileSync(join(iconDir, name), join(mobileAssetDir, name));
  }
  await sharp(join(svgDir, 'vibefy-logo-horizontal.svg'), { density: 600 })
    .resize({ width: 1200, height: 600, fit: 'contain', background: '#FFFFFF' })
    .flatten({ background: '#FFFFFF' })
    .png({ compressionLevel: 9 })
    .toFile(join(mobileAssetDir, 'splash.png'));
  console.log('✓ Mobile icons and splash written to apps/mobile/assets/');

  mkdirSync(webPublicDir, { recursive: true });
  for (const [name] of SVG_TARGETS) copyFileSync(join(svgDir, name), join(webPublicDir, name));
  for (const icon of ICON_TARGETS)
    copyFileSync(join(iconDir, icon.name), join(webPublicDir, icon.name));
  console.log('✓ Web public assets refreshed in apps/web/public/brand/');
}

await main();
