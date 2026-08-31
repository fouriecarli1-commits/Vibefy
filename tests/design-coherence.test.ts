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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserSession } from '../packages/engine/src/runtime/browser.ts';
import { EvidenceStore } from '../packages/engine/src/runtime/evidence.ts';
import { DEFAULT_CEILING, ScopeGuard } from '../packages/engine/src/runtime/scope.ts';
import {
  designFindings,
  measureDesign,
  unreadableText,
  type DesignMeasurements,
} from '../packages/engine/src/stages/design-checks.ts';
import { startIncoherentPage, type PageFixture } from './fixtures/incoherent-page.ts';

let page: PageFixture;
let messy: DesignMeasurements;
let coherent: DesignMeasurements;

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
      return await measureDesign(session, url);
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
