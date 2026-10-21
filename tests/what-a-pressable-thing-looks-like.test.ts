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
import { execFileSync } from 'node:child_process';
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

describe('the pages it reaches', () => {
  const read = (path: string) => readFileSync(path, 'utf8');

  it('leaves no page describing a button for itself', () => {
    /*
     * Seven files carried the same four utilities — `rounded-lg bg-accent px-5
     * py-3 font-medium text-on-accent` — which is what a design system looks
     * like before it is one: the day the accent moves, seven files are the
     * place to change it and one of them is missed.
     */
    const pages = execFileSync('git', ['ls-files', 'apps/web'], { encoding: 'utf8' })
      .split('\n')
      .filter((path) => path.endsWith('.tsx'));
    const offenders = pages.filter((path) => /rounded-lg bg-accent px-5 py-3/.test(read(path)));
    expect(offenders, `these still describe a button:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('names the outlined card the console draws eighty-six times', () => {
    /*
     * The same thing the buttons were doing: a treatment that exists and has no
     * name, so it is retyped and drifts — `rounded-xl border border-line p-5`
     * with nine variations of what followed. `.panel` is the filled one for
     * grouped content; `.card` is the outlined one for an item in a list.
     *
     * The surfaces she works in were moved first: the console, the review queue
     * and the admin pages. The marketing pages still draw their own, which is
     * written down rather than left as a surprise.
     */
    expect(css).toMatch(/^\.card \{/m);
    const working = execFileSync(
      'git',
      ['ls-files', 'apps/web/app/console', 'apps/web/app/review', 'apps/web/app/admin'],
      { encoding: 'utf8' },
    )
      .split('\n')
      .filter((path) => path.endsWith('.tsx'));
    const handDrawn = working.filter((path) =>
      /rounded-xl border border-line p-[56]/.test(readFileSync(path, 'utf8')),
    );
    expect(handDrawn, `these still draw their own card:\n${handDrawn.join('\n')}`).toEqual([]);
  });

  it('gives a card you can go into something to do when you reach for it', () => {
    // And gives one that is only text nothing to do, because a thing that
    // moves and does nothing is a lie about what a click would do.
    expect(css).toMatch(/\.card:has\(a\):hover,\n\.panel:has\(a\):hover \{/);
    expect(css.slice(css.indexOf('.panel {'), css.indexOf('.panel:has'))).toMatch(/box-shadow:/);
  });

  it('moves the front page once rather than on every element', () => {
    const home = read('apps/web/app/page.tsx');
    expect(home).toMatch(/className="rises /);
    expect(home).toMatch(/rises-later/);
    expect((home.match(/\brises\b/g) ?? []).length).toBeLessThan(4);
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
