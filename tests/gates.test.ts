/**
 * The CI gates that protect our claims, tested.
 *
 * A gate nobody has tested is a gate that quietly stops catching things. Each
 * of these asserts both directions: the gate fires on the thing it exists to
 * catch, and stays silent on legitimate usage.
 */
import { describe, expect, it } from 'vitest';
import { lintText, FORBIDDEN_PHRASES } from '../tools/copy-lint.mjs';
import { scanText } from '../tools/secret-scan.mjs';
import {
  contrastRatio,
  relativeLuminance,
  runContrastChecks,
  resolveToken,
} from '../tools/contrast-check.mjs';

describe('copy lint', () => {
  it.each(FORBIDDEN_PHRASES)('rejects "%s"', (phrase) => {
    const violations = lintText(`Our badge means the app is ${phrase}.`);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('rejects extensions of the certification mark', () => {
    for (const claim of ['Vibefy Certified', 'Vibefy Trusted', 'Approved by Vibefy']) {
      const violations = lintText(claim);
      expect(
        violations.some((v) => v.rule === 'mark-extension' || v.rule === 'forbidden-phrase'),
        claim,
      ).toBe(true);
    }
  });

  it('accepts the permitted forms of the mark', () => {
    for (const permitted of [
      'Verified by Vibefy',
      'Vibefy-assessed',
      'Vibefy Rubric v1.0.0 — score 82/100',
    ]) {
      expect(lintText(permitted), permitted).toHaveLength(0);
    }
  });

  it('rejects an absolute claim and accepts the same word inside a negation', () => {
    expect(lintText('Your application is secure.').length).toBeGreaterThan(0);
    expect(lintText('This does not certify that the application is secure.')).toHaveLength(0);
  });

  it('reads wrapped prose as one sentence, so a negation on the line above still counts', () => {
    const wrapped = [
      'This is not a penetration test, a code audit, or a',
      'guarantee of any kind.',
    ].join('\n');
    expect(lintText(wrapped)).toHaveLength(0);
  });

  it('rejects a suppression that gives no reason', () => {
    const violations = lintText(['// vibefy-copy-lint-allow:', 'const label = "safe";'].join('\n'));
    expect(violations.some((v) => v.rule === 'suppression-without-reason')).toBe(true);
  });

  it('honours a reasoned block suppression, which the Badge Licence needs to name what it forbids', () => {
    const source = [
      '<!-- vibefy-copy-lint-allow-block: the licence must name the phrases it prohibits -->',
      'Not permitted: "Vibefy Approved", "Guaranteed by Vibefy".',
      '<!-- vibefy-copy-lint-allow-block-end -->',
      'Everything after the block is checked again.',
    ].join('\n');
    expect(lintText(source)).toHaveLength(0);
  });

  it('rejects a block suppression with no reason', () => {
    const source = [
      '<!-- vibefy-copy-lint-allow-block: -->',
      'Vibefy Approved',
      '<!-- vibefy-copy-lint-allow-block-end -->',
    ].join('\n');
    expect(lintText(source).some((v) => v.rule === 'suppression-without-reason')).toBe(true);
  });

  it('rejects a block suppression that is never closed, so it cannot silence a whole file', () => {
    const source = [
      '<!-- vibefy-copy-lint-allow-block: opened and forgotten -->',
      'Vibefy Approved',
    ].join('\n');
    expect(lintText(source).some((v) => v.rule === 'unclosed-suppression')).toBe(true);
  });

  it('still checks the lines after a closed block', () => {
    const source = [
      '<!-- vibefy-copy-lint-allow-block: naming what is prohibited -->',
      'Vibefy Approved',
      '<!-- vibefy-copy-lint-allow-block-end -->',
      '',
      'Your application is secure.',
    ].join('\n');
    expect(lintText(source).some((v) => v.rule === 'unqualified-absolute')).toBe(true);
  });

  it('honours a suppression that gives one', () => {
    const source = [
      '// vibefy-copy-lint-allow: quoting a store policy verbatim',
      'const storePolicy = "the app must be safe";',
    ].join('\n');
    expect(lintText(source).filter((v) => v.rule === 'unqualified-absolute')).toHaveLength(0);
  });
});

describe('secret scan', () => {
  it.each([
    ['Anthropic key', 'const key = "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";'], // secret-scan-allow: fixture proving the scanner fires
    ['AWS access key', 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE'], // secret-scan-allow: fixture proving the scanner fires
    ['Stripe live key', 'STRIPE_SECRET_KEY=sk_live_51H8xQ2KlMnOpQrStUvWx'], // secret-scan-allow: fixture proving the scanner fires
    ['GitHub token', 'token: ghp_abcdefghijklmnopqrstuvwxyz0123456789'], // secret-scan-allow: fixture proving the scanner fires
    ['private key block', '-----BEGIN OPENSSH PRIVATE KEY-----'], // secret-scan-allow: fixture proving the scanner fires
    [
      'JWT',
      'SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2lnbmF0dXJlaGVyZQ', // secret-scan-allow: fixture proving the scanner fires
    ],
  ])('catches a %s', (_label, line) => {
    expect(scanText(line)).not.toHaveLength(0);
  });

  it('never echoes the full credential into the log', () => {
    const [finding] = scanText('const key = "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";'); // secret-scan-allow: fixture proving the scanner fires
    expect(finding!.preview).not.toContain('AbCdEfGhIjKlMnOpQrStUvWxYz0123456789');
    expect(finding!.preview).toMatch(/…/);
  });

  it('honours a reasoned suppression on the flagged line or the one above it', () => {
    const sameLine = 'const key = "sk_live_51AAAAAAAAAAAAAAAA"; // secret-scan-allow: fixture value';
    const lineAbove = [
      '// secret-scan-allow: fixture value the scanner is meant to find',
      'const key = "sk_live_51AAAAAAAAAAAAAAAA";',
    ].join('\n');
    expect(scanText(sameLine)).toHaveLength(0);
    expect(scanText(lineAbove)).toHaveLength(0);
  });

  it('ignores a suppression that gives no reason', () => {
    const bare = 'const key = "sk_live_51AAAAAAAAAAAAAAAA"; // secret-scan-allow';
    expect(scanText(bare)).not.toHaveLength(0);
  });

  it('leaves placeholders and empty values alone', () => {
    for (const line of [
      'NEXT_PUBLIC_SUPABASE_ANON_KEY=',
      'ANTHROPIC_API_KEY=',
      'api_key: "your-key-here"',
      'password: "<replace-me>"',
    ]) {
      expect(scanText(line), line).toHaveLength(0);
    }
  });
});

describe('contrast', () => {
  it('agrees with the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
  });

  it('passes on the shipped tokens', () => {
    expect(runContrastChecks()).toEqual([]);
  });

  it('still refuses teal as body text on white, which is why it is an accent', () => {
    expect(contrastRatio(resolveToken('brand.teal'), '#FFFFFF')).toBeLessThan(4.5);
  });
});
