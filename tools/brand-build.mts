#!/usr/bin/env tsx
/**
 * Brand asset pipeline.
 *
 * One geometry source — `@vibefycode/shared` — produces every SVG master, every PNG
 * export and the full app-icon set, and the same renderer produces the badge
 * served at request time. Before this, the build-time masters and the runtime
 * badge were separate implementations of the same artwork, which is precisely
 * how a mark ends up looking different on a customer's site than in our own
 * header.
 *
 *   pnpm brand:build              build SVG masters and raster exports
 *   pnpm brand:build --svg-only   skip rasterisation
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderBadgeSvg, renderMarkSvg, type BadgeStatus } from '@vibefycode/badge';
import { FONT_STACK, PALETTE, badgeStatusColours, wordmarkSvg } from '@vibefycode/shared';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svgDir = join(root, 'brand/svg');
const pngDir = join(root, 'brand/png');
const iconDir = join(root, 'brand/icons');
const mobileAssetDir = join(root, 'apps/mobile/assets');
// The web app serves the marks from its own public directory, populated by this
// pipeline rather than by a manual copy.
const webPublicDir = join(root, 'apps/web/public/brand');

/**
 * The supplied lockup, served as-is on the welcome page.
 *
 * `supplied-lockup-transparent.svg` is the one supplied file that is both clean
 * and usable: a transparent background, no watermark burned into its pixels,
 * the mark in full colour and the wordmark as real outlines. The badge renders
 * in the same family carry "Made with AI" in the top right corner, which a
 * trust mark cannot show, so they stay out.
 */
const HERO_ARTWORK = 'vibefycode-hero.svg';
const HERO_ARTWORK_DARK = 'vibefycode-hero-dark.svg';
/** The ink the artwork sets its wordmark in — for a white page. */
const HERO_WORDMARK_INK = '#002344';
const heroSource = join(root, 'brand/source/supplied-lockup-transparent.svg');

/**
 * The horizontal lockup: mark on the left, wordmark on the right.
 *
 * The wordmark is one word in two weights — VIBEFY bold, CODE regular — exactly
 * as the supplied artwork sets it. Setting it as two words, or hyphenating it,
 * or spacing it out, all turn the mark into something we do not own.
 */
function horizontalLockupSvg({ onDark = false } = {}): string {
  const wordmarkColour = onDark ? PALETTE.mist : PALETTE.navy;
  const markSvg = renderMarkSvg()
    .replace(/^[\s\S]*?<title>VibefyCode<\/title>\n/, '')
    .replace(/<\/svg>\n?$/, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 420" role="img" aria-label="VibefyCode — vibe app rating system">
  <title>VibefyCode — vibe app rating system</title>
  <g transform="translate(36 18) scale(0.74)">
${markSvg}  </g>
${wordmarkSvg({ x: 886, y: 250, width: 880, fill: wordmarkColour })}
  <g font-family="${FONT_STACK}" fill="${wordmarkColour}">
    <!-- The tagline stays live text. It describes the product; it is not the mark,
         and a substituted font changes nothing anyone could be misled by. -->
    <text x="450" y="322" font-size="48" font-weight="500" textLength="560" lengthAdjust="spacingAndGlyphs">vibe app rating system</text>
  </g>
</svg>
`;
}

const SVG_TARGETS: readonly [string, string][] = [
  ['vibefycode-mark.svg', renderMarkSvg()],
  ['vibefycode-mark-mono.svg', renderMarkSvg({ mono: true })],
  ['vibefycode-mark-mono-dark.svg', renderMarkSvg({ mono: true, onDark: true })],
  ['vibefycode-logo-horizontal.svg', horizontalLockupSvg()],
  ['vibefycode-logo-horizontal-dark.svg', horizontalLockupSvg({ onDark: true })],
  // The compact layout is a master in its own right: it is what most customers
  // actually display, so it is gated and reviewed like everything else.
  ['vibefycode-badge-verified-compact.svg', renderBadgeSvg({ status: 'active', sizePx: 96 })],
  ...(Object.keys(badgeStatusColours).filter((key) => !key.startsWith('$')) as BadgeStatus[]).map(
    (status): [string, string] => [
      status === 'active' ? 'vibefycode-badge-verified.svg' : `vibefycode-badge-${status}.svg`,
      // No app, no date: a generic master that named an application would be a lie.
      renderBadgeSvg({ status }),
    ],
  ),
];

const PNG_TARGETS = [
  { source: 'vibefycode-mark.svg', name: 'vibefycode-mark', width: 512 },
  { source: 'vibefycode-badge-verified.svg', name: 'vibefycode-badge-verified', width: 512 },
  { source: 'vibefycode-logo-horizontal.svg', name: 'vibefycode-logo-horizontal', width: 1200 },
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

/**
 * Every output directory is emptied before it is written.
 *
 * Without this a renamed asset leaves its predecessor behind, and the web app
 * keeps serving the old mark from a path nothing generates any more — which is
 * exactly what happened when Vibefy became VibefyCode. `brand/svg/` is gated
 * against stray files; the others are gitignored and were not.
 */
function reset(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

async function main(): Promise<void> {
  const svgOnly = process.argv.includes('--svg-only');
  reset(svgDir);

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

  reset(pngDir);
  reset(iconDir);

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
    let pipeline = sharp(join(svgDir, 'vibefycode-mark.svg'), { density: 600 }).resize({
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
  await sharp(join(svgDir, 'vibefycode-logo-horizontal.svg'), { density: 600 })
    .resize({ width: 1200, height: 600, fit: 'contain', background: '#FFFFFF' })
    .flatten({ background: '#FFFFFF' })
    .png({ compressionLevel: 9 })
    .toFile(join(mobileAssetDir, 'splash.png'));
  console.log('✓ Mobile icons and splash written to apps/mobile/assets/');

  reset(webPublicDir);
  for (const [name] of SVG_TARGETS) copyFileSync(join(svgDir, name), join(webPublicDir, name));
  for (const icon of ICON_TARGETS)
    copyFileSync(join(iconDir, icon.name), join(webPublicDir, icon.name));

  // The founder's own artwork, published for the welcome page.
  //
  // Twice: as supplied, and with the wordmark's ink swapped for the dark-surface
  // token. The artwork was drawn for a white page — its letters are #002344,
  // which on this product's own background is very nearly invisible. Only the
  // `fill` attribute changes, and only on the wordmark; every curve, colour and
  // proportion of the drawing is untouched. This is the same light/dark pair
  // every other master in this brand already ships, and the alternative is a
  // logo you cannot read on the page it belongs to.
  copyFileSync(heroSource, join(webPublicDir, HERO_ARTWORK));
  const supplied = readFileSync(heroSource, 'utf8');
  const onDark = supplied.replaceAll(`fill="${HERO_WORDMARK_INK}"`, `fill="${PALETTE.mist}"`);
  if (onDark === supplied) {
    throw new Error(
      `The supplied lockup no longer inks its wordmark ${HERO_WORDMARK_INK}. Read it before shipping a hero nobody can read.`,
    );
  }
  writeFileSync(join(webPublicDir, HERO_ARTWORK_DARK), onDark);
  console.log(
    `✓ Web public assets refreshed in apps/web/public/brand/ (hero artwork ${Math.round(statSync(heroSource).size / 1024)} KB, light and dark)`,
  );
}

await main();
