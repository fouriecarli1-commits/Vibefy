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
  it('shows the mark itself, not the small header lockup', () => {
    expect(home).toContain('/brand/vibefycode-mark.svg');
    expect(home).toContain('hero-mark');
  });

  it('is sized to be looked at rather than to be identified', () => {
    // A logo at 26px is a wayfinding device. This one is the subject.
    const rule = css.slice(css.indexOf('.hero-mark {'), css.indexOf('.hero-mark img'));
    expect(rule).toMatch(/width:\s*clamp\(\s*\d{3}px/);
  });

  it('is decorative in the markup, because the name is beside it', () => {
    // Announcing "VibefyCode" twice to a screen reader is worse than not
    // announcing the image at all.
    expect(home).toMatch(/vibefycode-mark\.svg"[\s\S]{0,80}alt=""/);
  });
});

describe('the light that moves over it', () => {
  it('is clipped to the mark rather than to a box around it', () => {
    // A sheen crossing a rectangle reads as a card being polished. Masking it
    // to the artwork is what makes it read as light on the object.
    const sheen = css.slice(css.indexOf('.hero-sheen {'), css.indexOf('@keyframes hero-sweep'));
    expect(sheen).toContain('mask-image');
    expect(sheen).toContain('-webkit-mask-image');
    expect(sheen).toContain('/brand/vibefycode-mark.svg');
  });

  it('is faster when pointed at, and never blocks a click', () => {
    expect(css).toMatch(/\.hero-mark:hover \.hero-sheen \{[\s\S]*?animation-duration/);
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
    expect(home).toMatch(/badge-verified\.svg"[\s\S]{0,200}width=\{200\}/);
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
