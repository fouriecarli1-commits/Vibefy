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
      return await measureGame(session, url);
    } finally {
      await session.close();
    }
  };

  shipped = await measure(game.url);
  fixed = await measure(`${game.url}?fixed=1`);
}, 180_000);

const measureVariant = async (variant: string): Promise<GameMeasurements> => {
  const guard = new ScopeGuard({
    allowedHosts: [game.host.split(':')[0]!],
    exclusions: [],
    ceiling: { ...DEFAULT_CEILING, maxRequestsPerMinute: 600, maxTotalRequests: 500 },
    allowPrivateNetworkForTesting: true,
  });
  const session = new BrowserSession(guard, new EvidenceStore(`game-${variant}`));
  await session.open();
  try {
    return await measureGame(session, `${game.url}?variant=${variant}`);
  } finally {
    await session.close();
  }
};

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
    // PRD-06 since rubric 1.1.0: time and weight before something is usable
    // is a measurement, and PRD-01 is a Lighthouse performance band.
    expect(ruleIdsOf(shipped)).toContain('PRD-06');
  });

  it('sees that no finger can play it', () => {
    // Read before any input is synthesised. Playwright installs touchstart and
    // pointerdown of its own the moment it dispatches, and reading afterwards
    // measured the harness.
    expect(shipped.listenerTypes).toEqual(['keydown', 'keyup']);
    expect(shipped.acceptsTouch).toBe(false);
    // FI-08 since 1.1.0. UX-02 is about a layout fitting a narrow screen;
    // this is about an input method the device does not have.
    expect(ruleIdsOf(shipped)).toContain('FI-08');
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

describe('a game whose loop is a setInterval', () => {
  let timer: GameMeasurements;

  beforeAll(async () => {
    timer = await measureVariant('timer');
  }, 120_000);

  it('is not accused of never having started', () => {
    // The definition of playable is requestAnimationFrame, and a great many
    // games never call it. Saying "the game never started" about one of those
    // is a critical finding raised against a game that is plainly running.
    expect(timer.becamePlayable).toBe(false);
    expect(timer.loopSignal).toBe('timer');
    expect(ruleIdsOf(timer)).not.toContain('FI-01');
  });

  it('is played and measured like any other running game', () => {
    // It listens for keydown and nothing touch-shaped, and that is a real
    // finding about it. Withholding everything would have been the other way
    // of getting this wrong.
    expect(timer.listenerTypes).toContain('keydown');
    expect(ruleIdsOf(timer)).toContain('FI-08');
  });

  it('says which figures do not exist for it rather than inventing them', () => {
    expect(timer.timeToPlayableMs).toBeNull();
    expect(ruleIdsOf(timer)).not.toContain('PRD-06');
    expect(timer.limitations.join(' ')).toMatch(/never called requestAnimationFrame/i);
  });
});

describe('a game that throws while it loads', () => {
  let thrower: GameMeasurements;

  beforeAll(async () => {
    thrower = await measureVariant('throws-on-load');
  }, 120_000);

  it('is not reported as throwing while it is played', () => {
    // The measurement reloads the page to see what survived in storage. The
    // window for "errors during play" used to close after that reload, so this
    // page's load error arrived as an error that appeared after play began —
    // which is the one thing that finding promises it is not.
    expect(thrower.becamePlayable).toBe(true);
    expect(thrower.errorsDuringPlay).toEqual([]);
    expect(ruleIdsOf(thrower)).not.toContain('PRD-02');
  });
});

describe('a measurement that did not happen', () => {
  // Built by hand rather than measured: what is under test is what the findings
  // do with a reading that failed, and a failed reading is not something a
  // fixture can be relied on to produce.
  const running: GameMeasurements = {
    networkProfile: 'a mid-range 4G connection (4 Mbps down, 150 ms latency)',
    becamePlayable: true,
    loopSignal: 'animation_frames',
    timeToPlayableMs: 1_200,
    bytesBeforePlayable: 40_000,
    framesDuringPlay: 120,
    listenerTypes: ['keydown', 'pointerdown'],
    acceptsTouch: true,
    pausesWhenHidden: true,
    persistedKeysAfterReload: ['best'],
    wroteOnlyToSessionStorage: false,
    errorsDuringPlay: [],
    limitations: [],
  };

  it('does not accuse a game of being unplayable by touch when the listeners could not be read', () => {
    // A failed read used to arrive as an empty list, which is indistinguishable
    // from a game that listens for nothing — and produced a high-severity
    // finding from a measurement that never happened.
    const unread = { ...running, listenerTypes: null, acceptsTouch: null };
    expect(ruleIdsOf(unread)).not.toContain('FI-08');
  });

  it('says nothing at all about a page that stopped answering', () => {
    const lost: GameMeasurements = {
      ...running,
      becamePlayable: false,
      loopSignal: 'unknown',
      timeToPlayableMs: null,
      acceptsTouch: null,
      listenerTypes: null,
      pausesWhenHidden: null,
    };
    expect(gameFindings(lost, ['evidence-1'])).toEqual([]);
  });

  it('withholds the weight figures measured over a connection it could not declare', () => {
    const unthrottled = {
      ...running,
      networkProfile: 'an unthrottled connection',
      bytesBeforePlayable: 900_000,
      timeToPlayableMs: 9_000,
    };
    expect(ruleIdsOf(unthrottled)).not.toContain('PRD-06');
  });

  it('charges a heavy slow start once rather than twice', () => {
    // Nothing in the rubric collapses two findings that share a rule id, so a
    // game that was both slow and heavy — which is one fact — had production
    // readiness taken down for it twice.
    const heavyAndSlow = { ...running, bytesBeforePlayable: 900_000, timeToPlayableMs: 9_000 };
    const prd06 = gameFindings(heavyAndSlow, ['evidence-1']).filter(
      (finding) => finding.ruleId === 'PRD-06',
    );
    expect(prd06).toHaveLength(1);
    expect(prd06[0]?.description).toMatch(/879 KB/);
    expect(prd06[0]?.description).toMatch(/9\.0 seconds/);
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
    const weight = findings().find((finding) => finding.ruleId === 'PRD-06');
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
