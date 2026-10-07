/**
 * Every contrast check passed on a page built with Tailwind v4.
 *
 * `measureDesign` read `getComputedStyle(element).color` and handed it to a
 * parser that accepted `rgb()` and `rgba()` and nothing else. The assumption is
 * that a computed colour is normalised to sRGB. It is not. Measured in the
 * Chromium this engine runs, before anything was changed:
 *
 *     color: oklch(0.55 0.02 250)        → oklch(0.55 0.02 250)
 *     color: color(display-p3 .5 .5 .5)  → color(display-p3 0.5 0.5 0.5)
 *     color: lab(50% 20 -30)             → lab(50 20 -30)
 *     color: color-mix(in oklch, …)      → oklch(0.539974 0.285457 326.643)
 *     color: #777                        → rgb(119, 119, 119)
 *
 * Only the last one parsed. The others became `null`, and `unreadableText` read
 * `null` as "readable" — the safe-looking direction, and the wrong one, because
 * it turns "we could not measure this" into "we measured this and it passed".
 *
 * **oklch is Tailwind v4's default palette.** So for the CSS framework a
 * vibe-coded application is most likely to be built with, UX-06 could not fire,
 * on a dimension the brief makes a rubric criterion and holds this product to.
 *
 * The fix asks the browser instead of parsing its answer. A one-pixel canvas
 * resolves whatever the browser can paint, which is the right authority: the
 * question is what a person sees. It also composites a translucent foreground
 * over the background actually behind it — `rgba(0, 0, 0, 0.4)` over white is
 * `#999999`, which is the colour on the screen. The old code refused to guess
 * at that, correctly; painting is not guessing.
 *
 * A pair the browser still cannot paint is left alone *and said out loud*. That
 * is the part that matters: accusing somebody of a contrast failure nobody
 * measured is worse than missing it, so it stays a gap in coverage and the
 * stage's notes report it rather than letting it read as a check that passed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import {
  unmeasurableText,
  unreadableText,
  type DesignMeasurements,
} from '../packages/engine/src/stages/design-checks.ts';
import { resolveBrowserExecutable } from '../packages/engine/src/runtime/browser.ts';

let browser: Browser;
let page: Page;

beforeAll(async () => {
  // The same fallback `BrowserSession` uses: this container's Chromium build is
  // not the one this Playwright release looks for by default, and the engine
  // already has the resolver for that.
  try {
    browser = await chromium.launch();
  } catch (error) {
    const executablePath = resolveBrowserExecutable();
    if (!executablePath) throw error;
    browser = await chromium.launch({ executablePath });
  }
  page = await browser.newPage();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

/**
 * The survey run against a page, through the stage's own code.
 *
 * `measureDesign` takes a `BrowserSession`, and the only part of one it uses
 * here is `page`, so the page is passed as that shape rather than standing a
 * whole session up for a colour question.
 */
async function surveyOf(html: string): Promise<DesignMeasurements> {
  await page.setContent(html);
  const { measureDesign } = await import('../packages/engine/src/stages/design-checks.ts');
  return measureDesign({ page } as never);
}

const PAGE = (css: string) =>
  `<!doctype html><html><body style="background: #ffffff">
     <p style="${css}; font-size: 16px; padding: 8px">A sentence a visitor has to read.</p>
   </body></html>`;

describe('a colour outside sRGB', () => {
  it('is measured, where the old parser produced nothing', async () => {
    // oklch(0.75 0.02 250) on white is about 2.3:1 — below AA for 16px text,
    // and the kind of grey a designer picks without checking.
    const survey = await surveyOf(PAGE('color: oklch(0.75 0.02 250)'));
    expect(unreadableText(survey).length).toBeGreaterThan(0);
  });

  it('is measured in display-p3 too', async () => {
    const survey = await surveyOf(PAGE('color: color(display-p3 0.72 0.72 0.72)'));
    expect(unreadableText(survey).length).toBeGreaterThan(0);
  });

  it('is measured through a color-mix, which resolves to oklch', async () => {
    const survey = await surveyOf(PAGE('color: color-mix(in oklch, white 78%, black)'));
    expect(unreadableText(survey).length).toBeGreaterThan(0);
  });

  it('still passes a colour that genuinely passes', async () => {
    // The direction this fix fails in: finding a contrast failure on every
    // page, which is the same as finding none.
    const survey = await surveyOf(PAGE('color: oklch(0.2 0.02 250)'));
    expect(unreadableText(survey)).toEqual([]);
  });

  it('resolves the pair to something a person can check', async () => {
    const survey = await surveyOf(PAGE('color: oklch(0.75 0.02 250)'));
    const pair = unreadableText(survey)[0]!;
    expect(pair.foreground).toMatch(/^#[0-9a-f]{6}$/);
    expect(pair.background).toBe('#ffffff');
    // And what the stylesheet said, so the author recognises it.
    expect(pair.rawForeground).toContain('oklch');
  });
});

describe('a translucent colour', () => {
  it('is composited over what is behind it rather than discarded', async () => {
    // rgba(0,0,0,0.25) over white is #bfbfbf — about 1.9:1, unreadable. The old
    // code returned null for any alpha below 0.95 and read null as readable.
    const survey = await surveyOf(PAGE('color: rgba(0, 0, 0, 0.25)'));
    expect(unreadableText(survey).length).toBeGreaterThan(0);
    expect(unreadableText(survey)[0]!.foreground).toBe('#bfbfbf');
  });
});

describe('a colour the browser cannot paint either', () => {
  /*
   * Tested against the shape rather than against a page, and that is the
   * finding.
   *
   * Three attempts to produce an unpaintable computed colour from real CSS all
   * failed: an undefined `var()` falls back to the inherited colour, which the
   * browser paints happily. In this Chromium the canvas resolves everything
   * `getComputedStyle` will hand back — which is the good news this fix was
   * hoping for, and exactly why the null branch still has to be held: it is
   * now the branch nothing exercises, and those are the ones that rot.
   */
  const unpaintable: DesignMeasurements = {
    fontFamilies: [],
    fontSizesPx: [16],
    textColours: ['oklab(from var(--x) l a b)'],
    backgroundColours: ['#ffffff'],
    borderRadiiPx: [],
    spacingsPx: [],
    spacingsOnGrid: 1,
    buttonStyles: [],
    headingCounts: {},
    skippedHeadingLevels: [],
    colourPairs: [
      {
        foreground: null,
        background: '#ffffff',
        rawForeground: 'oklab(from var(--x) l a b)',
        rawBackground: 'rgb(255, 255, 255)',
        fontSizePx: 16,
        bold: false,
        sample: 'A sentence a visitor has to read.',
      },
    ],
    placeholderCopy: [],
    smallTapTargets: [],
    dominantLeftEdgePx: null,
    measuredBlocks: 0,
    edgeMisses: [],
    verticalGapsPx: [],
    rhythmMisses: [],
  };

  it('is not accused, because nobody measured it', () => {
    expect(unreadableText(unpaintable)).toEqual([]);
  });

  it('is counted as unmeasured, which is not the same as passing', () => {
    expect(unmeasurableText(unpaintable)).toHaveLength(1);
  });

  it('keeps what the stylesheet said, so the note can name it', () => {
    expect(unmeasurableText(unpaintable)[0]!.rawForeground).toContain('oklab');
  });
});

describe('a page with nothing to measure', () => {
  it('does not report full marks on a grid it never saw', async () => {
    // `spacingsOnGrid` is 1 when no spacing was measured, so the note read
    // "100% of spacing on a 4px grid" for a page where nothing was measured.
    // The number is kept — a ratio of nothing has to be something — and the
    // note no longer quotes it.
    const survey = await surveyOf('<!doctype html><html><body></body></html>');
    expect(survey.spacingsPx).toEqual([]);
    expect(survey.spacingsOnGrid).toBe(1);
  });
});
