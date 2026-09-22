/**
 * The rate ceiling is a speed limit, not a boundary.
 *
 * It exists so that an assessment does not look like an attack in somebody's
 * logs. It was a fixed window of sixty a minute, which is the wrong shape for
 * what a browser does: sixty requests and then fifty-eight seconds of nothing.
 * An ordinary page asks for eighty things at once, so a fifth of it was
 * refused — and the accessibility scan, the design survey, the screenshots and
 * the check at phone width all then described a page this engine had broken,
 * under a note telling the customer their own authorisation boundary had done
 * it.
 *
 * It is now a bucket that holds a minute's worth and refills continuously,
 * which is what a real visitor's browser looks like: a burst on arrival, then
 * a trickle.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BrowserSession } from '../packages/engine/src/runtime/browser.ts';
import { EvidenceStore } from '../packages/engine/src/runtime/evidence.ts';
import { ScopedHttp } from '../packages/engine/src/runtime/http.ts';
import {
  DEFAULT_CEILING,
  ScopeGuard,
  waitForRateSlot,
} from '../packages/engine/src/runtime/scope.ts';

let server: Server;
let base: string;

/** Enough images that a sixty-a-minute window could never have served them. */
const IMAGES = 80;

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url?.startsWith('/img')) {
      response.writeHead(200, { 'content-type': 'image/svg+xml' });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(
      `<!doctype html><html lang="en"><head><title>Busy</title></head><body>${Array.from(
        { length: IMAGES },
        (_, index) => `<img src="/img${index}.svg" alt="">`,
      ).join('')}</body></html>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

const guardAt = (perMinute: number) =>
  new ScopeGuard({
    allowedHosts: ['127.0.0.1'],
    exclusions: [],
    ceiling: { ...DEFAULT_CEILING, maxRequestsPerMinute: perMinute },
    allowPrivateNetworkForTesting: true,
  });

describe('the ceiling a new authorisation carries', () => {
  it('is above what one page load asks for', () => {
    // The figure this whole file is about. Sixty was below it, so every
    // assessment of an ordinary page measured a page with holes in it.
    expect(DEFAULT_CEILING.maxRequestsPerMinute).toBeGreaterThan(IMAGES + 1);
  });

  it('still permits nothing destructive', () => {
    // Going harder means looking at more of an application, not doing more to
    // it. These are the part of the ceiling that does not move.
    expect(DEFAULT_CEILING.nonDestructiveOnly).toBe(true);
    expect(DEFAULT_CEILING.allowDataModification).toBe(false);
    expect(DEFAULT_CEILING.allowDataExport).toBe(false);
    expect(DEFAULT_CEILING.syntheticAccountsOnly).toBe(true);
  });

  it('refuses a destructive method whatever the ceiling says', () => {
    const guard = guardAt(240);
    for (const method of ['DELETE', 'PUT', 'PATCH']) {
      expect(guard.check('https://example.test/thing', method).reason).toBe('destructive_method');
    }
  });
});

describe('a page that asks for eighty things at once', () => {
  it('gets all of them, because that is what a visitor’s browser does', async () => {
    const guard = guardAt(DEFAULT_CEILING.maxRequestsPerMinute);
    const session = new BrowserSession(guard, new EvidenceStore('rate'));
    await session.open();
    try {
      await session.goto(base, 'networkidle');
      expect(
        session.blockedRequests.filter((blocked) => blocked.reason === 'rate_limited'),
        'the page was throttled and the throttled requests were dropped',
      ).toEqual([]);
      const broken = await session.page.evaluate(
        () => [...document.querySelectorAll('img')].filter((img) => img.naturalWidth === 0).length,
      );
      expect(broken, 'images the engine itself prevented from loading').toBe(0);
    } finally {
      await session.close();
    }
  }, 180_000);

  it('settles to the sustained rate once the burst is spent', async () => {
    // The bucket holds a minute's worth, not an unlimited allowance. Spend it
    // and the next request waits for a refill — hundreds of milliseconds,
    // which is a wait a navigation survives, rather than the minute a fixed
    // window made everybody wait.
    const guard = guardAt(120);
    for (let request = 0; request < 120; request += 1) {
      expect(guard.check(`${base}img${request}.svg`, 'GET').allowed).toBe(true);
    }
    expect(guard.check(`${base}img121.svg`, 'GET').reason).toBe('rate_limited');
    const wait = guard.msUntilSlot();
    expect(wait).toBeGreaterThan(0);
    expect(wait, 'a refill at two a second').toBeLessThan(1_000);
  });
});

describe('a sequence that is merely going too fast', () => {
  it('waits for a refill rather than raising the scope boundary', async () => {
    // It used to throw a ScopeViolationError, which `classifyStop` reads as one
    // of the three deliberate stops — so a run that was going too fast aborted
    // and told the customer it had been turned back at the edge of what they
    // had authorised.
    const guard = guardAt(120);
    for (let request = 0; request < 120; request += 1) {
      guard.check(`${base}img${request}.svg`, 'GET');
    }
    const http = new ScopedHttp(guard, new EvidenceStore('rate-http'));
    const started = Date.now();
    const next = await http.request(`${base}img0.svg`, { keepBody: false });
    expect(next.status).toBe(200);
    expect(Date.now() - started).toBeGreaterThan(100);
    expect(guard.waitedForRateMs).toBeGreaterThan(0);
  }, 60_000);

  it('does not wait longer than a navigation would tolerate', async () => {
    // At one a minute a refill takes a minute, and a navigation held that long
    // fails altogether. Past the cap it does not wait at all, and the caller
    // gets an honest refusal.
    const guard = guardAt(1);
    guard.check(`${base}img0.svg`, 'GET');
    const started = Date.now();
    const waited = await waitForRateSlot(guard);
    expect(waited).toBe(0);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(guard.check(`${base}img1.svg`, 'GET').reason).toBe('rate_limited');
  });
});

describe('what the stage says about it', () => {
  it('does not call our own throttle the customer’s boundary', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('packages/engine/src/stages/deterministic.ts', 'utf8');
    expect(source).toMatch(/That is ours, not the application's/);
    expect(source).toMatch(/waitedForRateMs/);
  });
});
