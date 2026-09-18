/**
 * How hard is it to leave?
 *
 * Anré's idea, and the best question nobody rates. Every review of every
 * subscription tells you how good it is to join; the thing that actually costs
 * people money is the other end.
 *
 * The fixture pair is the whole test. Neither site does anything unusual — the
 * hard one puts the subscribe button on the home page, the cancel route three
 * pages in behind "Manage your membership", and an email address at the end of
 * it. That is a series of ordinary decisions that add up to an exit nobody
 * finds, which is exactly what this has to be able to tell apart from a company
 * that simply put the link somewhere sensible.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ScopedHttp } from '../packages/engine/src/runtime/http.ts';
import { DEFAULT_CEILING, ScopeGuard } from '../packages/engine/src/runtime/scope.ts';
import { EvidenceStore } from '../packages/engine/src/runtime/evidence.ts';
import { crawlForTheExit, type ExitCrawl } from '../packages/engine/src/stages/exit-checks.ts';
import {
  EXIT_LEGEND,
  EXIT_WEIGHTS,
  scoreExit,
  type ExitSignals,
} from '../packages/trustcheck/src/exit.ts';
import { startSubscriptionSite, type SubscriptionFixture } from './fixtures/subscription-site.ts';

let site: SubscriptionFixture;
let hard: ExitCrawl;
let fair: ExitCrawl;

beforeAll(async () => {
  site = await startSubscriptionSite();
  const walk = async (url: string) => {
    const guard = new ScopeGuard({
      allowedHosts: [site.host.split(':')[0]!],
      exclusions: [],
      ceiling: { ...DEFAULT_CEILING, maxRequestsPerMinute: 600, maxTotalRequests: 400 },
      allowPrivateNetworkForTesting: true,
    });
    return crawlForTheExit(new ScopedHttp(guard, new EvidenceStore(url)), url);
  };
  hard = await walk(site.url);
  fair = await walk(`${site.url}?fair=1`);
}, 180_000);

afterAll(async () => {
  await site?.close();
});

describe('walking to the exit', () => {
  it('follows a euphemism instead of stopping at it', () => {
    // The first version latched onto the first link that matched, so a "Manage
    // your membership" three pages from the real exit fixed both the answer and
    // the click count at the euphemism — and scored the site as better than it
    // is. A euphemism is a lead, not a destination.
    expect(hard.cancelUrl).toMatch(/\/account\/settings\/membership/);
    expect(hard.clicksToCancel).toBe(3);
  });

  it('does not mistake a page that mentions cancelling for the page that offers it', () => {
    // The other half of the same bug, in the other direction: a home page that
    // links to "Cancel your subscription" was read as the exit itself, which
    // scored a well-behaved site at zero clicks and then judged it not
    // self-service because a home page has no form on it.
    expect(fair.cancelUrl).toMatch(/\/cancel/);
    expect(fair.clicksToCancel).toBe(1);
    expect(fair.selfService).toBe(true);
  });

  it('reads self-service from the page that offers it, not from the link', () => {
    expect(hard.selfService).toBe(false);
    expect(fair.selfService).toBe(true);
  });

  it('notices what the route is called', () => {
    expect(hard.plainlyNamed).toBe(false);
    expect(fair.plainlyNamed).toBe(true);
  });

  it('stays bounded, because a crawl is the easiest way to look like an attack', () => {
    expect(hard.pagesVisited).toBeLessThanOrEqual(25);
    expect(fair.pagesVisited).toBeLessThanOrEqual(25);
  });
});

describe('the number', () => {
  it('separates an ordinary site from a fair one', () => {
    const hardScore = scoreExit(hard);
    const fairScore = scoreExit(fair);
    expect(fairScore.percentage).toBe(100);
    expect(fairScore.band).toBe('Easy');
    expect(hardScore.percentage).toBeLessThan(60);
    expect(hardScore.band).toBe('Hard');
  });

  it('is made of weights that add to a hundred and are published', () => {
    // A weighting nobody can read is a rating nobody should believe.
    const total = Object.values(EXIT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
  });

  it('shows its working, component by component', () => {
    const score = scoreExit(hard);
    expect(score.components).toHaveLength(4);
    for (const component of score.components) {
      expect(component.detail.length, component.id).toBeGreaterThan(20);
      expect(component.earned).toBeLessThanOrEqual(component.weight);
    }
    expect(score.components.reduce((a, c) => a + c.earned, 0)).toBe(score.percentage);
  });

  it('forgives one extra click and not four', () => {
    // A subscribe button on the home page and a cancel link in the account area
    // is ordinary, not a dark pattern. Nobody puts the exit four pages further
    // away by accident.
    const base: ExitSignals = {
      routeFound: true,
      selfService: true,
      plainlyNamed: true,
      clicksToSubscribe: 1,
      clicksToCancel: 2,
    };
    expect(scoreExit(base).percentage).toBe(100);
    expect(scoreExit({ ...base, clicksToCancel: 3 }).percentage).toBeLessThan(100);
    expect(scoreExit({ ...base, clicksToCancel: 5 }).percentage).toBe(80);
  });

  it('scores nothing at all when no route was found', () => {
    const nothing = scoreExit({
      routeFound: false,
      selfService: false,
      plainlyNamed: false,
      clicksToCancel: null,
      clicksToSubscribe: 1,
    });
    expect(nothing.percentage).toBe(0);
    expect(nothing.band).toBe('No route found');
    // And says it might be behind a sign-in rather than concluding there is none.
    expect(nothing.components[0]!.detail).toMatch(/behind a sign-in/i);
  });
});

describe('what the number is not', () => {
  it('says it is not part of the rubric and moves no badge', () => {
    expect(EXIT_LEGEND).toMatch(/not part of the VibefyCode rubric/i);
    expect(EXIT_LEGEND).toMatch(/does not affect any score or badge/i);
  });

  it('says we walk to the exit and stop before going through it', () => {
    // Whether a cancellation is honoured cannot be observed from outside
    // without cancelling somebody's subscription, and that is not ours to do.
    expect(EXIT_LEGEND).toMatch(/stop before going through it/i);
    expect(EXIT_LEGEND).toMatch(/can still be operated badly/i);
  });

  it('never presses the button', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('packages/engine/src/stages/exit-checks.ts', 'utf8');
    // Read-only throughout: the crawl issues no POST, and the scope guard would
    // refuse one in any case.
    expect(source).not.toMatch(/method:\s*'POST'/);
    expect(source).toMatch(/walks to the exit and stops/i);
  });
});
