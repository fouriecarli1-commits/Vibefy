/**
 * How much of an application is actually looked at, and how.
 *
 * Anré asked for maximum service, which for an assessment means looking at
 * more — not doing more. So this holds both halves in place: the list of
 * exposures probed is wide enough to be worth paying for, and every request it
 * makes is a single non-destructive GET against a host the customer has
 * verified they control.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import {
  CostMeter,
  DEFAULT_CEILING,
  EvidenceStore,
  ScopeGuard,
  deterministicChecksStage,
  type StageContext,
  type StageResult,
} from '../packages/engine/src/index.ts';

let server: Server;
let result: StageResult;
const asked: { path: string; method: string }[] = [];

/** Three things a real deployment leaves served, and nothing else. */
const SERVED: Record<string, string> = {
  '/': '<!doctype html><html lang="en"><head><title>Kettle</title></head><body><h1>Kettle</h1></body></html>',
  '/.env.production': 'STRIPE_SECRET_KEY=sk_live_notarealkey\n',
  '/actuator/env': '{"activeProfiles":["production"],"propertySources":[]}',
  '/backup.sql': "INSERT INTO users VALUES (1, 'a@b.test');\n",
};

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    asked.push({ path, method: request.method ?? 'GET' });
    const body = SERVED[path];
    if (body === undefined) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

  const context: StageContext = {
    assessmentId: 'assessment-probe',
    depth: 'full',
    guard: new ScopeGuard({
      allowedHosts: ['127.0.0.1'],
      exclusions: [],
      ceiling: { ...DEFAULT_CEILING },
      allowPrivateNetworkForTesting: true,
    }),
    meter: new CostMeter({ maxRunCostUsd: 1 }),
    evidence: new EvidenceStore('assessment-probe'),
    model: null as never,
    log: () => undefined,
    target: {
      appId: 'app-probe',
      organisationId: 'org-probe',
      appName: 'Kettle',
      appType: 'web_url',
      primaryUrl: url,
      repositoryPath: null,
      intendedForAppStore: false,
      isGame: false,
      hasAuthentication: true,
      hasPayments: true,
      processesPersonalData: true,
      description: 'A shop that sells kettles.',
    },
  };
  result = await deterministicChecksStage.run(context);
}, 180_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

describe('what it finds', () => {
  const titles = () => result.findings.map((finding) => finding.title).join(' | ');

  it('reads the production environment file that was left served', () => {
    // The single most common serious defect in this class of application, and
    // `/.env.production` was not on the list until somebody asked for more.
    expect(titles()).toMatch(/Production environment file is publicly readable/);
  });

  it('reads the framework endpoint that describes the inside of the system', () => {
    expect(titles()).toMatch(/Spring actuator environment is exposed/i);
  });

  it('reads the database dump', () => {
    expect(titles()).toMatch(/database dump is publicly readable/i);
  });

  it('says nothing about the thirty paths that were not served', () => {
    // A check that complains about everything is indistinguishable from one
    // that is broken. Every other probe came back 404 and produced nothing.
    const exposures = result.findings.filter((finding) => finding.ruleId === 'SEC-08');
    expect(exposures.length).toBe(3);
  });
});

describe('how it asks', () => {
  it('asks for each path exactly once', () => {
    // Nothing here enumerates or fuzzes. Each probe is one specific file that a
    // build pipeline or a framework default leaves served.
    // The front door is excepted: it is loaded over HTTP, then in a browser,
    // then walked from by the crawl, which is three different examinations of
    // the same page rather than the same question asked three times.
    const counts = new Map<string, number>();
    for (const request of asked) {
      if (request.path === '/') continue;
      counts.set(request.path, (counts.get(request.path) ?? 0) + 1);
    }
    const repeated = [...counts].filter(([, count]) => count > 1).map(([path]) => path);
    expect(repeated).toEqual([]);
  });

  it('never uses a method that changes anything', () => {
    for (const request of asked) {
      expect(['GET', 'HEAD', 'OPTIONS'], request.path).toContain(request.method);
    }
  });

  it('stays well inside a single minute of the rate ceiling', () => {
    // The whole list costs about four seconds of the ceiling a new
    // authorisation carries. It is a wider look, not a heavier one.
    expect(asked.length).toBeLessThan(DEFAULT_CEILING.maxRequestsPerMinute);
  });
});

describe('the list itself', () => {
  const source = readFileSync('packages/engine/src/stages/deterministic.ts', 'utf8');
  const paths = [
    ...source
      .slice(source.indexOf('const EXPOSED_PATHS'), source.indexOf('const ADMIN_PATHS'))
      .matchAll(/path: '([^']+)'/g),
  ].map((match) => match[1]!);

  it('is wide enough to be worth paying for', () => {
    expect(paths.length).toBeGreaterThanOrEqual(25);
  });

  it('names specific files rather than patterns to walk', () => {
    // A path with a wildcard or a placeholder in it is an enumeration, and an
    // enumeration is the thing this product must never look like.
    for (const path of paths) {
      expect(path, path).not.toMatch(/[*?{}]|\.\./);
      expect(path.startsWith('/'), path).toBe(true);
    }
  });
});
