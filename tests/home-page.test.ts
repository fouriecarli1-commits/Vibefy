/**
 * The first page anybody sees.
 *
 * A product whose entire value is a small graphic on somebody else's website
 * has to show that graphic, at a size you can look at, doing its job on a
 * website. These tests are mostly about that: the mark is present and large,
 * the badge is shown in every state it can be in, and the example is obviously
 * an example.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const home = read('apps/web/app/page.tsx');
const css = read('apps/web/app/globals.css');
// The SVG masters are committed; the web app's copies are generated at build
// time and gitignored. Asserting against the committed masters means this test
// checks that a file exists rather than that a build happened to have run.
const masters = readFileSync;

describe('the mark leads the page', () => {
  it('shows the founder’s own artwork, not a reconstruction of it', () => {
    // Everywhere else the mark is drawn from geometry, because a badge has to
    // render per request to stay revocable and has to survive 96 px. The
    // welcome page is neither: one image, once, at the size a logo is meant to
    // be looked at — so it is the artwork, at the cost of 378 KB.
    expect(home).toContain('/brand/vibefycode-hero-dark.svg');
    expect(home).toContain('hero-lockup');
    expect(home).not.toContain('/brand/vibefycode-mark.svg');
  });

  it('is sized to be looked at rather than to be identified', () => {
    // A logo at 26px is a wayfinding device. This one is the subject.
    const rule = css.slice(css.indexOf('.hero-lockup {'), css.indexOf('.hero-lockup img'));
    expect(rule).toMatch(/width:\s*min\(100%,\s*clamp\(\s*\d{3}px/);
  });

  it('carries the name in its alt text, because the image is the name', () => {
    // The wordmark is inside the artwork rather than beside it in live text, so
    // an empty alt would leave a screen reader with no name at all.
    expect(home).toMatch(/vibefycode-hero-dark\.svg"[\s\S]{0,120}alt="VibefyCode"/);
  });

  it('is fetched at high priority, because 378 KB above the fold is the page', () => {
    expect(home).toMatch(/vibefycode-hero-dark\.svg"[\s\S]{0,160}fetchPriority="high"/);
  });
});

describe('the light that moves over it', () => {
  it('is clipped to the mark rather than to a box around it', () => {
    // A sheen crossing a rectangle reads as a card being polished. Masking it
    // to the artwork is what makes it read as light on the object.
    const sheen = css.slice(css.indexOf('.hero-sheen {'), css.indexOf('@keyframes hero-sweep'));
    expect(sheen).toContain('mask-image');
    expect(sheen).toContain('-webkit-mask-image');
    expect(sheen).toContain('/brand/vibefycode-hero-dark.svg');
  });

  it('is faster when pointed at, and never blocks a click', () => {
    expect(css).toMatch(/\.hero-lockup:hover \.hero-sheen \{[\s\S]*?animation-duration/);
    expect(css).toMatch(/\.hero-sheen \{[\s\S]*?pointer-events: none/);
  });

  it('stops completely for somebody who asked for less motion', () => {
    // A logo that keeps moving for a person who asked it not to is a logo that
    // made somebody feel unwell in order to look clever.
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.hero-sheen');
    expect(reduced).toMatch(/animation:\s*none/);
  });

  it('pauses between sweeps rather than running continuously', () => {
    // Without the pause it reads as a loading spinner, which is the opposite of
    // what a trust mark should suggest.
    const frames = css.slice(css.indexOf('@keyframes hero-sweep'));
    expect(frames).toMatch(/2\d%,\s*100%/);
  });
});

describe('the badge is shown, in every state it can be in', () => {
  const states = [
    'vibefycode-badge-verified.svg',
    'vibefycode-badge-suspended.svg',
    'vibefycode-badge-expired.svg',
    'vibefycode-badge-revoked.svg',
  ];

  it('shows the active badge at a size somebody can read', () => {
    expect(home).toContain('vibefycode-badge-verified.svg');
    expect(home).toMatch(/badge-verified\.svg"[\s\S]{0,200}width=\{280\}/);
  });

  it('shows what it looks like when it is not in force', () => {
    // A badge is never a broken image, and nobody should first meet the
    // suspended one on their own website.
    for (const state of states.slice(1)) {
      expect(home, `${state} is not shown`).toContain(state);
    }
  });

  it('shows only badges that exist as committed masters', () => {
    for (const state of states) {
      expect(
        () => masters(join(process.cwd(), 'brand/svg', state), 'utf8'),
        `${state} is shown on the page but is not a master`,
      ).not.toThrow();
    }
  });

  it('says what the mark means, and what it does not', () => {
    expect(home).toContain('on a stated date');
    expect(home).toContain('not a penetration test');
    expect(home).toContain('comes down when it stops being true');
  });
});

describe('the example of a site carrying the badge', () => {
  it('uses a fictional application', () => {
    // A mock built to look like a real company's site is a mock that gets read
    // as an endorsement of one.
    expect(home).toContain('kettle.example');
    expect(home).toMatch(/\.example/);
    expect(home).toContain('A fictional application');
  });

  it('stands the page content in as blocks rather than as invented copy', () => {
    expect(home).toContain('mock-line');
    expect(css).toContain('.browser');
    expect(css).toContain('.mock-footer');
  });

  it('hides the mock chrome from a screen reader', () => {
    // It is a picture of a website, not a website. Reading its shapes out is
    // noise between two things that do matter.
    expect(home).toMatch(/className="browser-page" aria-hidden="true"/);
  });

  it('uses the compact badge, which is the one built for that size', () => {
    expect(home).toContain('vibefycode-badge-verified-compact.svg');
  });
});

describe('the hero artwork is the supplied file, and is published', () => {
  // The founder said plainly that a reconstruction of his logo is not his logo
  // and that the welcome page should carry the real thing whatever it costs.
  // That is his call about his own mark, so these assert the arrangement rather
  // than re-argue it: the artwork ships, unaltered except for the one thing
  // that makes it readable on this product's own background.
  const source = read('brand/source/supplied-lockup-transparent.svg');
  const build = read('tools/brand-build.mts');

  it('publishes the supplied file itself, not a redraw of it', () => {
    expect(build).toContain('supplied-lockup-transparent.svg');
    expect(build).toContain('vibefycode-hero.svg');
    expect(build).toContain('vibefycode-hero-dark.svg');
  });

  it('changes nothing about the artwork except the wordmark’s ink', () => {
    // The drawing was made for a white page: its letters are #002344, which on
    // this surface is very nearly invisible. Only the `fill` attribute moves,
    // and only on the wordmark — the same light/dark pair every other master in
    // this brand already ships.
    expect(source).toContain('fill="#002344"');
    expect(build).toContain('HERO_WORDMARK_INK');
    expect(build).toMatch(/replaceAll\(/);
  });

  it('fails the build rather than shipping a hero nobody can read', () => {
    // If a future supplied file inks its wordmark differently, the swap would
    // silently do nothing and the name would disappear into the background.
    expect(build).toContain('no longer inks its wordmark');
  });

  it('is the artwork without the AI watermark, which the badge render carries', () => {
    // `supplied-badge.svg` has "Made with AI" burned into its pixels, top right.
    // A trust mark cannot display a third party's provenance claim about itself,
    // so that file stays out of anything served — see brand/source/README.md.
    expect(build).not.toContain('supplied-badge.svg');
    expect(home).not.toContain('supplied-badge');
  });
});
