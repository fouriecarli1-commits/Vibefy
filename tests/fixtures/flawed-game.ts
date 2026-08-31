/**
 * A real, playable game — with the defects games actually ship with.
 *
 * The other fixture is a shop that leaks a key. This one is a game, and it is
 * genuinely playable: a canvas, a loop, arrow keys, a block that falls, a score
 * that goes up. It has to be real, because what is being tested is whether the
 * engine can hold a running canvas game long enough to say anything true about
 * it — and a mock canvas would answer that question by agreeing with us.
 *
 * Five defects, each one common in a game built quickly and each one invisible
 * to the checks that were already here:
 *
 *   1. It blocks on a large asset before it starts. The author never noticed:
 *      their browser cached it on the first run.
 *   2. Arrow keys and nothing else. No touch, no pointer, and no message saying
 *      the phone somebody opened it on will not work.
 *   3. The high score is written to `sessionStorage`, so it disappears the
 *      moment the tab closes — which the author reads as "it saves", because
 *      they tested with a refresh rather than a new tab.
 *   4. The loop keeps running at full rate when the tab is hidden.
 *   5. A console error that only appears after several inputs.
 *
 * `?fixed=1` serves the same game with all five corrected, so the checks can be
 * shown to distinguish rather than merely to complain.
 *
 * Bound to loopback only, like every fixture here.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface GameFixture {
  readonly url: string;
  readonly host: string;
  close(): Promise<void>;
}

/**
 * The asset that blocks the start.
 *
 * Roughly 900 KB of generated sprite data, fetched and awaited before the first
 * frame — the shape of a real game that ships an uncompressed atlas and starts
 * only once it has arrived.
 */
const SPRITE_BYTES = 900_000;

function page(fixed: boolean): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
${fixed ? '<meta name="viewport" content="width=device-width, initial-scale=1">' : ''}
<title>Block Dodge</title>
<style>
  html, body { margin: 0; background: #10131a; color: #e8eaf0; font-family: system-ui, sans-serif; }
  #wrap { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px; }
  canvas { background: #1b2030; border-radius: 8px; touch-action: none; ${fixed ? 'max-width: 100%; height: auto;' : ''} }
  #hud { font-variant-numeric: tabular-nums; }
  #boot { padding: 24px; }
</style>
</head>
<body>
<div id="wrap">
  <h1>Block Dodge</h1>
  <div id="boot">Loading…</div>
  <div id="hud" hidden>Score <span id="score">0</span> · Best <span id="best">0</span></div>
  <canvas id="game" width="480" height="640" hidden></canvas>
  ${fixed ? '<p id="hint">Arrow keys, or drag on the canvas.</p>' : ''}
</div>
<script>
(function () {
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var hud = document.getElementById('hud');
  var boot = document.getElementById('boot');
  var scoreEl = document.getElementById('score');
  var bestEl = document.getElementById('best');

  var player = { x: 216, y: 580, w: 48, h: 16 };
  var blocks = [];
  var score = 0;
  var inputs = 0;
  var running = false;
  var left = false, right = false;
  var store = ${fixed ? 'window.localStorage' : 'window.sessionStorage'};
  var best = Number(store.getItem('block-dodge-best') || 0);
  bestEl.textContent = String(best);

  function spawn() {
    blocks.push({ x: Math.random() * (canvas.width - 32), y: -32, w: 32, h: 32, v: 12 + Math.random() * 4 });
  }

  function step() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (left) player.x = Math.max(0, player.x - 6);
    if (right) player.x = Math.min(canvas.width - player.w, player.x + 6);

    if (Math.random() < 0.25) spawn();
    for (var i = blocks.length - 1; i >= 0; i--) {
      var b = blocks[i];
      b.y += b.v;
      ctx.fillStyle = '#5b8def';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      if (b.y > canvas.height) { blocks.splice(i, 1); score += 1; }
    }
    ctx.fillStyle = '#f2c14e';
    ctx.fillRect(player.x, player.y, player.w, player.h);
    scoreEl.textContent = String(score);
    if (score > best) { best = score; store.setItem('block-dodge-best', String(best)); bestEl.textContent = String(best); }

    ${
      fixed
        ? 'if (running) requestAnimationFrame(step);'
        : '// Nothing checks whether anybody is looking.\n    requestAnimationFrame(step);'
    }
  }

  function move(dir, down) {
    inputs += 1;
    if (dir === 'left') left = down; else right = down;
    ${
      fixed
        ? ''
        : `// A typo that only fires once somebody has actually played for a bit,
    // which is why it survives every test the author ran.
    if (inputs === 6) { window.__missingHelper.recordCombo(inputs); }`
    }
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') move('left', true);
    if (e.key === 'ArrowRight') move('right', true);
  });
  document.addEventListener('keyup', function (e) {
    if (e.key === 'ArrowLeft') move('left', false);
    if (e.key === 'ArrowRight') move('right', false);
  });

  ${
    fixed
      ? `canvas.addEventListener('pointerdown', function (e) { drag(e); });
  canvas.addEventListener('pointermove', function (e) { if (e.buttons) drag(e); });
  function drag(e) {
    var rect = canvas.getBoundingClientRect();
    var x = (e.clientX - rect.left) * (canvas.width / rect.width);
    player.x = Math.max(0, Math.min(canvas.width - player.w, x - player.w / 2));
    inputs += 1;
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { running = false; }
    else if (!running) { running = true; requestAnimationFrame(step); }
  });`
      : '// No pointer or touch handling at all.'
  }

  function start() {
    boot.hidden = true;
    hud.hidden = false;
    canvas.hidden = false;
    running = true;
    requestAnimationFrame(step);
  }

  ${
    fixed
      ? `// Playable first; the atlas arrives behind it.
  start();
  fetch('/sprites.bin').then(function (r) { return r.arrayBuffer(); });`
      : `// The atlas, awaited before the first frame.
  fetch('/sprites.bin').then(function (r) { return r.arrayBuffer(); }).then(start);`
  }
})();
</script>
</body>
</html>`;
}

export async function startFlawedGame(): Promise<GameFixture> {
  const sprites = Buffer.alloc(SPRITE_BYTES, 7);

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');

    if (url.pathname === '/sprites.bin') {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(sprites.length),
        // Uncached on purpose: the point of the check is what a first-time
        // visitor downloads, which is not what the author's browser does.
        'cache-control': 'no-store',
      });
      response.end(sprites);
      return;
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      const body = page(url.searchParams.get('fixed') === '1');
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(body);
      return;
    }

    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/`,
    host: `127.0.0.1:${port}`,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
