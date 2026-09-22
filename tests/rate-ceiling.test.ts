/**
 * The rate ceiling is a speed limit, not a boundary.
 *
 * It exists so that an assessment does not look like an attack in somebody's
 * logs, and the authorisation's default is sixty requests a minute. An ordinary
 * page loads more than that in a couple of seconds — so the guard was dropping
 * a fifth of a page's own images, and the accessibility scan, the design
 * survey, the screenshots and the check at phone width all then described a
 * page this engine had broken. The note beneath them told the customer their
 * own authorisation boundary had done it.
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

/** Enough images that a sixty-a-minute ceiling cannot serve them all at once. */
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

describe('a page that asks for more at once than the ceiling permits', () => {
  it('still loads, and what was dropped is dropped by us and said so', async () => {
    // A burst cannot be smoothed: sixty a minute means the sixty-first request
    // in a rush waits the better part of a minute, and a navigation held that
    // long fails altogether — which is worse than a page missing an image. So
    // the page loads, some of it is dropped, and the only thing that must not
    // happen is calling that the customer's own boundary.
    const guard = guardAt(60);
    const session = new BrowserSession(guard, new EvidenceStore('rate'));
    await session.open();
    try {
      await session.goto(base, 'networkidle');
      const dropped = session.blockedRequests.filter(
        (blocked) => blocked.reason === 'rate_limited',
      );
      expect(dropped.length, 'the ceiling is below what this page asks for').toBeGreaterThan(0);
      // Every one of them is ours. Nothing here was out of scope.
      expect(
        session.blockedRequests.filter((blocked) => blocked.reason !== 'rate_limited'),
      ).toEqual([]);
    } finally {
      await session.close();
    }
  }, 180_000);
});

describe('a sequence that is merely going too fast', () => {
  it('waits for the window rather than raising the scope boundary', async () => {
    // Seeded with two requests made fifty-nine seconds ago, so the window frees
    // in about a second and the wait is a real one rather than a minute of test.
    const guard = guardAt(2);
    const past = Date.now() - 59_000;
    guard.check(`${base}img0.svg`, 'GET', past);
    guard.check(`${base}img1.svg`, 'GET', past);
    expect(guard.msUntilSlot()).toBeLessThan(2_000);

    const http = new ScopedHttp(guard, new EvidenceStore('rate-http'));
    const started = Date.now();
    // This used to throw a ScopeViolationError, which `classifyStop` reads as
    // one of the three deliberate stops — so a run that was going too fast
    // aborted and told the customer it had been turned back at the edge of
    // what they had authorised.
    const third = await http.request(`${base}img2.svg`, { keepBody: false });
    expect(third.status).toBe(200);
    expect(Date.now() - started).toBeGreaterThan(200);
    expect(guard.waitedForRateMs).toBeGreaterThan(0);
  }, 60_000);

  it('does not wait longer than a navigation would tolerate', async () => {
    // A burst needs the better part of a minute, and a browser navigation held
    // that long fails altogether. Past the cap it does not wait at all, and the
    // caller gets an honest refusal.
    const guard = guardAt(2);
    guard.check(`${base}img0.svg`, 'GET');
    guard.check(`${base}img1.svg`, 'GET');
    const started = Date.now();
    const waited = await waitForRateSlot(guard);
    expect(waited).toBe(0);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(guard.check(`${base}img2.svg`, 'GET').reason).toBe('rate_limited');
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
