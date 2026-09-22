/**
 * What the scoped client stores, how long it waits, and what it calls a stop.
 *
 * Three things that were true of every assessment and visible in none of them:
 * an option that was declared, passed and never read; a size cap that bounded
 * what the runner holds and nothing about how long it holds it; and an
 * application's own redirect loop filed as the scope boundary refusing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EvidenceStore } from '../packages/engine/src/runtime/evidence.ts';
import { ScopedHttp, TooManyRedirectsError } from '../packages/engine/src/runtime/http.ts';
import { classifyStop } from '../packages/engine/src/runtime/stop.ts';
import { DEFAULT_CEILING, ScopeGuard } from '../packages/engine/src/runtime/scope.ts';

let server: Server;
let base: string;
/** Held open so the dribbling response can be closed at the end of the run. */
const openResponses: (() => void)[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url?.startsWith('/loop')) {
      response.writeHead(302, { location: '/loop' });
      response.end();
      return;
    }
    if (request.url?.startsWith('/dribble')) {
      // Headers at once, body never. The shape of a target that holds a
      // connection open rather than refusing it.
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.write('start');
      openResponses.push(() => response.end());
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><html lang="en"><body><p>A page with a body.</p></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const close of openResponses) close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

/** The artefact's body, which is stored as JSON in a Buffer. */
const storedBody = (evidence: EvidenceStore, id: string) =>
  JSON.parse(evidence.byId(id)!.body.toString('utf8')) as {
    response: {
      bodyPreview: string | null;
      bodyRetained: boolean;
      bodyLength: number;
      status: number;
    };
  };

const clientWith = (evidence: EvidenceStore) =>
  new ScopedHttp(
    new ScopeGuard({
      allowedHosts: ['127.0.0.1'],
      exclusions: [],
      ceiling: { ...DEFAULT_CEILING, maxRequestsPerMinute: 600, maxTotalRequests: 400 },
      allowPrivateNetworkForTesting: true,
    }),
    evidence,
  );

describe('what is kept', () => {
  it('keeps the body when nothing says otherwise', async () => {
    const evidence = new EvidenceStore('http-keep');
    const response = await clientWith(evidence).request(`${base}/`, { summary: 'A page' });
    const stored = storedBody(evidence, response.evidenceId);
    expect(stored.response.bodyPreview).toMatch(/A page with a body/);
  });

  it('leaves the body out when the caller says so, and still records the exchange', async () => {
    // The option existed, was passed at two call sites with a comment
    // explaining the cost, and was read nowhere: every page of every crawl was
    // stored in full, for ninety days.
    const evidence = new EvidenceStore('http-drop');
    const response = await clientWith(evidence).request(`${base}/`, {
      summary: 'A page in a crawl',
      keepBody: false,
    });
    const stored = storedBody(evidence, response.evidenceId);
    expect(stored.response.bodyPreview).toBeNull();
    expect(stored.response.bodyRetained).toBe(false);
    // Still a record of what was asked for and what came back.
    expect(stored.response.status).toBe(200);
    // And the caller still gets the body it asked for; it is simply not stored.
    expect(response.body).toMatch(/A page with a body/);
  });
});

describe('a target that redirects to itself', () => {
  it('is the application’s defect, not the scope boundary refusing', async () => {
    // Raised as a ScopeViolationError, it was one of the three deliberate
    // stops: the run aborted and the customer was told it had been turned back
    // at the edge of what they authorised, for a redirect loop in their own
    // application.
    const error = await clientWith(new EvidenceStore('http-loop'))
      .request(`${base}/loop`)
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect(error).toBeInstanceOf(TooManyRedirectsError);
    expect(classifyStop(error)).toBeNull();
  });
});

describe('a body that never finishes arriving', () => {
  it('is given up on rather than waited out', async () => {
    // The size cap bounds what the runner holds. Until the timer covered the
    // read as well as the headers, nothing bounded how long it holds the
    // runner: a target could answer at once and then send one byte a minute.
    const started = Date.now();
    await expect(
      clientWith(new EvidenceStore('http-dribble')).request(`${base}/dribble`),
    ).rejects.toThrow(/still arriving/i);
    expect(Date.now() - started).toBeLessThan(40_000);
  }, 60_000);
});
