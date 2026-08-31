/**
 * The embed snippet is the only supported way to place the mark on a customer's
 * site, so it is the right place to make the licence rules impossible to break
 * by accident.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BADGE_USAGE,
  BadgeUsageError,
  SEAL,
  WORDMARK,
  WORDMARK_OUTLINE,
  arcTextPlacements,
  badgeAltText,
  badgeAssetFor,
  badgeEmbedSnippet,
  scopeStatement,
} from '../packages/shared/src/index.ts';
import { BADGE_ARTWORK, renderBadgeSvg } from '../packages/badge/src/index.ts';
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

  it('carries the supplied artwork rather than a drawing of it', () => {
    // The badge used to be assembled in code: a traced mark, a generated
    // wordmark, an arc of text, a struck band. It was a careful reconstruction
    // and it was not the trade mark, which is the one thing that has to be
    // identical everywhere. This is the assertion that keeps it that way.
    for (const sizePx of [96, 512]) {
      const svg = renderBadgeSvg({ status: 'active', sizePx });
      expect(svg).toContain('<image');
      expect(svg).toContain(BADGE_ARTWORK.active.dataUri);
    }
  });

  it('embeds the artwork rather than linking to it', () => {
    // An `<img>` on somebody else's page will not fetch a second resource from
    // us, and many pages forbid it outright. A badge that referenced its own
    // artwork would be a blank frame on exactly the sites it exists to appear on.
    const svg = renderBadgeSvg({ status: 'active' });
    expect(svg).toContain('data:image/webp;base64,');
    expect(svg).not.toMatch(/<image[^>]+href="https?:/);
  });

  it('was resized from the artwork in this repository, unaltered', () => {
    // The guarantee that replaced the palette check. A raster has no colour
    // values to read, so provenance is what stands in its place: these bytes
    // came from that file, and if the file changes without the badge being
    // rebuilt, this fails.
    const files: Record<string, string> = {
      active: 'vibefycode-badge-artwork.webp',
      suspended: 'vibefycode-badge-artwork-suspended.webp',
      expired: 'vibefycode-badge-artwork-expired.webp',
      revoked: 'vibefycode-badge-artwork-revoked.webp',
    };
    for (const [status, file] of Object.entries(files)) {
      const bytes = readFileSync(join(process.cwd(), 'apps/web/public/brand', file));
      const digest = createHash('sha256').update(bytes).digest('hex');
      expect(digest, status).toBe(BADGE_ARTWORK[status as keyof typeof BADGE_ARTWORK].sourceSha256);
    }
  });

  it('gives each state its own image', () => {
    // A suspended badge rendering the active seal is worse than no badge, and
    // one careless copy away.
    const seen = new Set(Object.values(BADGE_ARTWORK).map((artwork) => artwork.dataUri));
    expect(seen.size).toBe(4);
  });

  it("stays small enough to sit on somebody else's page", () => {
    // This loads on customers' websites, not ours. The full master is ~190 KB;
    // the badge is displayed at 96 to 128, so it is served at 256.
    for (const artwork of Object.values(BADGE_ARTWORK)) {
      expect(artwork.bytes).toBeLessThan(60_000);
    }
  });

  it('sets no live text at all, so no missing font can change the mark', () => {
    expect(`${WORDMARK.strong}${WORDMARK.light}`).toBe('VIBEFYCODE');
    for (const status of ['active', 'suspended', 'expired', 'revoked'] as const) {
      const svg = renderBadgeSvg({ status, sizePx: 512 });
      // The wordmark is in the artwork's pixels now, where no substitution is
      // possible. Nothing in the document is typeset.
      expect(svg.match(/<text[^>]*>/g) ?? []).toHaveLength(0);
      expect(svg).not.toContain(WORDMARK_OUTLINE.strong);
    }
  });

  it('fills its canvas without distorting the seal', () => {
    const svg = renderBadgeSvg({ status: 'active' });
    expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
  });

  it('never reads as a verification in any state that is not one', () => {
    // The words are struck across the supplied seal in pixels by `brand:build`,
    // so the document itself no longer carries them as text. What a screen
    // reader announces is the accessible name, and that is what is asserted —
    // it is also what an `<img alt>` carries on a customer's page.
    for (const status of ['suspended', 'expired', 'revoked'] as const) {
      for (const sizePx of [96, 512]) {
        const svg = renderBadgeSvg({
          status,
          sizePx,
          appName: facts.appName,
          rubricVersion: facts.rubricVersion,
          assessedOn: facts.assessedOn,
        });
        expect(svg, `${status} at ${sizePx}px`).toContain('Not currently verified by VibefyCode');
        expect(svg).not.toMatch(/aria-label="Verified by VibefyCode/);
        expect(svg).toContain(BADGE_ARTWORK[status].dataUri);
      }
    }
  });
});
