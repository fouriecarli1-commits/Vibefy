/**
 * A real game, actually played.
 *
 * Anré asked for a game to be sent through the pipeline, and this is that run
 * held in place. `tests/fixtures/flawed-game.ts` is a genuinely playable canvas
 * game — a loop, arrow keys, falling blocks, a score — carrying five defects
 * that games built quickly actually ship with. `?fixed=1` is the same game with
 * all five corrected.
 *
 * The pair is the point. A check that only ever complains is indistinguishable
 * from a check that is broken, so every defect has to be found in one and
 * absent from the other.
 *
 * Three things in the checks were wrong until this run existed, and each is the
 * kind of wrong that a unit test written from the same assumptions would have
 * agreed with:
 *
 *   · Touch support was read after synthesising input, so Playwright's own
 *     listeners made a keyboard-only game look playable on a phone — a false
 *     clean bill on the defect that matters most.
 *   · Bytes-before-playable was measured on an unthrottled link, where a game
 *     that blocks on 900 KB and one that does not both start in a quarter of a
 *     second. It was reporting our bandwidth.
 *   · The byte totals were stamped when the size lookup resolved rather than
 *     when the response finished, putting the whole download on the wrong side
 *     of the line and reporting 3 KB out of 900.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserSession } from '../packages/engine/src/runtime/browser.ts';
import { EvidenceStore } from '../packages/engine/src/runtime/evidence.ts';
import { DEFAULT_CEILING, ScopeGuard } from '../packages/engine/src/runtime/scope.ts';
import {
  gameFindings,
  measureGame,
  type GameMeasurements,
} from '../packages/engine/src/stages/game-checks.ts';
import type { StageContext } from '../packages/engine/src/stages/types.ts';
import { startFlawedGame, type GameFixture } from './fixtures/flawed-game.ts';

let game: GameFixture;
let shipped: GameMeasurements;
let fixed: GameMeasurements;

const ruleIdsOf = (measurements: GameMeasurements) =>
  gameFindings(measurements, ['evidence-1']).map((finding) => finding.ruleId);

beforeAll(async () => {
  game = await startFlawedGame();
  const guard = new ScopeGuard({
    allowedHosts: [game.host.split(':')[0]!],
    exclusions: [],
    ceiling: { ...DEFAULT_CEILING, maxRequestsPerMinute: 600, maxTotalRequests: 500 },
    allowPrivateNetworkForTesting: true,
  });

  const measure = async (url: string) => {
    const session = new BrowserSession(guard, new EvidenceStore(`game-${url}`));
    await session.open();
    try {
      return await measureGame(
        { target: { isGame: true } } as unknown as StageContext,
        session,
        url,
      );
    } finally {
      await session.close();
    }
  };

  shipped = await measure(game.url);
  fixed = await measure(`${game.url}?fixed=1`);
}, 180_000);

afterAll(async () => {
  await game?.close();
});

describe('the game was really played', () => {
  it('reached a state where it was drawing frames', () => {
    expect(shipped.becamePlayable).toBe(true);
    expect(shipped.framesDuringPlay).toBeGreaterThan(60);
  });

  it('measured over a declared connection rather than whatever ours happens to be', () => {
    // Two assessments of the same game are only comparable if they were taken
    // on the same connection. Without this the figure describes our datacentre.
    expect(shipped.networkProfile).toMatch(/4G/);
    expect(shipped.networkProfile).not.toMatch(/unthrottled/);
  });
});

describe('the five defects, found', () => {
  it('sees the download that blocks the start', () => {
    expect(shipped.bytesBeforePlayable).toBeGreaterThan(500_000);
    expect(ruleIdsOf(shipped)).toContain('PRD-01');
  });

  it('sees that no finger can play it', () => {
    // Read before any input is synthesised. Playwright installs touchstart and
    // pointerdown of its own the moment it dispatches, and reading afterwards
    // measured the harness.
    expect(shipped.listenerTypes).toEqual(['keydown', 'keyup']);
    expect(shipped.acceptsTouch).toBe(false);
    expect(ruleIdsOf(shipped)).toContain('UX-02');
  });

  it('sees the loop still running when nobody is looking', () => {
    expect(shipped.pausesWhenHidden).toBe(false);
    expect(ruleIdsOf(shipped)).toContain('PRD-05');
  });

  it('sees that the score dies with the tab', () => {
    expect(shipped.wroteOnlyToSessionStorage).toBe(true);
    expect(ruleIdsOf(shipped)).toContain('FI-07');
  });

  it('sees the error that only appears after several inputs', () => {
    expect(shipped.errorsDuringPlay.length).toBeGreaterThan(0);
    expect(ruleIdsOf(shipped)).toContain('PRD-02');
  });
});

describe('the same game with the five fixed', () => {
  it('starts without waiting for the atlas', () => {
    expect(fixed.bytesBeforePlayable).toBeLessThan(500_000);
    expect(fixed.timeToPlayableMs).toBeLessThan(shipped.timeToPlayableMs!);
  });

  it('takes touch, pauses when hidden, keeps its score and throws nothing', () => {
    expect(fixed.acceptsTouch).toBe(true);
    expect(fixed.pausesWhenHidden).toBe(true);
    expect(fixed.persistedKeysAfterReload).toContain('block-dodge-best');
    expect(fixed.errorsDuringPlay).toEqual([]);
  });

  it('produces no findings at all', () => {
    // The half that makes the other half mean something: a check that only ever
    // complains is indistinguishable from a check that is broken.
    expect(gameFindings(fixed, ['evidence-1'])).toEqual([]);
  });
});

describe('what the findings are allowed to say', () => {
  // Built inside each test rather than at collection time: `shipped` is
  // measured in beforeAll, which has not run while the suite is being defined.
  const findings = () => gameFindings(shipped, ['evidence-1']);

  it('cites only rule ids the published rubric defines', () => {
    // A report citing GAME-01 against a rubric that does not define it is a
    // score nobody can check against the thing it claims to come from.
    for (const finding of findings()) {
      expect(finding.ruleId, finding.title).toMatch(/^(FI|SEC|PRI|UX|PRD|STR)-\d\d$/);
    }
  });

  it('carries the connection into the text, because the number is meaningless without it', () => {
    const weight = findings().find((finding) => finding.ruleId === 'PRD-01');
    expect(weight?.description).toMatch(/4G/);
  });

  it('says nothing about whether the game is any good', () => {
    const prose = findings()
      .map((f) => `${f.title} ${f.description} ${f.remediation}`)
      .join(' ');
    for (const word of ['fun', 'boring', 'original', 'beautiful', 'addictive', 'polished']) {
      expect(prose.toLowerCase(), word).not.toContain(word);
    }
  });

  it('attaches evidence to every one of them', () => {
    for (const finding of findings()) expect(finding.evidenceIds.length).toBeGreaterThan(0);
  });
});
