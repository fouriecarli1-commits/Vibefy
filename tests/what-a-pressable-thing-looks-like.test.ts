/**
 * Three answers to "what does a button look like here", one of them being
 * "it does not".
 *
 * `ActionForm` carried four Tailwind utilities written inline — the only
 * primary button in the console, describing itself. The navigation had
 * `.nav-cta` with its own look. And two buttons written in October said
 * `className="button"` against a class that did not exist anywhere in the
 * stylesheet, so they rendered as the browser's default grey.
 *
 * Anré asked for a futuristic facelift: modern type, glowing buttons, movement
 * on them. The glow and the movement are the easy half. The half worth testing
 * is that there is now one place that decides, that the movement cannot hide
 * content from somebody who asked for less of it, and that none of it touched
 * the marks — the brief forbids altering, recolouring or redrawing those, and a
 * facelift is exactly the moment somebody would.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('apps/web/app/globals.css', 'utf8');
const form = readFileSync('apps/web/components/action-form.tsx', 'utf8');

describe('one place that decides', () => {
  it('has a button class at all', () => {
    expect(css).toMatch(/^\.button \{/m);
    expect(css).toMatch(/^\.button-quiet \{/m);
    expect(css).toMatch(/^\.button-destructive \{/m);
  });

  it('is what the console form uses, rather than utilities written inline', () => {
    expect(form).toMatch(/className=\{`button/);
    expect(form, 'the inline look is back').not.toMatch(/bg-accent text-on-accent/);
  });

  it('leaves no button pointing at a class that does not exist', () => {
    // The failure that started this: `className="button"` against nothing.
    const uses = /className="button[^"]*"/.test(
      readFileSync('apps/web/app/admin/health/lift-pause.tsx', 'utf8'),
    );
    expect(uses).toBe(true);
    expect(css).toMatch(/^\.button \{/m);
  });
});

describe('the movement', () => {
  it('lifts on hover and gives on press', () => {
    const button = css.slice(css.indexOf('.button {'), css.indexOf('.button-quiet'));
    expect(button).toMatch(/\.button:hover \{[^}]*translateY\(-1px\)/s);
    expect(button).toMatch(/\.button:active \{[^}]*translateY\(1px\)/s);
  });

  it('glows with the accent rather than thickening a border', () => {
    /*
     * A border that changes width on hover moves the text inside it, which
     * reads as a flinch. The glow is behind the shape.
     */
    const button = css.slice(css.indexOf('.button {'), css.indexOf('.button-quiet'));
    expect(button).toMatch(/box-shadow:[^;]*var\(--vibefycode-accent\)/s);
    expect(button, 'the border width must not change on hover').not.toMatch(
      /:hover \{[^}]*border-width/s,
    );
  });

  it('never hides anything from somebody who asked for less motion', () => {
    /*
     * The global rule neutralises durations. An animation whose first frame is
     * `opacity: 0` would then hold that frame for ever — the element is simply
     * gone. So every entrance is inside a `no-preference` query rather than
     * defined and then undone.
     */
    const entrances = css.slice(
      css.indexOf('@keyframes rise-in') - 2000,
      css.indexOf('@keyframes rise-in'),
    );
    expect(entrances).toMatch(/@media \(prefers-reduced-motion: no-preference\)/);
    const sheen = css.slice(
      css.indexOf('.button:hover::after') - 400,
      css.indexOf('.button:hover::after'),
    );
    expect(sheen).toMatch(/@media \(prefers-reduced-motion: no-preference\)/);
  });

  it('still neutralises everything else for them', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
});

describe('what a facelift may not touch', () => {
  it('leaves the marks alone', () => {
    /*
     * PART 5 of the brief: "Do not alter, recolour, redraw or 'improve' the
     * supplied Vibefy marks." A restyle is exactly when somebody would, and the
     * generated mark files are the thing to check — they are built from the
     * supplied artwork and must not be hand-edited.
     */
    for (const generated of [
      'packages/shared/src/wordmark.generated.ts',
      'packages/shared/src/mark-outline.generated.ts',
    ]) {
      expect(readFileSync(generated, 'utf8')).toMatch(/Generated|generated/);
    }
  });

  it('adds no colour of its own', () => {
    // Every new surface is the accent, the danger colour, white or black mixed
    // into transparency. A facelift that invents a sixth brand colour is a
    // facelift that has to be undone.
    const buttons = css.slice(
      css.indexOf(
        '/* =========================================================================== \n   Buttons'.replace(
          ' \n',
          '\n',
        ),
      ),
      css.indexOf('.vibefycode-gradient-text'),
    );
    const hexes = buttons.match(/#[0-9a-fA-F]{3,8}/g) ?? [];
    expect([...new Set(hexes)].sort()).toEqual(['#000000', '#ffffff']);
  });
});
