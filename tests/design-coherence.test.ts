/**
 * The objective eye Anré asked for.
 *
 * He described the problem exactly: you get tired, you get trapped in fixing,
 * it feels like building and building and never getting the look right. That is
 * not a failure of taste. It is what happens when a page is assembled a piece at
 * a time and nobody ever counts the pieces — every value was plausible when it
 * was written, which is precisely why the person who wrote them cannot see it.
 *
 * So this counts them, and says nothing about whether the result is good. The
 * fixture is a page nobody would defend and nobody would call unusual; the same
 * page on a scale is served at `?fixed=1`. The pair is what makes the checks
 * mean anything: one that finds sprawl on every page has not been shown to
 * distinguish.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserSession } from '../packages/engine/src/runtime/browser.ts';
import { EvidenceStore } from '../packages/engine/src/runtime/evidence.ts';
import { DEFAULT_CEILING, ScopeGuard } from '../packages/engine/src/runtime/scope.ts';
import {
  designFindings,
  measureDesign,
  readAlignment,
  readRhythm,
  unreadableText,
  type DesignMeasurements,
} from '../packages/engine/src/stages/design-checks.ts';
import { startIncoherentPage, type PageFixture } from './fixtures/incoherent-page.ts';

let page: PageFixture;
let messy: DesignMeasurements;
let coherent: DesignMeasurements;

/** Left edges as the survey hands them over, for the unit-level checks. */
const edges = (lefts: number[]) => lefts.map((left) => ({ left, sample: `at ${left}` }));

const titles = (measurements: DesignMeasurements) =>
  designFindings(measurements, ['evidence-1']).map((finding) => finding.title);

beforeAll(async () => {
  page = await startIncoherentPage();
  const guard = new ScopeGuard({
    allowedHosts: [page.host.split(':')[0]!],
    exclusions: [],
    ceiling: { ...DEFAULT_CEILING, maxRequestsPerMinute: 600, maxTotalRequests: 500 },
    allowPrivateNetworkForTesting: true,
  });

  const measure = async (url: string) => {
    const session = new BrowserSession(guard, new EvidenceStore(url));
    await session.open();
    try {
      // Navigating is the caller's business. `measureDesign` reads the page as
      // it stands, so that in a real run the screenshot already taken is of the
      // same load the measurement describes.
      await session.goto(url, 'networkidle');
      return await measureDesign(session);
    } finally {
      await session.close();
    }
  };

  messy = await measure(page.url);
  coherent = await measure(`${page.url}?fixed=1`);
}, 180_000);

afterAll(async () => {
  await page?.close();
});

describe('counting the pieces', () => {
  it('reads what is rendered, not what the stylesheet declares', () => {
    // A design system with six sizes declared and eleven in use is the case
    // this exists for, and reading the CSS would report six.
    expect(messy.fontSizesPx.length).toBeGreaterThan(9);
    expect(coherent.fontSizesPx.length).toBeLessThanOrEqual(6);
  });

  it('notices spacing chosen by eye', () => {
    // The thing people notice most and name least: it reads as "something is
    // off" rather than as a spacing problem.
    expect(messy.spacingsOnGrid).toBeLessThan(0.5);
    expect(coherent.spacingsOnGrid).toBeGreaterThan(0.8);
  });

  it('notices five button styles where there should be two', () => {
    expect(messy.buttonStyles.length).toBeGreaterThanOrEqual(4);
    expect(coherent.buttonStyles.length).toBeLessThanOrEqual(2);
  });

  it('notices headings that skip a level', () => {
    // Somebody navigating by headings is told a section is nested inside one
    // that does not exist.
    expect(messy.skippedHeadingLevels.length).toBeGreaterThan(0);
    expect(coherent.skippedHeadingLevels).toEqual([]);
  });

  it('finds the text nobody can read, with the arithmetic the contrast gate uses', () => {
    expect(unreadableText(messy).length).toBeGreaterThan(0);
    expect(unreadableText(coherent)).toEqual([]);
  });

  it('finds the placeholder copy that was never replaced', () => {
    expect(messy.placeholderCopy.join(' ')).toMatch(/lorem ipsum/i);
    expect(coherent.placeholderCopy).toEqual([]);
  });

  it('notices blocks that start a few pixels off each other', () => {
    // Three cards whose headings begin at 48, 55 and 63 look ragged, and every
    // one of those numbers was plausible when its card was written.
    expect(messy.edgeMisses.length).toBeGreaterThanOrEqual(2);
    expect(coherent.edgeMisses).toEqual([]);
  });

  it('notices one gap typed three slightly different ways', () => {
    expect(messy.rhythmMisses.length).toBeGreaterThanOrEqual(2);
    expect(coherent.rhythmMisses).toEqual([]);
  });

  it('does not count text that only a screen reader can hear', () => {
    // The hidden paragraph is set to 7px in a colour nothing else uses. Counted,
    // it would give the coherent page a stray type size and unreadable text —
    // which is exactly what it was doing.
    expect(coherent.fontSizesPx).not.toContain(7);
    expect(coherent.textColours.join(' ')).not.toContain('253, 253, 253');
  });

  it('finds a control too small to hit', () => {
    expect(messy.smallTapTargets.length).toBeGreaterThan(0);
    expect(coherent.smallTapTargets).toEqual([]);
  });
});

describe('the same page on a scale', () => {
  it('produces no findings at all', () => {
    // The half that makes the other half mean something.
    expect(designFindings(coherent, ['evidence-1'])).toEqual([]);
  });

  it('is the same content, so nothing was fixed by deleting it', () => {
    expect(coherent.headingCounts.h1).toBe(1);
    expect(Object.values(coherent.headingCounts).reduce((a, b) => a + b, 0)).toBe(
      Object.values(messy.headingCounts).reduce((a, b) => a + b, 0),
    );
  });
});

describe('what the findings are allowed to say', () => {
  const found = () => designFindings(messy, ['evidence-1']);

  it('scores nothing for coherence, because the rubric has no criterion for it', () => {
    // Inventing one would make the score mean something other than what the
    // published rubric says it means.
    for (const finding of found()) {
      if (finding.severity === 'info') {
        expect(finding.description, finding.title).toMatch(/does not affect the score/i);
      }
    }
    expect(found().some((finding) => finding.severity === 'info')).toBe(true);
  });

  it('does score the two things that do have a criterion', () => {
    // Unreadable text and leftover placeholder copy are UX-06, which exists.
    const scored = found().filter((finding) => finding.severity !== 'info');
    expect(scored.map((finding) => finding.ruleId).sort()).toEqual(['UX-04', 'UX-06', 'UX-06']);
  });

  it('cites only rule ids the published rubric defines', () => {
    for (const finding of found()) {
      expect(finding.ruleId, finding.title).toMatch(/^(FI|SEC|PRI|UX|PRD|STR)-\d\d$/);
    }
  });

  it('says nothing about whether the design is good', () => {
    // Taste cannot be evidenced, and an assessment that started handing out
    // opinions on it would be worth less on everything else it says.
    const prose = found()
      .map((f) => `${f.title} ${f.description} ${f.remediation}`)
      .join(' ')
      .toLowerCase();
    for (const word of ['ugly', 'beautiful', 'tasteful', 'elegant', 'dated', 'modern', 'pretty']) {
      expect(prose, word).not.toContain(word);
    }
  });

  it('tells somebody what to do, not only what is wrong', () => {
    // The whole point of an objective eye is that it ends the paralysis rather
    // than adding to it.
    for (const finding of found()) {
      expect(finding.remediation.length, finding.title).toBeGreaterThan(40);
    }
  });
});

describe('close together is not the same as wrong', () => {
  /*
   * The first version of these two checks used a window alone — anything within
   * eight pixels of another value — and running it against our own pages showed
   * what is wrong with that. It reported a block starting at 477px where the
   * page usually starts at 485px. Eight pixels is not a near-miss on a
   * four-pixel scale; it is two steps of it, and somebody chose it.
   *
   * So a difference that is a whole step of the grid is a decision, whatever
   * its size, and only the differences that are not are reported. Without this,
   * the check fires on every page built on a scale, which is every page worth
   * checking.
   */
  it('lets a whole step of the scale alone, however small', () => {
    expect(readRhythm([16, 16, 16, 20, 20, 32, 8]).misses).toEqual([]);
    expect(readAlignment(edges([100, 100, 100, 104, 108, 116, 124])).misses).toEqual([]);
  });

  it('reports a difference that is not a step of the scale', () => {
    const rhythm = readRhythm([16, 16, 16, 18]).misses;
    expect(rhythm.map((miss) => miss.gapPx)).toEqual([18]);
    expect(rhythm[0]?.nearestPx).toBe(16);

    const alignment = readAlignment(edges([100, 100, 100, 100, 106, 108, 116, 124])).misses;
    expect(alignment.map((miss) => miss.edgePx)).toEqual([106]);
    expect(alignment[0]?.nearestPx).toBe(100);
  });

  it('blames the rarer value, so one near-miss is reported once', () => {
    // Otherwise 21 and 24 each accuse the other and one page reads as two
    // problems, which is how a report teaches somebody to stop reading it.
    const misses = readRhythm([24, 24, 24, 24, 21]).misses;
    expect(misses).toHaveLength(1);
    expect(misses[0]).toMatchObject({ gapPx: 21, nearestPx: 24 });
  });

  it('says nothing about a page with too little on it to have a column', () => {
    expect(readAlignment(edges([100, 106])).misses).toEqual([]);
    expect(readAlignment(edges([100, 106])).dominant).toBeNull();
  });

  it('is beside the point on a page with no repeated gap at all', () => {
    // Far apart is a different gap doing a different job, not a botched one.
    expect(readRhythm([8, 40, 96]).misses).toEqual([]);
  });
});

describe('the survey says which width it was looking at', () => {
  /*
   * A page is built at the width its author had open, and a finding somebody
   * cannot reproduce is a finding they will decide is wrong. Our own site had a
   * fifth of its spacing off the grid at phone width and none of it at desktop,
   * which is the whole reason the assessment now runs both.
   */
  it('says so, in a sentence a report can carry', () => {
    const findings = designFindings(messy, ['e'], { at: 'at phone width, 390 pixels across' });
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      if (finding.severity !== 'info') continue;
      expect(finding.description).toContain('Seen at phone width, 390 pixels across.');
    }
  });

  it('says nothing about a width when it was the ordinary one', () => {
    // Every report until now came from one width, and saying "seen at desktop"
    // on all of them would be noise dressed as precision.
    for (const finding of designFindings(messy, ['e'])) {
      expect(finding.description).not.toContain('Seen at');
    }
  });

  it('keeps the titles identical, so the same problem can be recognised at both', () => {
    // The stage reports only what is new at the second width, and it matches on
    // the title. A title that carried the width would never match.
    expect(titles(messy)).toEqual(
      designFindings(messy, ['e'], { at: 'at phone width' }).map((finding) => finding.title),
    );
  });
});

describe('the assessment runs it at both widths', () => {
  const stage = readFileSync(
    join(process.cwd(), 'packages/engine/src/stages/deterministic.ts'),
    'utf8',
  );

  it('reads the page it was given rather than fetching it again', async () => {
    // It used to navigate, and both callers had already loaded the page — so
    // every assessment made two extra full navigations against an intensity
    // ceiling the customer set.
    //
    // The worse half is the evidence. The desktop screenshot is taken before
    // the survey runs and attached to the findings it produces, so a
    // re-navigation meant the picture was of one load and the measurement of
    // the next. On a page with a rotating hero or an experiment those are not
    // the same page, and the whole claim here is that the picture shows what
    // was found.
    const guard = new ScopeGuard({
      allowedHosts: [page.host.split(':')[0]!],
      exclusions: [],
      ceiling: { ...DEFAULT_CEILING, maxRequestsPerMinute: 600, maxTotalRequests: 500 },
      allowPrivateNetworkForTesting: true,
    });
    const session = new BrowserSession(guard, new EvidenceStore('measure-no-fetch'));
    await session.open();
    try {
      await session.goto(page.url, 'networkidle');
      const before = guard.requestsMade;
      await measureDesign(session);
      expect(guard.requestsMade, 'measuring asked the network for nothing').toBe(before);
    } finally {
      await session.close();
    }
  }, 120_000);

  it('surveys the phone viewport as well as the desktop one', () => {
    expect(stage).toMatch(/measureDesign\(session\)[\s\S]*measureDesign\(session\)/);
    expect(stage).toContain('at phone width, 390 pixels across');
  });

  it('reports only what the first pass did not already say', () => {
    // A page with nine type sizes has nine at both widths, and saying so twice
    // is how a report teaches somebody to stop reading it.
    expect(stage).toContain('designTitles.has(finding.title)');
  });

  it('attaches the evidence from the width it was looking at', () => {
    expect(stage).toMatch(/designFindings\(mobileDesign, \[mobileShot\]/);
  });
});
