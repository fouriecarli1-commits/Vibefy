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

describe('the link somebody sends to somebody else', () => {
  // A verification URL is the one address this product has that people pass
  // around — an owner showing a customer their result, or a sceptic asking a
  // friend whether a mark is real. Pasted into a message it rendered as a bare
  // address, which is the difference between a product and a URL.
  it('renders as a card rather than as raw text', () => {
    expect(page).toContain('openGraph');
    expect(page).toContain('twitter');
    expect(page).toMatch(/siteName: 'VibefyCode'/);
  });

  it('says on the card exactly what it says on the page', () => {
    // A share preview that promised more than the assessment does would be the
    // same over-claim as a badge reading "secure", made in the place most
    // likely to be seen and least likely to be read carefully. One constant,
    // used for both.
    const meta = page.slice(page.indexOf('const assessedOn ='), page.indexOf('export default'));
    // Written once and referenced three times — the page's own description, the
    // card's, and the tweet's — rather than typed out again anywhere.
    expect(meta.match(/const description =/g)).toHaveLength(1);
    expect(meta.match(/^\s+description,$/gm)?.length).toBeGreaterThanOrEqual(3);
    expect(meta.match(/const title =/g)).toHaveLength(1);
  });

  it('gives every shared address an absolute origin', () => {
    // A relative image or canonical in a share card resolves against whoever is
    // rendering it, which is never us.
    expect(page).toContain('resolveVerifyOrigin');
    expect(page).toMatch(/canonical: `\$\{origin\}\/a\/\$\{badge\.slug\}`/);
  });

  it('does not tell a sceptic to fetch our key from a path with no host', () => {
    // The one instruction on the page whose entire purpose is that somebody can
    // follow it without trusting us. It read the environment directly and fell
    // back to an empty string.
    expect(page).not.toContain(
      "process.env.NEXT_PUBLIC_VERIFY_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? ''",
    );
  });
});

describe('the way out of a failure', () => {
  const notFound = readFileSync(join(process.cwd(), 'apps/web/app/a/not-found.tsx'), 'utf8');

  it('offers one too', () => {
    // Somebody who lands on a badge that does not resolve is the one visitor
    // guaranteed to have wondered what VibefyCode is.
    expect(notFound).toMatch(/What is VibefyCode/i);
    expect(notFound).toMatch(/Get your application assessed/i);
  });

  it('puts it after the explanation, not before it', () => {
    const reasons = notFound.indexOf('The usual reasons');
    const offer = notFound.indexOf('What is VibefyCode');
    expect(reasons).toBeGreaterThan(-1);
    expect(offer).toBeGreaterThan(reasons);
  });
});
