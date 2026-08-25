/**
 * Is this SVG really a vector, or a photograph in a vector envelope?
 *
 * The difference matters and is invisible in a file browser. A true vector
 * stores the *shape* — "curve from here to there" — so it is equally sharp at
 * 16 pixels and at two metres. A wrapped raster stores a grid of coloured dots
 * with an `.svg` extension around it, and blurs the moment it is scaled past
 * the size it was exported at. Every design tool exports both, and both are
 * called "SVG".
 *
 * Run it on any logo file somebody sends you:
 *
 *   node tools/inspect-svg.mjs path/to/logo.svg
 *
 * It answers three questions: is there real shape data, is there a picture
 * hidden inside, and does the file carry AI-generation provenance.
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node tools/inspect-svg.mjs <file.svg>');
  process.exit(2);
}

const svg = readFileSync(file, 'utf8');

const count = (pattern) => (svg.match(pattern) ?? []).length;

const shapes = {
  path: count(/<path\b/gi),
  circle: count(/<circle\b/gi),
  rect: count(/<rect\b/gi),
  polygon: count(/<polygon\b/gi),
  ellipse: count(/<ellipse\b/gi),
  line: count(/<(?:line|polyline)\b/gi),
};
const shapeTotal = Object.values(shapes).reduce((sum, n) => sum + n, 0);

// A <path> with no `d` attribute draws nothing. Counting elements is not
// counting geometry, and an envelope sometimes carries an empty one.
const pathsWithGeometry = count(/<path\b[^>]*\bd\s*=\s*["'][^"']{4,}/gi);

const embeddedImages = count(/<image\b/gi);
const rasterPayloads = [
  ...svg.matchAll(/data:image\/(png|jpe?g|gif|webp|bmp);base64,([A-Za-z0-9+/=\s]+)/gi),
];
const liveText = count(/<text\b/gi);

const aiMarkers = [];
if (/<ContainsAiGeneratedContent>\s*Yes/i.test(svg))
  aiMarkers.push('<ContainsAiGeneratedContent>Yes');
if (/c2pa/i.test(svg)) aiMarkers.push('a C2PA provenance manifest');
if (/generatedBy|digitalSourceType|trainedAlgorithmicMedia/i.test(svg))
  aiMarkers.push('generator metadata');

console.log(`\n  ${file}`);
console.log(`  ${'─'.repeat(Math.max(8, file.length))}`);
console.log(`  Size on disk         ${(Buffer.byteLength(svg, 'utf8') / 1024).toFixed(0)} KB`);

const viewBox = svg.match(/viewBox\s*=\s*["']([^"']+)["']/i);
if (viewBox) console.log(`  viewBox              ${viewBox[1]}`);

console.log(`\n  Vector geometry`);
for (const [name, n] of Object.entries(shapes)) {
  if (n > 0) console.log(`    <${name}>${' '.repeat(Math.max(1, 16 - name.length))}${n}`);
}
if (shapeTotal === 0) console.log(`    none`);
else console.log(`    of which <path> elements carrying shape data: ${pathsWithGeometry}`);

console.log(`\n  Embedded pictures`);
if (embeddedImages === 0 && rasterPayloads.length === 0) {
  console.log(`    none`);
} else {
  console.log(`    <image> elements    ${embeddedImages}`);
  for (const [index, match] of rasterPayloads.entries()) {
    const bytes = Math.floor((match[2].replace(/\s/g, '').length * 3) / 4);
    console.log(
      `    payload ${index + 1}           ${match[1].toUpperCase()}, ${(bytes / 1024).toFixed(0)} KB`,
    );
  }
}

if (liveText > 0) {
  console.log(`\n  Live text            ${liveText} <text> element${liveText === 1 ? '' : 's'}`);
  console.log(
    `                       (renders in whatever font the viewer has — outline it before shipping)`,
  );
}

if (aiMarkers.length > 0) {
  console.log(`\n  AI provenance        ${aiMarkers.join(', ')}`);
}

const isRealVector = pathsWithGeometry > 0 || shapeTotal - shapes.rect > 0;
const isWrappedRaster = rasterPayloads.length > 0 && pathsWithGeometry === 0;

console.log(`\n  Verdict`);
if (isWrappedRaster) {
  console.log(`    A picture in a vector envelope. It will blur when scaled up and`);
  console.log(`    turn to mud at favicon size. Not usable as a master logo.`);
} else if (isRealVector && rasterPayloads.length > 0) {
  console.log(`    Mostly vector, but it still carries an embedded picture. Find out`);
  console.log(`    which part is the picture before relying on it.`);
} else if (isRealVector) {
  console.log(`    A true vector. Shape data, no embedded picture.`);
  if (aiMarkers.length > 0)
    console.log(`    Note the AI provenance metadata above — strip it before shipping.`);
} else {
  console.log(`    Neither shapes nor a picture found. Open it and look.`);
}
console.log('');

process.exit(isWrappedRaster ? 1 : 0);
