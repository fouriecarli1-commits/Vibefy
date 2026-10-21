/**
 * The document a customer hands to somebody else.
 *
 * Everything else in this product is read on a screen that can scroll, hover
 * and link. This one gets printed, attached to an email, and put in front of an
 * investor or a procurement officer — and it is the only artefact where the
 * typesetting is part of the claim. A report that looks assembled by nobody is
 * a report whose number reads the same way.
 *
 * What is held here is the part that is easy to lose in a restyle and
 * impossible to notice on a screen: that it still works on paper, in black and
 * white, with no pointer.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const render = readFileSync('packages/report/src/render.ts', 'utf8');
const styles = render.slice(
  render.indexOf('function stylesheet'),
  render.indexOf('function wordFor'),
);

describe('what survives being printed', () => {
  it('does not strand a heading at the foot of a page', () => {
    // A heading with its section overleaf is the commonest way a printed
    // document stops being readable.
    expect(styles).toMatch(/h1, h2, h3 \{ break-after: avoid; \}/);
    expect(styles).toMatch(/h2 \+ p[^}]*break-before: avoid/);
  });

  it('does not leave two lines alone at the top or bottom of a page', () => {
    expect(styles).toMatch(/orphans: 3/);
    expect(styles).toMatch(/widows: 3/);
  });

  it('keeps a finding and a callout whole', () => {
    expect(styles).toMatch(/\.callout, \.finding \{ break-inside: avoid; \}/);
    expect(styles).toMatch(/tr \{ break-inside: avoid; \}/);
  });

  it('prints the address behind a link, because paper has no pointer', () => {
    expect(styles).toMatch(/a\[href\^='http'\]::after/);
    // And only for links that go somewhere: an in-page anchor printed as
    // "#evidence" helps nobody.
    expect(styles).not.toMatch(/a::after \{ content: ' \(' attr\(href\)/);
  });
});

describe('what survives being printed in black and white', () => {
  it('says a severity in words, not only in a colour', () => {
    /*
     * A report that matters gets printed, and a printed report is usually
     * printed in black and white. The word carries the meaning, the colour
     * agrees with it, and the border makes the chip a chip when the colour is
     * gone — which is also why the chip borders in `currentColor` rather than
     * in a line colour of its own.
     */
    expect(styles).toMatch(/\.sev \{[^}]*border: 1px solid currentColor/s);
    expect(styles).toMatch(/\.sev \{[^}]*text-transform: uppercase/s);
  });

  it('keeps the severity word itself in the markup', () => {
    // The CSS above is the presentation of it. The meaning has to be in the
    // document, or a screen reader and a greyscale printer both lose it.
    expect(render).toMatch(/class="sev sev-\$\{/);
  });
});

describe('what makes it read like a document', () => {
  it('sets each heading level on its own tracking', () => {
    // One value across three levels is what makes a page look typeset by
    // nobody: at 2rem it is loose and at 1.05rem it closes the letters up.
    const h1 = /h1 \{[^}]*letter-spacing: (-0\.0\d+)em/.exec(styles)?.[1];
    const h2 = /h2 \{[^}]*letter-spacing: (-0\.0\d+)em/.exec(styles)?.[1];
    const h3 = /h3 \{[^}]*letter-spacing: (-0\.0\d+)em/.exec(styles)?.[1];
    expect(new Set([h1, h2, h3]).size, 'three levels, one value').toBe(3);
    expect(Number(h1)).toBeLessThan(Number(h3!));
  });

  it('lines up the figures somebody compares down a column', () => {
    expect(styles).toMatch(/font-variant-numeric: tabular-nums/);
  });

  it('sets the table header as a header rather than a bold first row', () => {
    expect(styles).toMatch(/th \{[^}]*text-transform: uppercase/s);
    expect(styles).toMatch(/th \{[^}]*border-bottom: 2px solid/s);
  });
});
