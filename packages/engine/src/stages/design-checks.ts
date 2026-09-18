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

/**
 * How close two values have to be before one of them is the other, mistyped.
 *
 * The first version of this used a window alone — anything within eight pixels
 * — and running it against our own pages showed what is wrong with that. It
 * reported a block starting at 477px where the page usually starts at 485px.
 * Eight pixels is not a near-miss on a four-pixel scale; it is two steps of it,
 * and somebody chose it.
 *
 * So closeness is not enough. A difference that is a whole step of the spacing
 * grid is a decision, whatever its size; a difference that is not is the same
 * value typed twice. Four pixels apart is an indent. Three is a mistake, and it
 * is the kind somebody sees without being able to name it, because every block
 * looked right on its own.
 */
const NEAR_MISS_WINDOW_PX = 12;

/**
 * How often a value has to appear before it counts as the one that was meant.
 *
 * Without this the report chains: one edge a few pixels off the column drags in
 * its neighbour, and a legitimate indent gets reported because it is close to
 * the mistake rather than to anything anybody chose. A value used once is not a
 * pattern to be off. A page where nothing repeats has a different problem, and
 * the spacing-on-a-grid check is the one that finds it.
 */
const MIN_INTENDED_OCCURRENCES = 2;

/** Below this many blocks, there is not enough on the page to read a column. */
const EDGE_MIN_BLOCKS = 8;
/** One near-miss can be a rounded border. Two is the page being set by eye. */
const EDGE_MISS_COUNT = 2;
/** One near-miss can be a one-off. Two is the page being set by eye. */
const RHYTHM_MISS_COUNT = 2;

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

/** A left edge that is nearly, but not quite, another left edge on the page. */
export interface EdgeMiss {
  readonly edgePx: number;
  readonly nearestPx: number;
  readonly occurrences: number;
  readonly sample: string;
}

/** A gap that is nearly, but not quite, one the page already uses. */
export interface RhythmMiss {
  readonly gapPx: number;
  readonly nearestPx: number;
  readonly occurrences: number;
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
  /** The left edge most of the page's blocks start at, or null if there is none. */
  readonly dominantLeftEdgePx: number | null;
  /** How many blocks were measured against it. */
  readonly measuredBlocks: number;
  readonly edgeMisses: readonly EdgeMiss[];
  /** Every distinct vertical gap between stacked blocks, most common first. */
  readonly verticalGapsPx: readonly number[];
  readonly rhythmMisses: readonly RhythmMiss[];
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
    // Text that exists only for a screen reader is not on the page a sighted
    // person sees, and it was being counted: its font size, its colour and its
    // left edge all went into the survey. The standard way of hiding it leaves
    // a one-pixel box that is clipped away, which passes a width test and fails
    // every other kind of test a human would apply.
    if (style.clip === 'rect(0px, 0px, 0px, 0px)' || style.clipPath === 'inset(50%)') return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return false;
    return true;
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
  const leftEdges = [];
  const gaps = [];

  // Only a block participates in a column or in a rhythm. An inline element
  // starts wherever the sentence around it left off, and counting it would
  // report every second word as misaligned.
  const isBlock = (element) => {
    const display = getComputedStyle(element).display;
    return display === 'block' || display === 'flex' || display === 'grid' || display === 'list-item';
  };

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

  // One pass over every container, for both rhythm and alignment.
  //
  // Only a stack is read. A row of chips, a wrapping footer, a grid of cards
  // laid out side by side — in all of those a child's left edge is decided by
  // how wide its neighbour happens to be, not by a column anybody chose, and
  // reading those edges reported our own centred status chips as misaligned.
  // A row has no vertical rhythm to read either, for the same reason.
  for (const parent of [document.body, ...document.body.querySelectorAll('*')]) {
    const children = [...parent.children].filter((child) => visible(child) && isBlock(child));
    if (children.length === 0) continue;

    let stacked = true;
    for (let index = 1; index < children.length; index += 1) {
      const above = children[index - 1].getBoundingClientRect();
      const below = children[index].getBoundingClientRect();
      if (below.top + 1 < above.bottom) {
        stacked = false;
        break;
      }
    }
    if (!stacked) continue;

    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      const rect = child.getBoundingClientRect();
      if (hasOwnText(child)) {
        leftEdges.push({
          left: Math.round(rect.left),
          sample: (child.textContent || '').trim().slice(0, 60),
        });
      }
      if (index === 0) continue;
      const above = children[index - 1].getBoundingClientRect();
      const gap = Math.round(rect.top - above.bottom);
      if (gap > 0 && gap <= 200) gaps.push(gap);
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
    leftEdges,
    gaps,
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

/**
 * Left edges that are nearly, but not quite, each other.
 *
 * Deliberately not a count of distinct edges. A page has as many legitimate
 * indents as it has nesting — a list inside a card inside a section is three
 * edges and nothing is wrong — so counting them would fire on every well-built
 * page. What is never on purpose is two edges a few pixels apart: three stacked
 * cards whose headings start at 48, 53 and 49 look ragged, and each card looked
 * right on its own, which is exactly why the person who built it cannot see it.
 */
export function readAlignment(edges: readonly { left: number; sample: string }[]): {
  dominant: number | null;
  measured: number;
  misses: EdgeMiss[];
} {
  if (edges.length < EDGE_MIN_BLOCKS) return { dominant: null, measured: edges.length, misses: [] };

  const counts = new Map<number, number>();
  const sample = new Map<number, string>();
  for (const edge of edges) {
    counts.set(edge.left, (counts.get(edge.left) ?? 0) + 1);
    if (!sample.has(edge.left)) sample.set(edge.left, edge.sample);
  }

  let dominant = edges[0]!.left;
  for (const [left, count] of counts) {
    if (count > (counts.get(dominant) ?? 0)) dominant = left;
  }

  const misses: EdgeMiss[] = [];
  for (const [left, occurrences] of counts) {
    // Compared against an edge the page uses *more* often, so a pair is
    // reported once, against the one that looks like the intended column.
    const nearest = nearestIntended(counts, left, occurrences);
    if (nearest !== null) {
      misses.push({
        edgePx: left,
        nearestPx: nearest,
        occurrences,
        sample: sample.get(left) ?? '',
      });
    }
  }

  return {
    dominant,
    measured: edges.length,
    misses: misses.sort((a, b) => b.occurrences - a.occurrences || a.edgePx - b.edgePx),
  };
}

/**
 * The value this one was probably meant to be, or null if there is no such value.
 *
 * "Probably meant" is the value the page uses more often, so a pair of
 * near-misses is reported once rather than each accusing the other. Ties go to
 * the smaller value, which is arbitrary and only has to be stable.
 */
function nearestIntended(
  counts: ReadonlyMap<number, number>,
  value: number,
  occurrences: number,
): number | null {
  let nearest: number | null = null;
  for (const [other, otherCount] of counts) {
    if (other === value) continue;
    if (otherCount < MIN_INTENDED_OCCURRENCES) continue;
    const distance = Math.abs(other - value);
    if (distance > NEAR_MISS_WINDOW_PX) continue;
    // A whole step of the scale is a decision. Anything else is a slip.
    if (distance % SPACING_GRID_PX === 0) continue;
    const looksIntended = otherCount > occurrences || (otherCount === occurrences && other < value);
    if (!looksIntended) continue;
    if (nearest === null || distance < Math.abs(nearest - value)) nearest = other;
  }
  return nearest;
}

/**
 * Gaps that are nearly, but not quite, a gap the page already uses.
 *
 * No threshold on how many distinct gaps a page may have, because a page is
 * entitled to as many as it has jobs. What is measured is repetition failing:
 * a twenty-one where everything else is a twenty-four is the same gap, retyped.
 */
export function readRhythm(gaps: readonly number[]): { distinct: number[]; misses: RhythmMiss[] } {
  const counts = new Map<number, number>();
  for (const gap of gaps) counts.set(gap, (counts.get(gap) ?? 0) + 1);
  const distinct = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([gap]) => gap);

  const misses: RhythmMiss[] = [];
  for (const [gap, occurrences] of counts) {
    const nearest = nearestIntended(counts, gap, occurrences);
    if (nearest !== null) misses.push({ gapPx: gap, nearestPx: nearest, occurrences });
  }

  return {
    distinct,
    misses: misses.sort((a, b) => b.occurrences - a.occurrences || a.gapPx - b.gapPx),
  };
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
    leftEdges: { left: number; sample: string }[];
    gaps: number[];
    bodyText: string;
  };

  const alignment = readAlignment(survey.leftEdges);
  const rhythm = readRhythm(survey.gaps);

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
    dominantLeftEdgePx: alignment.dominant,
    measuredBlocks: alignment.measured,
    edgeMisses: alignment.misses,
    verticalGapsPx: rhythm.distinct,
    rhythmMisses: rhythm.misses,
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

/**
 * Where the page was being looked at, when it was not the ordinary width.
 *
 * A page is built at the width its author had open, and the breakpoints
 * underneath it are where a type scale quietly acquires three more sizes and a
 * spacing grid dissolves into whatever a clamp resolves to. Saying which width
 * a finding came from is the difference between somebody being able to go and
 * look at it and somebody reading a number they cannot reproduce.
 */
export interface DesignSurveyContext {
  /** In words a report can put in a sentence: "at phone width (390px wide)". */
  readonly at?: string;
}

export function designFindings(
  measurements: DesignMeasurements,
  evidenceIds: readonly string[],
  context: DesignSurveyContext = {},
): RawFinding[] {
  const findings: RawFinding[] = [];
  const evidence = [...evidenceIds];
  const where = context.at ? `Seen ${context.at}. ` : '';

  /**
   * Coherence has its own criterion since rubric 1.1.0, and still scores
   * nothing.
   *
   * The severity is what decides whether a finding moves a score, not whether
   * a criterion exists — and tightening what a badge requires is a separate
   * decision from giving an observation somewhere to be recorded. Until
   * somebody takes that decision, these appear in the report and change no
   * number.
   */
  const observation = (title: string, description: string, remediation: string): RawFinding => ({
    ruleId: 'UX-07',
    dimension: 'practicality_ux',
    severity: 'info',
    confidence: 'high',
    title,
    description: `${where}${description} This is recorded as an observation: the published rubric has no criterion for visual consistency, so it does not affect the score.`,
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

  if (measurements.edgeMisses.length >= EDGE_MISS_COUNT) {
    const worst = measurements.edgeMisses[0]!;
    findings.push(
      observation(
        `${measurements.edgeMisses.length} left edges are nearly the same as another`,
        `Blocks start at ${measurements.edgeMisses.length} positions that are within a few pixels of another position the page uses more often, and not a whole step of the ${SPACING_GRID_PX}px scale away from it — ${worst.edgePx}px where the page more usually starts at ${worst.nearestPx}px, at “${worst.sample}”. An indent of ${SPACING_GRID_PX * 2}px reads as a decision. ${SPACING_GRID_PX * 2 - 1}px reads as a mistake, and it is the kind somebody sees without being able to name, because each block looked right on its own.`,
        'Give the page one left edge per level of nesting, and let anything that indents do so by a whole step of the spacing scale. Most of these are an extra pixel of border, padding set on one card and not its neighbour, or a margin that was nudged once and never put back.',
      ),
    );
  }

  if (measurements.rhythmMisses.length >= RHYTHM_MISS_COUNT) {
    const worst = measurements.rhythmMisses[0]!;
    findings.push(
      observation(
        `${measurements.rhythmMisses.length} vertical gaps are nearly the same as another`,
        `The gaps between stacked blocks take ${measurements.verticalGapsPx.length} distinct values. ${measurements.rhythmMisses.length} of them are within a few pixels of a gap the page uses more often, and not a whole step of the ${SPACING_GRID_PX}px scale away from it — ${worst.gapPx}px where it more usually uses ${worst.nearestPx}px, ${worst.occurrences} time${worst.occurrences === 1 ? '' : 's'}. A page is entitled to as many different gaps as it has jobs; what it cannot carry is one gap typed three slightly different ways, which is rhythm failing rather than spacing being wrong.`,
        'Round each of these to the value the page already uses more often. Nothing moves more than a few pixels, and it is the change that most reliably makes a page look finished.',
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
