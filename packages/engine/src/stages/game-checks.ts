/**
 * Deterministic checks for a game.
 *
 * Everything here is measured rather than judged, which matters more for games
 * than for anything else this engine looks at. "The game feels sluggish" is an
 * opinion nobody can act on or dispute. "It drew its first frame 4.1 seconds
 * after navigation, having downloaded 927 KB to get there" is a fact with a
 * number attached, and the person who wrote the game can go and change it.
 *
 * The hard part is deciding what *playable* means without knowing anything
 * about the game. The definition used here is deliberately narrow and stated in
 * every finding it produces: **the moment the page began drawing animation
 * frames continuously**. A game that has painted five consecutive frames is
 * running its loop. It might still be showing a title card — so this is a lower
 * bound on time-to-playable, never an upper one, and nothing here claims
 * otherwise.
 *
 * The instrumentation is installed before the page's own script runs, and it
 * only counts and records. It does not stub the game's world or change what the
 * game can do.
 */
import type { BrowserSession } from '../runtime/browser.ts';
import type { RawFinding, StageContext } from './types.ts';

/** Consecutive frames that mean the loop is running rather than stuttering. */
const FRAMES_FOR_PLAYABLE = 5;
/** How long to wait for that to happen before calling it a failure to start. */
const PLAYABLE_TIMEOUT_MS = 20_000;
/** How long to play for, once it is playable. */
const PLAY_MS = 2_000;

/**
 * The connection every game is measured on.
 *
 * Without this the number is meaningless, and it took running the checks to see
 * why: on a fast link a game that blocks on a 900 KB atlas and a game that does
 * not both become playable in about a quarter of a second, because the atlas
 * arrives before the first frame either way. The measurement was reporting the
 * assessor's bandwidth.
 *
 * So it is declared, fixed, and stated in every finding it produces: roughly a
 * mid-range 4G connection. Two consequences worth being explicit about — the
 * figures are not what a visitor on fibre would see, and they are the same
 * figures whether this runs in Frankfurt or Cape Town, which is the property
 * that makes two assessments comparable at all.
 */
const NETWORK_PROFILE = {
  label: 'a mid-range 4G connection (4 Mbps down, 150 ms latency)',
  downloadThroughputBytesPerSecond: (4 * 1_000_000) / 8,
  uploadThroughputBytesPerSecond: (1 * 1_000_000) / 8,
  latencyMs: 150,
} as const;

/** Above this, the download before play is worth a finding of its own. */
const HEAVY_START_BYTES = 500_000;
/** Above this, the wait before play is worth a finding of its own. */
const SLOW_START_MS = 5_000;

export interface GameMeasurements {
  /** The connection these figures were measured on, for the report to state. */
  readonly networkProfile: string;
  readonly becamePlayable: boolean;
  readonly timeToPlayableMs: number | null;
  readonly bytesBeforePlayable: number;
  readonly framesDuringPlay: number;
  readonly listenerTypes: readonly string[];
  readonly acceptsTouch: boolean;
  readonly pausesWhenHidden: boolean | null;
  readonly persistedKeysAfterReload: readonly string[];
  readonly wroteOnlyToSessionStorage: boolean;
  readonly errorsDuringPlay: readonly string[];
}

/** Counts frames and records which event types the game actually listens for. */
const INSTRUMENTATION = `(() => {
  const state = { frames: 0, firstFrameAt: null, listeners: {}, hidden: false };
  window.__vibefyGame = state;

  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) =>
    raf((time) => {
      state.frames += 1;
      if (state.firstFrameAt === null) state.firstFrameAt = performance.now();
      return callback(time);
    });

  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, ...rest) {
    state.listeners[type] = (state.listeners[type] || 0) + 1;
    return add.call(this, type, ...rest);
  };

  // So the page can be told it is in the background without actually
  // backgrounding it — Chromium throttles a genuinely hidden tab itself, and
  // what is being measured is whether the *game* stops, not whether the browser
  // stopped it.
  Object.defineProperty(document, 'hidden', { get: () => state.hidden });
  Object.defineProperty(document, 'visibilityState', {
    get: () => (state.hidden ? 'hidden' : 'visible'),
  });
})();`;

const TOUCH_EVENTS = ['touchstart', 'touchmove', 'pointerdown', 'pointermove', 'click'];

/**
 * Opens the game, plays it briefly, and writes down what happened.
 *
 * The session must be open and must not have navigated yet: the instrumentation
 * has to be installed before the game's own script runs.
 */
export async function measureGame(
  context: StageContext,
  session: BrowserSession,
  url: string,
): Promise<GameMeasurements> {
  const page = session.page;
  await page.addInitScript(INSTRUMENTATION);

  // Every response, with when it finished, so "before playable" is a fact about
  // this load rather than an estimate.
  //
  // The timestamp is taken when the response finishes, not when `sizes()`
  // resolves — that resolves a moment later, and on a throttled link it landed
  // after the first frame and put a 900 KB atlas on the wrong side of the line,
  // reporting 3 KB. The promises are awaited before anything is totalled.
  const transfers: Promise<{ at: number; bytes: number } | null>[] = [];
  page.on('requestfinished', (request) => {
    const at = Date.now();
    transfers.push(
      request
        .sizes()
        .then((sizes) => ({ at, bytes: sizes.responseBodySize }))
        .catch(() => null),
    );
  });

  // Throttled through the DevTools protocol, because a number measured on an
  // unthrottled link is a number about our datacentre.
  let throttled = false;
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: NETWORK_PROFILE.latencyMs,
      downloadThroughput: NETWORK_PROFILE.downloadThroughputBytesPerSecond,
      uploadThroughput: NETWORK_PROFILE.uploadThroughputBytesPerSecond,
    });
    throttled = true;
  } catch {
    // Only Chromium offers this. Rather than silently reporting figures from a
    // different connection than the one the finding names, the measurements say
    // so and the findings that depend on it are withheld.
    throttled = false;
  }

  const navigatedAt = Date.now();
  await session.goto(url, 'domcontentloaded');

  let playableAt: number | null = null;
  while (Date.now() - navigatedAt < PLAYABLE_TIMEOUT_MS) {
    const frames = await page
      .evaluate(
        () =>
          (window as unknown as { __vibefyGame?: { frames: number } }).__vibefyGame?.frames ?? 0,
      )
      .catch(() => 0);
    if (frames >= FRAMES_FOR_PLAYABLE) {
      // The page's own timestamp, not the moment this poll noticed. Polling
      // every 200 ms over a link with no latency put the whole download on the
      // wrong side of the line.
      const firstFrameAt = await page
        .evaluate(
          () =>
            (window as unknown as { __vibefyGame?: { firstFrameAt: number | null } }).__vibefyGame
              ?.firstFrameAt ?? null,
        )
        .catch(() => null);
      const navigationStart = await page
        .evaluate(() => performance.timeOrigin)
        .catch(() => navigatedAt);
      playableAt = firstFrameAt === null ? Date.now() : Math.round(navigationStart + firstFrameAt);
      break;
    }
    await page.waitForTimeout(200);
  }

  const errorsBefore = session.pageErrors.length;

  /*
   * Which events the game listens for, read *before* any input is synthesised.
   *
   * Found by running this against a real keyboard-only game and having it
   * report that touch was supported. Playwright installs its own listeners —
   * touchstart, pointerdown, click and a marker called
   * `__playwright_global_listeners_check__` — the moment it dispatches input,
   * so reading the list afterwards measures the harness rather than the game.
   * The most dangerous kind of wrong answer: a false clean bill on the defect
   * that keeps a game off the phone most of its players will open it on.
   */
  const listenerTypes = await page
    .evaluate(() =>
      Object.keys(
        (window as unknown as { __vibefyGame?: { listeners: Record<string, number> } }).__vibefyGame
          ?.listeners ?? {},
      ),
    )
    .catch(() => [] as string[]);

  // Play. Arrow keys and a drag across the canvas, because a game that only
  // answers one of those is exactly what this is looking for.
  if (playableAt !== null) {
    for (let press = 0; press < 8; press += 1) {
      await page.keyboard.down(press % 2 === 0 ? 'ArrowLeft' : 'ArrowRight');
      await page.waitForTimeout(60);
      await page.keyboard.up(press % 2 === 0 ? 'ArrowLeft' : 'ArrowRight');
    }
    const canvas = await page.$('canvas');
    if (canvas) {
      const box = await canvas.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.8);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.8, { steps: 8 });
        await page.mouse.up();
      }
    }
    await page.waitForTimeout(PLAY_MS);
  }

  const played = await page
    .evaluate(
      () =>
        (window as unknown as { __vibefyGame?: { frames: number } }).__vibefyGame ?? { frames: 0 },
    )
    .catch(() => ({ frames: 0 }));

  // Does it stop when the document says nobody is looking?
  let pausesWhenHidden: boolean | null = null;
  if (playableAt !== null) {
    const before = played.frames;
    await page.evaluate(() => {
      const state = (window as unknown as { __vibefyGame: { hidden: boolean } }).__vibefyGame;
      state.hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(700);
    const after = await page
      .evaluate(
        () =>
          (window as unknown as { __vibefyGame?: { frames: number } }).__vibefyGame?.frames ?? 0,
      )
      .catch(() => before);
    // A handful of frames may land between dispatching the event and the game
    // acting on it; a game that has genuinely stopped does not add dozens.
    pausesWhenHidden = after - before < 10;
    await page.evaluate(() => {
      const state = (window as unknown as { __vibefyGame: { hidden: boolean } }).__vibefyGame;
      state.hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }

  const storageBefore = await page
    .evaluate(() => ({
      local: Object.keys(window.localStorage),
      session: Object.keys(window.sessionStorage),
    }))
    .catch(() => ({ local: [] as string[], session: [] as string[] }));

  await session.goto(url, 'domcontentloaded');
  const storageAfter = await page
    .evaluate(() => Object.keys(window.localStorage))
    .catch(() => [] as string[]);

  const errorsDuringPlay = session.pageErrors.slice(errorsBefore);
  const settled = (await Promise.all(transfers)).filter(
    (transfer): transfer is { at: number; bytes: number } => transfer !== null,
  );

  return {
    networkProfile: throttled ? NETWORK_PROFILE.label : 'an unthrottled connection',
    becamePlayable: playableAt !== null,
    timeToPlayableMs: playableAt === null ? null : playableAt - navigatedAt,
    bytesBeforePlayable: settled
      .filter((transfer) => playableAt === null || transfer.at <= playableAt)
      .reduce((total, transfer) => total + transfer.bytes, 0),
    framesDuringPlay: played.frames,
    listenerTypes,
    acceptsTouch: listenerTypes.some((type) => TOUCH_EVENTS.includes(type)),
    pausesWhenHidden,
    persistedKeysAfterReload: storageAfter,
    wroteOnlyToSessionStorage: storageBefore.session.length > 0 && storageBefore.local.length === 0,
    errorsDuringPlay,
  };
}

/**
 * The measurements, as findings against the published rubric.
 *
 * No rule id is invented. A game that never becomes playable fails the
 * criterion about a primary journey completing, because for a game that *is*
 * the primary journey — and inventing GAME-01 would produce a score nobody can
 * check against the rubric it claims to come from.
 */
export function gameFindings(
  measurements: GameMeasurements,
  evidenceIds: readonly string[],
): RawFinding[] {
  const findings: RawFinding[] = [];
  const evidence = [...evidenceIds];

  if (!measurements.becamePlayable) {
    findings.push({
      ruleId: 'FI-01',
      dimension: 'functional_integrity',
      severity: 'critical',
      confidence: 'high',
      title: 'The game never started',
      description: `The page loaded but never drew ${FRAMES_FOR_PLAYABLE} consecutive animation frames within ${PLAYABLE_TIMEOUT_MS / 1000} seconds, so it never reached a state where playing was possible. This is measured as the moment the page begins drawing frames continuously; it is a lower bound on becoming playable, and it was never reached at all.`,
      remediation:
        'Open the game in a browser with an empty cache and the network throttled, and watch what it waits for. A loading step that never resolves is the usual cause.',
      evidenceIds: evidence,
    });
    return findings;
  }

  // Both of the weight findings depend on the declared connection. Without it
  // the figures describe the assessor's bandwidth, and a finding whose number
  // means nothing is worse than no finding.
  const weighable = measurements.networkProfile !== 'an unthrottled connection';

  if (weighable && (measurements.timeToPlayableMs ?? 0) > SLOW_START_MS) {
    findings.push({
      ruleId: 'PRD-01',
      dimension: 'production_readiness',
      severity: 'medium',
      confidence: 'high',
      title: 'The game takes a long time to become playable',
      description: `It began drawing frames ${((measurements.timeToPlayableMs ?? 0) / 1000).toFixed(1)} seconds after navigation, having transferred ${Math.round(measurements.bytesBeforePlayable / 1024)} KB to get there. Measured with an empty cache over ${measurements.networkProfile} — an empty cache is what a first-time visitor gets and is not what the author's own browser does.`,
      remediation:
        'Draw something playable before the largest assets arrive, or load them in the background after the first frame.',
      evidenceIds: evidence,
    });
  }

  if (weighable && measurements.bytesBeforePlayable > HEAVY_START_BYTES) {
    findings.push({
      ruleId: 'PRD-01',
      dimension: 'production_readiness',
      severity: 'medium',
      confidence: 'high',
      title: 'A large download blocks the start of the game',
      description: `${Math.round(measurements.bytesBeforePlayable / 1024)} KB was transferred before the first frame, measured over ${measurements.networkProfile}. On a mobile connection that is the difference between somebody playing and somebody closing the tab.`,
      remediation:
        'Compress the blocking assets, or split them so that only what the first screen needs is awaited.',
      evidenceIds: evidence,
    });
  }

  if (!measurements.acceptsTouch) {
    findings.push({
      ruleId: 'UX-02',
      dimension: 'practicality_ux',
      severity: 'high',
      confidence: 'high',
      title: 'The game cannot be played by touch',
      description: `Across a full session the page registered listeners for ${measurements.listenerTypes.join(', ') || 'nothing'} and none of them was a touch or pointer event. Most people who open a link to a game open it on a phone, where this game cannot be played at all. Being desktop-only is a legitimate choice; being desktop-only and saying nothing is what this reports.`,
      remediation:
        'Add pointer or touch controls, or state on the page that a keyboard is required before somebody arrives without one.',
      evidenceIds: evidence,
    });
  }

  if (measurements.pausesWhenHidden === false) {
    findings.push({
      ruleId: 'PRD-05',
      dimension: 'production_readiness',
      severity: 'low',
      confidence: 'high',
      title: 'The game keeps running when the tab is hidden',
      description:
        'With the document reporting itself as hidden, the animation loop continued at full rate. On somebody else’s phone that is battery being spent on a tab they are not looking at.',
      remediation:
        'Stop the loop on `visibilitychange` when `document.hidden` is true, and restart it when the tab returns.',
      evidenceIds: evidence,
    });
  }

  if (measurements.wroteOnlyToSessionStorage) {
    findings.push({
      ruleId: 'FI-07',
      dimension: 'functional_integrity',
      severity: 'medium',
      confidence: 'medium',
      title: 'Progress is kept only for the life of the tab',
      description:
        'During play the game wrote to `sessionStorage` and to nothing more durable, so whatever it is keeping — a score, a level, a save — disappears when the tab closes. A refresh preserves it, which is why this survives the testing an author usually does.',
      remediation:
        'Write anything meant to outlive the session to `localStorage` or to a server, and confirm it by closing the tab rather than by refreshing.',
      evidenceIds: evidence,
    });
  }

  if (measurements.errorsDuringPlay.length > 0) {
    findings.push({
      ruleId: 'PRD-02',
      dimension: 'production_readiness',
      severity: 'medium',
      confidence: 'high',
      title: 'The game throws errors while it is being played',
      description: `${measurements.errorsDuringPlay.length} uncaught error${measurements.errorsDuringPlay.length === 1 ? '' : 's'} appeared after play began, not on load: ${measurements.errorsDuringPlay.slice(0, 3).join(' · ')}. Errors that only appear after several inputs are the ones that survive an author's own testing and reach players.`,
      remediation: 'Play for longer than it takes to see the first screen, with the console open.',
      evidenceIds: evidence,
    });
  }

  return findings;
}
