/**
 * The embed snippet is the only supported way to place the mark on a customer's
 * site, so it is the right place to make the licence rules impossible to break
 * by accident.
 */
import { describe, expect, it } from 'vitest';
import {
  BADGE_USAGE,
  BadgeUsageError,
  SEAL,
  WORDMARK,
  arcTextPlacements,
  badgeAltText,
  badgeAssetFor,
  badgeEmbedSnippet,
  scopeStatement,
} from '../packages/shared/src/index.ts';
import { renderBadgeSvg } from '../packages/badge/src/index.ts';
import { runBrandCheck } from '../tools/brand-check.mts';

const facts = {
  appName: 'Kettle',
  rubricVersion: '1.0.0',
  assessedOn: '2026-08-22',
  verifyOrigin: 'https://verify.vibefycode.example',
  publicId: 'abcdef0123456789',
  slug: 'kettle',
};

describe('the embed snippet', () => {
  it('always links to the verification page', () => {
    expect(badgeEmbedSnippet(facts)).toContain('href="https://verify.vibefycode.example/a/kettle"');
  });

  it('sends the chosen size with the request, so the served layout matches the space', () => {
    // A seal shrunk to 96px is a smudge. The renderer serves the compact layout
    // below SEAL.minimumDetailPx, and it can only do that if it is told.
    expect(badgeEmbedSnippet({ ...facts, sizePx: 96 })).toContain('.svg?size=96');
    expect(badgeEmbedSnippet({ ...facts, sizePx: 256 })).toContain('.svg?size=256');
  });

  it('always serves the image from our origin, never a file the customer hosts', () => {
    expect(badgeEmbedSnippet(facts)).toContain(
      'src="https://verify.vibefycode.example/badge/abcdef0123456789.svg',
    );
  });

  it('carries the scope-qualified alt text', () => {
    const snippet = badgeEmbedSnippet(facts);
    expect(snippet).toContain('Verified by VibefyCode — Kettle');
    expect(snippet).toContain('Rubric v1.0.0');
    expect(snippet).toContain('Scope-limited assessment');
  });

  it('refuses a size below the legibility minimum', () => {
    expect(() => badgeEmbedSnippet({ ...facts, sizePx: 64 })).toThrow(BadgeUsageError);
    expect(() => badgeEmbedSnippet({ ...facts, sizePx: BADGE_USAGE.minimumSizePx })).not.toThrow();
  });

  it('refuses a non-HTTPS origin', () => {
    expect(() => badgeEmbedSnippet({ ...facts, verifyOrigin: 'http://verify.example' })).toThrow(
      BadgeUsageError,
    );
  });

  it('reserves the required clear space around the mark', () => {
    const snippet = badgeEmbedSnippet({ ...facts, sizePx: 200 });
    expect(snippet).toContain(`padding:${200 * BADGE_USAGE.clearSpaceRatio}px`);
  });

  it('maps every status to its own asset, so a suspended badge is never the active mark', () => {
    expect(badgeAssetFor('active')).toBe('vibefycode-badge-verified.svg');
    for (const status of ['suspended', 'expired', 'revoked'] as const) {
      expect(badgeAssetFor(status)).toBe(`vibefycode-badge-${status}.svg`);
      expect(badgeAssetFor(status)).not.toBe(badgeAssetFor('active'));
    }
  });
});

describe('the language attached to the mark', () => {
  it('never claims more than an assessment against a rubric on a date', () => {
    const alt = badgeAltText(facts);
    expect(alt).toMatch(/^Verified by VibefyCode —/);
    expect(alt).toContain('not a security guarantee');
    expect(alt).not.toMatch(/\b(safe|approved|compliant)\b/i);
  });

  it('states the scope and the limits in the same breath', () => {
    const statement = scopeStatement(facts);
    expect(statement).toContain('point-in-time');
    expect(statement).toContain('not a penetration test');
    expect(statement).toContain('Absence of a finding is not evidence of absence of a defect');
    expect(statement.length).toBeGreaterThan(100);
  });
});

describe('the generated brand masters', () => {
  it('pass the brand gate', () => {
    expect(runBrandCheck()).toEqual([]);
  });
});

describe('the seal', () => {
  it('places arc glyphs on the circle, centred on the angle it was given', () => {
    const top = arcTextPlacements({ text: 'ABC', radius: 100, centreAngle: 0, step: 10 });
    expect(top).toHaveLength(3);
    // The middle glyph sits at twelve o'clock, upright.
    expect(top[1]!.x).toBeCloseTo(256, 5);
    expect(top[1]!.y).toBeCloseTo(156, 5);
    expect(top[1]!.rotation).toBeCloseTo(0, 5);
    // Every glyph is exactly `radius` from the centre — that is the whole job.
    for (const glyph of top) {
      expect(Math.hypot(glyph.x - 256, glyph.y - 256)).toBeCloseTo(100, 5);
    }
    // And they run left to right.
    expect(top[0]!.x).toBeLessThan(top[2]!.x);
  });

  it('keeps a bottom run upright to the reader', () => {
    const bottom = arcTextPlacements({
      text: 'ABC',
      radius: 100,
      centreAngle: 180,
      step: 10,
      flip: true,
    });
    expect(bottom[1]!.y).toBeCloseTo(356, 5);
    // Rotated a further half-turn, so the letters are not standing on their heads.
    expect(bottom[1]!.rotation).toBeCloseTo(360, 5);
    // Flipped runs read left to right too, which means sweeping the other way.
    expect(bottom[0]!.x).toBeLessThan(bottom[2]!.x);
  });

  it('never depends on textPath, which not every renderer supports', () => {
    // librsvg renders nothing for a textPath and rasterises our own PNG masters.
    // Relying on it produces a trust mark with no wordmark on it, somewhere.
    for (const status of ['active', 'suspended', 'expired', 'revoked'] as const) {
      expect(renderBadgeSvg({ status })).not.toContain('textPath');
    }
  });

  it('serves the compact layout below the size the furniture stops being legible at', () => {
    const seal = renderBadgeSvg({ status: 'active' });
    const compact = renderBadgeSvg({ status: 'active', sizePx: 96 });

    // The band legend is set one glyph per <text>, so the full seal is counted by
    // its glyphs rather than searched for a phrase it deliberately never contains.
    const glyphs = (svg: string) => (svg.match(/<text/g) ?? []).length;
    expect(glyphs(seal)).toBeGreaterThan(10);
    expect(seal).toContain(SEAL.banner);

    // At 96px the arc, the stars and the folded ends are noise, so they go.
    expect(compact).not.toContain(SEAL.banner);
    expect(glyphs(compact)).toBeLessThan(4);
    expect(compact.length).toBeLessThan(seal.length);

    // What must survive at every size: whose mark it is, and what it claims.
    for (const svg of [seal, compact]) {
      expect(svg).toContain('Verified by VibefyCode');
      expect(svg).toContain(WORDMARK.strong);
      expect(svg).toContain(WORDMARK.light);
    }
  });

  it('says the wordmark in one word, in two weights', () => {
    expect(`${WORDMARK.strong}${WORDMARK.light}`).toBe('VIBEFYCODE');
    const svg = renderBadgeSvg({ status: 'active' });
    // One <text>, two <tspan>s — never two words with a gap between them.
    expect(svg).toMatch(
      new RegExp(`<tspan font-weight="700">${WORDMARK.strong}</tspan><tspan font-weight="400">${WORDMARK.light}</tspan>`),
    );
  });

  it('never reads as a verification in any state that is not one', () => {
    for (const status of ['suspended', 'expired', 'revoked'] as const) {
      for (const sizePx of [96, 512]) {
        const svg = renderBadgeSvg({ status, sizePx });
        expect(svg, `${status} at ${sizePx}px`).toContain('Not currently verified');
        expect(svg).not.toMatch(/aria-label="Verified by VibefyCode/);
      }
    }
  });
});
