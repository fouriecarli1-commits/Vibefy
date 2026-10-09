/**
 * "The game keeps running when the tab is hidden" — measured against nothing.
 *
 * `measureGame` reads the loop counters twice: once at the end of play, as a
 * baseline, and once while the page has been told it is hidden. Whether the
 * game paused is `running(after) - before < 10`, and `false` publishes PRD-05
 * at `confidence: 'high'` with the sentence "On somebody else's phone that is
 * battery being spent on a tab they are not looking at."
 *
 * The second read was guarded — `after === null` sets the answer to null and
 * says so in `limitations`. The first was `(await readCounters(page)) ?? {
 * frames: 0, ticks: 0 }`, so a page that had stopped answering became a game
 * that drew nothing, and `before` became zero. A page that recovered in time
 * for the second read then failed the comparison and got the finding.
 *
 * Forty lines above that read, in the same file, is the comment saying why this
 * is not allowed: "A page that has stopped answering is not a game that never
 * started, and the difference between those two is a critical finding against
 * somebody else's application."
 *
 * The counter reader is injected so the case can be arranged without a race:
 * answer null once, then answer normally. That is the shape the defect needs
 * and the only shape a fixture cannot produce reliably.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserSession } from '../packages/engine/src/runtime/browser.ts';
import { EvidenceStore } from '../packages/engine/src/runtime/evidence.ts';
import { DEFAULT_CEILING, ScopeGuard } from '../packages/engine/src/runtime/scope.ts';
import {
  gameFindings,
  measureGame,
  type CounterReader,
  type GameMeasurements,
} from '../packages/engine/src/stages/game-checks.ts';
import { startFlawedGame, type GameFixture } from './fixtures/flawed-game.ts';

let game: GameFixture;

beforeAll(async () => {
  game = await startFlawedGame();
}, 180_000);

afterAll(async () => {
  await game?.close();
});

async function measure(reader?: CounterReader): Promise<GameMeasurements> {
  const guard = new ScopeGuard({
    allowedHosts: [game.host.split(':')[0]!],
    exclusions: [],
    ceiling: { ...DEFAULT_CEILING, maxRequestsPerMinute: 600, maxTotalRequests: 500 },
    allowPrivateNetworkForTesting: true,
  });
  const session = new BrowserSession(guard, new EvidenceStore('baseline'));
  await session.open();
  try {
    return reader
      ? await measureGame(session, game.url, reader)
      : await measureGame(session, game.url);
  } finally {
    await session.close();
  }
}

/** Null the first time it is asked, honest afterwards. */
function silentOnce(): CounterReader {
  let asked = 0;
  return async (page) => {
    asked += 1;
    if (asked === 1) return null;
    return page
      .evaluate(
        () =>
          (window as unknown as { __vibefyGame?: { frames: number; ticks: number } })
            .__vibefyGame ?? { frames: 0, ticks: 0 },
      )
      .catch(() => null);
  };
}

describe('a baseline that would not read', () => {
  let measurements: GameMeasurements;

  beforeAll(async () => {
    measurements = await measure(silentOnce());
  }, 180_000);

  it('does not become a game that drew nothing', () => {
    expect(measurements.framesDuringPlay).toBeNull();
  });

  it('leaves the pause question unanswered rather than answering it wrongly', () => {
    // Null, not false. Only `false` is an accusation, and there was nothing to
    // compare the second reading against.
    expect(measurements.pausesWhenHidden).toBeNull();
  });

  it('publishes no finding about the tab being hidden', () => {
    const ruleIds = gameFindings(measurements, ['evidence-1']).map((finding) => finding.ruleId);
    const titles = gameFindings(measurements, ['evidence-1']).map((finding) => finding.title);
    expect(titles).not.toContain('The game keeps running when the tab is hidden');
    // Anchored: the pass still reports on this application, so the absence
    // above is about this one question rather than about a run that did nothing.
    expect(ruleIds.length).toBeGreaterThan(0);
  });

  it('says what it could not establish, in the words the report uses', () => {
    expect(measurements.limitations.join(' ')).toMatch(
      /stopped answering when the loop counters were read/i,
    );
  });
});

describe('a baseline that read normally', () => {
  it('still answers the question', async () => {
    // The half that makes the other half mean something. A measurement that
    // refused whenever it was unsure would never report a flawed game, and the
    // fixture is a flawed game on purpose.
    const measurements = await measure();
    expect(measurements.framesDuringPlay).not.toBeNull();
    expect(measurements.pausesWhenHidden).not.toBeNull();
  }, 180_000);
});
