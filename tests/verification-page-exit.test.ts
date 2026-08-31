/**
 * Where somebody goes after they have checked a badge.
 *
 * The badge on a customer's website links here and must keep doing so: a mark
 * that sends you to a sales page instead of the evidence is an advertisement
 * wearing the clothes of a check, and the licence forbids it.
 *
 * But this page then offered a curious visitor nowhere to go. Every link on it
 * led further into the small print — the independence policy, the takedown
 * form, the signature. Somebody who clicked a mark on a stranger's website is
 * the entire audience for this product, and they were arriving and leaving
 * again.
 *
 * The order matters as much as the presence: evidence first, offer second.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const page = readFileSync(join(process.cwd(), 'apps/web/app/a/[slug]/page.tsx'), 'utf8');

describe('the way out', () => {
  it('exists at all', () => {
    expect(page).toMatch(/Get your application assessed/i);
  });

  it('explains what the product is, for somebody who has never heard of it', () => {
    expect(page).toMatch(/What is VibefyCode/i);
  });

  it('comes after the evidence, not before it', () => {
    // A page that opens with the offer is a page whose evidence is decoration.
    const scope = page.indexOf('What was assessed, and what was not');
    const offer = page.indexOf('What is VibefyCode');
    expect(scope).toBeGreaterThan(-1);
    expect(offer).toBeGreaterThan(-1);
    expect(offer).toBeGreaterThan(scope);
  });

  it('still ends on the limits rather than on the offer', () => {
    // The non-reliance footer is the last word, because it is the one a reader
    // should leave with.
    const offer = page.indexOf('What is VibefyCode');
    const nonReliance = page.indexOf('No third party');
    expect(nonReliance).toBeGreaterThan(offer);
  });
});

describe('what it claims on the way out', () => {
  // Collapsed, because a sentence's meaning does not depend on where the
  // formatter chose to break the line — and a test that fails when Prettier
  // rewraps is a test about formatting wearing the clothes of one about copy.
  const section = page
    .slice(page.indexOf('What is VibefyCode'), page.indexOf('No third party'))
    .replace(/\s+/g, ' ');

  it('says the assessment is scope-limited in the same breath as the offer', () => {
    expect(section).toMatch(/scope-limited/i);
  });

  it('says a person reviews it, which is the thing being sold', () => {
    expect(section).toMatch(/a person reviews/i);
  });

  it('says we never see the source code, which is the first thing anybody asks', () => {
    expect(section).toMatch(/never their source code/i);
  });

  it('points at the published rubric rather than asking to be believed', () => {
    expect(section).toContain('/methodology');
  });
});
