/**
 * What a badge's link shows when it cannot show the badge.
 *
 * Somebody arrives here by clicking a trust mark on a stranger's website. They
 * are, by definition, checking. Two things can go wrong at that moment, and
 * until now both produced the same site-wide sentence — "Page not found. That
 * page does not exist, or it moved." — which answers a question nobody asked
 * and leaves the real one open in the direction that flatters whoever displayed
 * the mark.
 *
 * The two are opposites and must read as opposites: an identifier we never
 * issued is a fact about the badge, and a database we cannot reach is a fact
 * about us.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');
const collapse = (text: string) => text.replace(/\s+/g, ' ');

const notFound = collapse(read('apps/web/app/a/not-found.tsx'));
const errorBoundary = collapse(read('apps/web/app/a/error.tsx'));

describe('the boundary exists at all', () => {
  it('gives the verification segment a layout, which is what binds the boundary', () => {
    // Found the hard way: without a layout at this level Next quietly falls
    // through to the site-wide not-found, and the careful page below never
    // renders. Nothing about the failure says so — it simply shows the wrong
    // screen. This test is the note that stops it being rediscovered.
    expect(existsSync(join(process.cwd(), 'apps/web/app/a/layout.tsx'))).toBe(true);
  });

  it('covers both failures, not just the tidy one', () => {
    expect(existsSync(join(process.cwd(), 'apps/web/app/a/not-found.tsx'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'apps/web/app/a/error.tsx'))).toBe(true);
  });
});

describe('an identifier we never issued', () => {
  it('says that, rather than that the page does not exist', () => {
    expect(notFound).toMatch(/We have not issued this badge/i);
    expect(notFound).not.toMatch(/That page does not exist/i);
  });

  it('shows the identifier that was asked for', () => {
    // The two people standing here are somebody whose snippet was altered and
    // somebody checking a mark they suspect. Both need to see what was asked
    // for; neither can be told to open a developer console.
    expect(notFound).toContain('usePathname');
    expect(notFound).toMatch(/identifier requested/i);
  });

  it('does not turn a missing record into a verdict on the application', () => {
    // We know one thing — that we have no row. Anything beyond that is a claim
    // about somebody else's software made from an absence, which is the exact
    // move the whole product exists to refuse.
    expect(notFound).toMatch(/not a judgement about the application/i);
  });

  it('names the innocent explanations before the suspicious one', () => {
    const altered = notFound.indexOf('The snippet was altered');
    const copied = notFound.indexOf('The mark was copied');
    expect(altered).toBeGreaterThan(-1);
    expect(copied).toBeGreaterThan(altered);
  });

  it('tells an owner how to fix it and a checker how to look further', () => {
    expect(notFound).toContain('/console');
    expect(notFound).toContain('/directory');
    expect(notFound).toContain('/legal/ip-takedown');
  });
});

describe('a lookup that failed', () => {
  it('says the fault is ours', () => {
    expect(errorBoundary).toMatch(/could not reach our records/i);
    expect(errorBoundary).toMatch(/fault is ours/i);
  });

  it('refuses to be read as evidence in either direction', () => {
    // A page that shrugs will be read as evidence by whoever wants it to be.
    expect(errorBoundary).toMatch(/not evidence that the badge is genuine/i);
    expect(errorBoundary).toMatch(/not evidence that it is not/i);
  });

  it('offers a retry and a reference somebody can quote', () => {
    expect(errorBoundary).toContain('reset');
    expect(errorBoundary).toContain('error.digest');
  });
});
