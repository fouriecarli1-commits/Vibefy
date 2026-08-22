/**
 * The embed snippet is the only supported way to place the mark on a customer's
 * site, so it is the right place to make the licence rules impossible to break
 * by accident.
 */
import { describe, expect, it } from 'vitest';
import {
  BADGE_USAGE,
  BadgeUsageError,
  badgeAltText,
  badgeAssetFor,
  badgeEmbedSnippet,
  scopeStatement,
} from '../packages/shared/src/index.ts';
import { runBrandCheck } from '../tools/brand-check.mjs';

const facts = {
  appName: 'Kettle',
  rubricVersion: '1.0.0',
  assessedOn: '2026-08-22',
  verifyOrigin: 'https://verify.vibefy.example',
  publicId: 'abcdef0123456789',
  slug: 'kettle',
};

describe('the embed snippet', () => {
  it('always links to the verification page', () => {
    expect(badgeEmbedSnippet(facts)).toContain('href="https://verify.vibefy.example/a/kettle"');
  });

  it('always serves the image from our origin, never a file the customer hosts', () => {
    expect(badgeEmbedSnippet(facts)).toContain(
      'src="https://verify.vibefy.example/badge/abcdef0123456789.svg"',
    );
  });

  it('carries the scope-qualified alt text', () => {
    const snippet = badgeEmbedSnippet(facts);
    expect(snippet).toContain('Verified by Vibefy — Kettle');
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
    expect(badgeAssetFor('active')).toBe('vibefy-badge-verified.svg');
    for (const status of ['suspended', 'expired', 'revoked'] as const) {
      expect(badgeAssetFor(status)).toBe(`vibefy-badge-${status}.svg`);
      expect(badgeAssetFor(status)).not.toBe(badgeAssetFor('active'));
    }
  });
});

describe('the language attached to the mark', () => {
  it('never claims more than an assessment against a rubric on a date', () => {
    const alt = badgeAltText(facts);
    expect(alt).toMatch(/^Verified by Vibefy —/);
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
