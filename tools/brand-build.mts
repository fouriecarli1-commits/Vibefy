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
/**
 * The supplied badge, published for the welcome page.
 *
 * This is the founder's trade mark and the only badge he considers acceptable,
 * and it turns out to survive being scaled: legible at the 96 px the Badge
 * Licence permits, and good at 256. The earlier position — that it could not be
 * used at all — was stated more absolutely than the facts supported.
 *
 * One thing is removed and nothing else: Canva's "Made with AI" export pill,
 * which sits in the top-right corner outside the disc and does not touch the
 * seal. The two are cleanly separated in the artwork, and the crop is asserted
 * rather than eyeballed.
 */
const BADGE_ARTWORK = 'vibefycode-badge-artwork.webp';
const badgeSource = join(root, 'brand/source/supplied-badge.svg');
/** The corner the export pill occupies, in the artwork's own 1024 grid. */
const BADGE_WATERMARK = { x: 800, y: 0, width: 224, height: 140 };
/** Twice the largest size the page displays it at, for a retina screen. */
const BADGE_ARTWORK_PX = 640;

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

  const badgeBytes = await buildBadgeArtwork(sharp);
  console.log(
    `✓ Web public assets refreshed in apps/web/public/brand/ (hero ${Math.round(statSync(heroSource).size / 1024)} KB light and dark, badge artwork ${Math.round(badgeBytes / 1024)} KB)`,
  );
}

/**
 * Lifts the seal out of the supplied file and writes it as a transparent PNG.
 *
 * The artwork is two base64 images inside an SVG wrapper: a greyscale mask and
 * the colour layer it masks. Read straight out rather than rendered through the
 * wrapper, because the wrapper also carries the export pill and a C2PA manifest
 * neither of which belongs in a trust mark.
 */
// `sharp` is imported dynamically inside `main` so the SVG masters can still be
// written on a machine without it. It is passed in rather than re-imported, so
// there is one place that decides whether rasterisation is possible.
type Sharp = typeof import('sharp').default;

async function buildBadgeArtwork(sharp: Sharp): Promise<number> {
  const svg = readFileSync(badgeSource, 'utf8');
  const payloads = [...svg.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=\s]+)/g)].map((match) =>
    Buffer.from(match[1]!.replace(/\s/g, ''), 'base64'),
  );
  if (payloads.length !== 2) {
    throw new Error(
      `Expected a mask and a colour layer in ${badgeSource}, found ${payloads.length} images. Read the file before shipping a badge from it.`,
    );
  }
  const [maskPayload, colourPayload] = payloads as [Buffer, Buffer];

  // The mask is read as raw single-channel bytes and edited directly. Doing this
  // through `composite` looked simpler and was wrong twice: compositing promotes
  // a greyscale image to three channels, `joinChannel` then appends all three,
  // and the result is a six-channel image that renders as an opaque black square
  // with the seal sliding off it. Bytes are unambiguous.
  const { data: maskBytes, info } = await sharp(maskPayload)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.width !== 1024 || info.height !== 1024) {
    throw new Error(
      `The badge artwork is ${info.width}×${info.height}; the watermark crop is expressed in a 1024 grid. Re-measure it before trusting this.`,
    );
  }

  const alpha = Buffer.from(maskBytes);
  for (let y = BADGE_WATERMARK.y; y < BADGE_WATERMARK.y + BADGE_WATERMARK.height; y += 1) {
    alpha.fill(0, y * info.width + BADGE_WATERMARK.x, y * info.width + info.width);
  }

  // The pill is erased from the *alpha*, so the colour beneath it becomes
  // transparent. Erasing it from the colour layer would leave its silhouette.
  // No `removeAlpha()` here, however tempting. Sharp applies its operations in
  // its own order rather than in call order, and removeAlpha runs *after*
  // joinChannel — so asking for it strips the alpha that was just attached and
  // returns a three-channel image that renders as an opaque black square. The
  // colour layer already has no alpha of its own; there is nothing to remove.
  const composited = await sharp(colourPayload)
    .joinChannel(alpha, { raw: { width: info.width, height: info.height, channels: 1 } })
    .png()
    .toBuffer();

  const seal = await sharp(composited)
    .trim({ threshold: 1 })
    .resize(BADGE_ARTWORK_PX, BADGE_ARTWORK_PX, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    // WebP rather than PNG: the same seal is 901 KB as a lossless PNG and 190 KB
    // here, on a page that also carries a 378 KB hero. Every browser this
    // product supports reads it, and the alpha is kept lossless so the seal's
    // edge does not fringe against the dark ground.
    .webp({ quality: 88, alphaQuality: 100 })
    .toBuffer();

  writeFileSync(join(webPublicDir, BADGE_ARTWORK), seal);
  return seal.length;
}

await main();
