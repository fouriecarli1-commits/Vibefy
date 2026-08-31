/**
 * An objective eye on how a thing looks.
 *
 * Anré asked for this and described the problem exactly: you get tired, you get
 * trapped in fixing, it feels like building and building and never getting the
 * look right. That is not a failure of taste. It is what happens when a page is
 * assembled a piece at a time and nobody ever counts the pieces.
 *
 * So this counts them. It says nothing about whether a design is good — that is
 * taste, it cannot be evidenced, and the game pass refuses the same thing for
 * the same reason. What it can say is how many different type sizes are on the
 * page, how many of the spacings fall on no scale at all, how many distinct
 * button styles there are, and which text nobody can read. None of that is an
 * opinion. All of it is why a page feels unfinished to somebody who cannot say
 * why.
 *
 * The findings are `info` severity, which the published rubric penalises at
 * zero. That is deliberate: coherence has no criterion in rubric 1.0.0, and
 * inventing one would make the score mean something other than what the
 * published rubric says it means. They appear in the report and move nothing.
 * The two things here that *do* have criteria — unreadable text and leftover
 * placeholder copy — are scored, because UX-06 already covers them.
 */
import { contrastRatio } from '@vibefycode/shared';
import type { BrowserSession } from '../runtime/browser.ts';
import type { RawFinding } from './types.ts';

/** Above this many distinct values, nobody is working from a scale. */
const SPRAWL = {
  fontFamilies: 3,
  fontSizes: 8,
  textColours: 8,
  borderRadii: 4,
  // Three, not two. Running this against our own pages found a primary button,
  // a secondary button and a smaller control in the navigation — which is not
  // sprawl, it is the minimum vocabulary any interface needs. A threshold that
  // fires on every well-built site is noise, and noise is how a report teaches
  // somebody to stop reading it. The fixture assembled by eye has five.
  buttonStyles: 3,
} as const;

/** Spacings are expected to fall on this grid. Four covers 4-, 8- and 16-based. */
const SPACING_GRID_PX = 4;
/** Below this share on the grid, the spacing is being chosen by eye each time. */
const SPACING_ON_GRID_TARGET = 0.8;

/** WCAG 2.2 AA: 4.5:1 for body text, 3:1 for large. */
const CONTRAST_MIN = { normal: 4.5, large: 3 } as const;
/** WCAG 2.2 AA 2.5.8. Twenty-four pixels is the floor, not the target. */
const MIN_TAP_TARGET_PX = 24;

const PLACEHOLDER_PATTERNS = [
  /lorem ipsum/i,
  /\bdolor sit amet\b/i,
  /\byour (?:text|title|headline|content) here\b/i,
  /\bplaceholder\b/i,
  /\bTODO\b/,
  /\bcoming soon\b/i,
  /\bexample\.com\b/i,
];

export interface ColourPair {
  readonly foreground: string;
  readonly background: string;
  readonly fontSizePx: number;
  readonly bold: boolean;
  readonly sample: string;
}

export interface DesignMeasurements {
  readonly fontFamilies: readonly string[];
  readonly fontSizesPx: readonly number[];
  readonly textColours: readonly string[];
  readonly backgroundColours: readonly string[];
  readonly borderRadiiPx: readonly number[];
  readonly spacingsPx: readonly number[];
  readonly spacingsOnGrid: number;
  readonly buttonStyles: readonly string[];
  readonly headingCounts: Readonly<Record<string, number>>;
  readonly skippedHeadingLevels: readonly string[];
  readonly colourPairs: readonly ColourPair[];
  readonly placeholderCopy: readonly string[];
  readonly smallTapTargets: readonly { label: string; width: number; height: number }[];
}

/**
 * Everything read from the live page in one pass.
 *
 * Computed styles rather than stylesheets, because what matters is what a
 * visitor sees resolved — a design system with six sizes declared and eleven in
 * use is the case this is looking for, and reading the CSS would report six.
 */
const SURVEY = `(() => {
  const visible = (element) => {
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const opaqueBackground = (element) => {
    let node = element;
    while (node && node !== document.documentElement) {
      const colour = getComputedStyle(node).backgroundColor;
      if (colour && !colour.startsWith('rgba(0, 0, 0, 0)') && colour !== 'transparent') return colour;
      node = node.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor || 'rgb(255, 255, 255)';
  };

  const hasOwnText = (element) =>
    [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim().length > 1);

  const families = new Set();
  const sizes = new Set();
  const textColours = new Set();
  const backgrounds = new Set();
  const radii = new Set();
  const spacings = [];
  const buttons = new Set();
  const pairs = [];
  const headings = {};
  const smallTargets = [];

  for (const element of document.body.querySelectorAll('*')) {
    if (!visible(element)) continue;
    const style = getComputedStyle(element);

    // Only elements that actually carry text contribute type and colour: a
    // wrapper inherits a font size it does not use, and counting it would
    // report sprawl nobody can see.
    if (hasOwnText(element)) {
      families.add(style.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, ''));
      sizes.add(Math.round(parseFloat(style.fontSize)));
      textColours.add(style.color);
      const background = opaqueBackground(element);
      backgrounds.add(background);
      pairs.push({
        foreground: style.color,
        background,
        fontSizePx: Math.round(parseFloat(style.fontSize)),
        bold: Number(style.fontWeight) >= 700,
        sample: (element.textContent || '').trim().slice(0, 60),
      });
    }

    const radius = Math.round(parseFloat(style.borderTopLeftRadius));
    if (radius > 0) radii.add(radius);

    for (const property of ['marginTop', 'marginBottom', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'gap']) {
      const value = Math.round(parseFloat(style[property]));
      if (Number.isFinite(value) && value > 0) spacings.push(value);
    }

    const tag = element.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) headings[tag] = (headings[tag] || 0) + 1;

    const looksInteractive =
      tag === 'button' ||
      (tag === 'a' && element.getAttribute('href')) ||
      element.getAttribute('role') === 'button' ||
      (tag === 'input' && ['button', 'submit'].includes(element.type));

    if (looksInteractive) {
      const rect = element.getBoundingClientRect();
      // A styled control, not a link inside a sentence: an inline anchor has no
      // background and no padding, and counting it as a button style would
      // report every paragraph as a design inconsistency.
      const styled =
        style.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(style.paddingLeft) > 6;
      if (styled) {
        buttons.add(
          [
            Math.round(rect.height),
            Math.round(parseFloat(style.borderTopLeftRadius)),
            Math.round(parseFloat(style.fontSize)),
            style.backgroundColor,
            style.borderTopWidth,
          ].join('|'),
        );
      }
      if (tag !== 'a' || styled) {
        if (rect.width > 0 && rect.height > 0 && (rect.width < 24 || rect.height < 24)) {
          smallTargets.push({
            label: (element.textContent || element.getAttribute('aria-label') || tag).trim().slice(0, 40),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          });
        }
      }
    }
  }

  return {
    families: [...families],
    sizes: [...sizes].sort((a, b) => a - b),
    textColours: [...textColours],
    backgrounds: [...backgrounds],
    radii: [...radii].sort((a, b) => a - b),
    spacings,
    buttons: [...buttons],
    headings,
    pairs,
    smallTargets,
    bodyText: document.body.innerText.slice(0, 20000),
  };
})();`;

function toHex(colour: string): string | null {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(colour);
  if (!match) return null;
  // A translucent foreground cannot be judged without compositing it, and
  // guessing at the result would produce a contrast figure nobody could check.
  if (match[4] !== undefined && Number(match[4]) < 0.95) return null;
  return `#${[1, 2, 3].map((index) => Number(match[index]).toString(16).padStart(2, '0')).join('')}`;
}

export async function measureDesign(
  session: BrowserSession,
  url: string,
): Promise<DesignMeasurements> {
  await session.goto(url, 'networkidle');
  const survey = (await session.page.evaluate(SURVEY)) as {
    families: string[];
    sizes: number[];
    textColours: string[];
    backgrounds: string[];
    radii: number[];
    spacings: number[];
    buttons: string[];
    headings: Record<string, number>;
    pairs: ColourPair[];
    smallTargets: { label: string; width: number; height: number }[];
    bodyText: string;
  };

  const distinctSpacings = [...new Set(survey.spacings)].sort((a, b) => a - b);
  const onGrid = survey.spacings.filter((value) => value % SPACING_GRID_PX === 0).length;

  const levels = [1, 2, 3, 4, 5, 6].filter((level) => (survey.headings[`h${level}`] ?? 0) > 0);
  const skipped: string[] = [];
  for (let index = 1; index < levels.length; index += 1) {
    const previous = levels[index - 1]!;
    const current = levels[index]!;
    if (current - previous > 1) skipped.push(`h${previous} to h${current}`);
  }

  return {
    fontFamilies: survey.families,
    fontSizesPx: survey.sizes,
    textColours: survey.textColours,
    backgroundColours: survey.backgrounds,
    borderRadiiPx: survey.radii,
    spacingsPx: distinctSpacings,
    spacingsOnGrid: survey.spacings.length === 0 ? 1 : onGrid / survey.spacings.length,
    buttonStyles: survey.buttons,
    headingCounts: survey.headings,
    skippedHeadingLevels: skipped,
    colourPairs: survey.pairs,
    placeholderCopy: PLACEHOLDER_PATTERNS.flatMap((pattern) => {
      const found = pattern.exec(survey.bodyText);
      return found ? [found[0]] : [];
    }),
    smallTapTargets: survey.smallTargets,
  };
}

/** Text nobody can read, using the same arithmetic the contrast gate uses. */
export function unreadableText(measurements: DesignMeasurements): ColourPair[] {
  return measurements.colourPairs.filter((pair) => {
    const foreground = toHex(pair.foreground);
    const background = toHex(pair.background);
    if (!foreground || !background) return false;
    const large = pair.fontSizePx >= 24 || (pair.fontSizePx >= 18.66 && pair.bold);
    return contrastRatio(foreground, background) < CONTRAST_MIN[large ? 'large' : 'normal'];
  });
}

export function designFindings(
  measurements: DesignMeasurements,
  evidenceIds: readonly string[],
): RawFinding[] {
  const findings: RawFinding[] = [];
  const evidence = [...evidenceIds];

  /** Coherence has no criterion in rubric 1.0.0, so it is recorded and scored at zero. */
  const observation = (title: string, description: string, remediation: string): RawFinding => ({
    ruleId: 'UX-01',
    dimension: 'practicality_ux',
    severity: 'info',
    confidence: 'high',
    title,
    description: `${description} This is recorded as an observation: the published rubric has no criterion for visual consistency, so it does not affect the score.`,
    remediation,
    evidenceIds: evidence,
  });

  if (measurements.fontSizesPx.length > SPRAWL.fontSizes) {
    findings.push(
      observation(
        `${measurements.fontSizesPx.length} different text sizes on one page`,
        `The page renders text at ${measurements.fontSizesPx.join(', ')} pixels. A page working from a type scale usually shows five to eight; past that, sizes are being chosen one element at a time, which is most of why a page can look unfinished without anything on it being wrong.`,
        'Pick a scale — five or six sizes — and map everything onto it. The sizes that disappear are almost always ones nobody chose on purpose.',
      ),
    );
  }

  if (measurements.fontFamilies.length > SPRAWL.fontFamilies) {
    findings.push(
      observation(
        `${measurements.fontFamilies.length} different typefaces`,
        `In use: ${measurements.fontFamilies.join(', ')}. More than two or three usually means a component arrived with its own font and nobody noticed.`,
        'Set the family once, on the body, and let everything inherit it. Anything that then changes is doing so on purpose.',
      ),
    );
  }

  if (measurements.textColours.length > SPRAWL.textColours) {
    findings.push(
      observation(
        `${measurements.textColours.length} different text colours`,
        `A page usually needs three or four: ordinary text, quieter text, a link, and something for an error. ${measurements.textColours.length} means the greys have been picked by eye.`,
        'Define the few you need as tokens and use them by name. A colour with no name is a colour that will have a near-twin by next month.',
      ),
    );
  }

  if (measurements.spacingsOnGrid < SPACING_ON_GRID_TARGET) {
    findings.push(
      observation(
        `${Math.round((1 - measurements.spacingsOnGrid) * 100)}% of the spacing falls on no scale`,
        `Margins, padding and gaps are set to ${measurements.spacingsPx.length} distinct values, and only ${Math.round(measurements.spacingsOnGrid * 100)}% of them are multiples of ${SPACING_GRID_PX}px. Inconsistent spacing is the thing people notice most and name least: it reads as "something is off" rather than as a spacing problem.`,
        `Round every spacing to a multiple of ${SPACING_GRID_PX}px. It is a mechanical change and it is usually the single biggest visible improvement available.`,
      ),
    );
  }

  if (measurements.buttonStyles.length > SPRAWL.buttonStyles) {
    findings.push(
      observation(
        `${measurements.buttonStyles.length} different button styles`,
        'Buttons differ in height, corner radius, text size, background or border. A primary, a secondary and a compact control is a vocabulary; past that, a component arrived with its own idea of what a button is, and mixed buttons are the most common single reason an interface reads as assembled rather than designed.',
        'Work out which of these are doing the same job and make them the same. The ones that disappear are almost always a component that was written in isolation and never compared with anything.',
      ),
    );
  }

  if (measurements.borderRadiiPx.length > SPRAWL.borderRadii) {
    findings.push(
      observation(
        `${measurements.borderRadiiPx.length} different corner radii`,
        `Corners are rounded at ${measurements.borderRadiiPx.join(', ')} pixels. Mixed radii are hard to see one at a time and obvious at a glance across a page.`,
        'Two radii — one for small controls, one for panels — is enough for almost any interface.',
      ),
    );
  }

  const h1 = measurements.headingCounts.h1 ?? 0;
  if (h1 !== 1) {
    findings.push(
      observation(
        h1 === 0 ? 'The page has no top-level heading' : `The page has ${h1} top-level headings`,
        'A page has one subject, and one h1 says what it is. Screen readers and search engines both use it, and so does anybody skimming.',
        'Use exactly one h1 for the page subject, then h2 for its sections.',
      ),
    );
  }

  if (measurements.skippedHeadingLevels.length > 0) {
    findings.push(
      observation(
        'Heading levels skip a step',
        `The page jumps from ${measurements.skippedHeadingLevels.join(', ')}. Somebody navigating by headings — which is how most screen-reader users read a page — is told a section is nested inside one that does not exist.`,
        'Use the next level down rather than the one that happens to look right. Size is a matter for the stylesheet.',
      ),
    );
  }

  // The two that do have a criterion, and are therefore scored.
  const unreadable = unreadableText(measurements);
  if (unreadable.length > 0) {
    const worst = unreadable[0]!;
    findings.push({
      ruleId: 'UX-06',
      dimension: 'practicality_ux',
      severity: 'medium',
      confidence: 'high',
      title: `${unreadable.length} passage${unreadable.length === 1 ? '' : 's'} of text below the readable contrast threshold`,
      description: `Text is rendered in ${worst.foreground} on ${worst.background}, which is below the WCAG 2.2 AA threshold of ${CONTRAST_MIN.normal}:1 for text of that size. The first instance reads “${worst.sample}”. Low-contrast text is legible on the screen it was designed on and disappears on a phone outdoors.`,
      remediation:
        'Darken the text or lighten what is behind it until the ratio passes. This is arithmetic rather than judgement — the same calculation is in the standard.',
      evidenceIds: evidence,
    });
  }

  if (measurements.placeholderCopy.length > 0) {
    findings.push({
      ruleId: 'UX-06',
      dimension: 'practicality_ux',
      severity: 'medium',
      confidence: 'high',
      title: 'Placeholder copy is still on the page',
      description: `Found: ${measurements.placeholderCopy.map((text) => `“${text}”`).join(', ')}. Placeholder text that reaches a visitor says the page was never finished, whatever else is on it.`,
      remediation: 'Replace it, or remove the section until there is something to put there.',
      evidenceIds: evidence,
    });
  }

  if (measurements.smallTapTargets.length > 0) {
    findings.push({
      ruleId: 'UX-04',
      dimension: 'practicality_ux',
      severity: 'low',
      confidence: 'high',
      title: `${measurements.smallTapTargets.length} control${measurements.smallTapTargets.length === 1 ? '' : 's'} smaller than a finger`,
      description: `WCAG 2.2 AA asks for at least ${MIN_TAP_TARGET_PX}×${MIN_TAP_TARGET_PX} pixels. The smallest here is “${measurements.smallTapTargets[0]!.label}” at ${measurements.smallTapTargets[0]!.width}×${measurements.smallTapTargets[0]!.height}. A control that is hard to hit is a control people hit by accident.`,
      remediation:
        'Add padding rather than growing the icon. The target can be larger than the thing that looks like the target.',
      evidenceIds: evidence,
    });
  }

  return findings;
}
