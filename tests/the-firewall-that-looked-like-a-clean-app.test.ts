/**
 * A host that drops the scanner's requests looks exactly like one with nothing
 * to find.
 *
 * `ScopedHttp.probe` returns null for "the path is not served", and the comment
 * above it already settles the principle for one case: a ceiling reaching this
 * path "used to come back from here as null, which the caller reads as 'nothing
 * is exposed at /.env' — a clean security posture reported from a probe that was
 * never sent." The three deliberate stops were made to throw. The network case
 * was left, and it is the one a customer's own defences produce.
 *
 * Measured on 2026-10-09 against a host that serves its root and destroys every
 * other socket — which is what a web application firewall does to anything
 * asking for `.env`, `.git` or `.DS_Store`:
 *
 *   · the root loaded, HTTP 200, so the stage carried on;
 *   · every probe came back null, reading as "not served";
 *   · nothing anywhere recorded it.
 *
 * No SEC-08 findings and no note. The better defended the application, the
 * quieter the scan, and the report said twelve paths were looked at and nothing
 * was found.
 *
 * The null stays, because "not served" is the right default for a finding: the
 * alternative is accusing somebody on a probe that never landed. What is added
 * is that it is written down, so the stage can say the question was not asked
 * instead of letting silence answer it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ScopedHttp } from '../packages/engine/src/runtime/http.ts';
import { EvidenceStore } from '../packages/engine/src/runtime/evidence.ts';
import { CostMeter } from '../packages/engine/src/runtime/cost.ts';
import { DEFAULT_CEILING, ScopeGuard } from '../packages/engine/src/runtime/scope.ts';
import { deterministicChecksStage } from '../packages/engine/src/stages/deterministic.ts';
import type { StageContext, StageResult } from '../packages/engine/src/stages/types.ts';

let hostile: Server;
let hostileUrl: string;
let honest: Server;
let honestUrl: string;

const PAGE =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Kettle</title></head>' +
  '<body><h1>Kettle</h1></body></html>';

beforeAll(async () => {
  // Serves its front page, hangs up on everything else.
  hostile = createServer((request, response) => {
    if (request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(PAGE);
      return;
    }
    request.socket.destroy();
  });
  await new Promise<void>((resolve) => hostile.listen(0, '127.0.0.1', resolve));
  hostileUrl = `http://127.0.0.1:${(hostile.address() as AddressInfo).port}`;

  // Answers everything, with a 404 where there is nothing. A refusal is an
  // answer, and this is the half that makes the other half mean something.
  honest = createServer((request, response) => {
    if (request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(PAGE);
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not here');
  });
  await new Promise<void>((resolve) => honest.listen(0, '127.0.0.1', resolve));
  honestUrl = `http://127.0.0.1:${(honest.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => hostile?.close(() => resolve()));
  await new Promise<void>((resolve) => honest?.close(() => resolve()));
});

function client(): ScopedHttp {
  return new ScopedHttp(
    new ScopeGuard({
      allowedHosts: ['127.0.0.1'],
      exclusions: [],
      ceiling: { ...DEFAULT_CEILING, maxRequestsPerMinute: 600, maxTotalRequests: 400 },
      allowPrivateNetworkForTesting: true,
    }),
    new EvidenceStore('firewall'),
  );
}

describe('a host that will not answer a probe', () => {
  it('still returns null, because accusing on a probe that never landed is worse', async () => {
    const http = client();
    expect(await http.probe(hostileUrl, '/.env')).toBeNull();
  }, 60_000);

  it('writes down that it got no answer, with the path and the reason', async () => {
    const http = client();
    // The front page answers, which is what makes this the dangerous shape:
    // the stage carries on and every probe behind it comes back empty.
    const root = await http.request(hostileUrl, { summary: 'root' });
    expect(root.status).toBe(200);

    await http.probe(hostileUrl, '/.env');
    await http.probe(hostileUrl, '/.git/config');

    expect(http.unanswered.map((probe) => probe.path)).toEqual(['/.env', '/.git/config']);
    // The reason, because "it returned nothing" and "the socket died" send
    // whoever reads it to different places.
    expect(http.unanswered[0]!.why).toBeTruthy();
  }, 60_000);
});

describe('a host that answers', () => {
  it('records nothing, because a 404 is an answer', async () => {
    const http = client();
    const response = await http.probe(honestUrl, '/.env');
    // A refusal comes back through the success path: a status, not an exception.
    expect(response).not.toBeNull();
    expect(response!.status).toBe(404);
    expect(http.unanswered).toEqual([]);
  }, 60_000);

  it('records nothing for a path that really is not served', async () => {
    // The distinction the whole change is about. This host says 404 and means
    // it; the other one says nothing and means nothing.
    const http = client();
    await http.probe(honestUrl, '/.DS_Store');
    await http.probe(honestUrl, '/.git/config');
    expect(http.unanswered).toEqual([]);
  }, 60_000);
});

describe('what the stage says about it', () => {
  async function runAgainst(url: string): Promise<StageResult> {
    const context: StageContext = {
      assessmentId: 'assessment-firewall',
      depth: 'full',
      guard: new ScopeGuard({
        allowedHosts: ['127.0.0.1'],
        exclusions: [],
        ceiling: { ...DEFAULT_CEILING, maxRequestsPerMinute: 600, maxTotalRequests: 400 },
        allowPrivateNetworkForTesting: true,
      }),
      meter: new CostMeter({ maxRunCostUsd: 1 }),
      evidence: new EvidenceStore('assessment-firewall'),
      model: null as never,
      log: () => undefined,
      target: {
        appId: 'app-firewall',
        organisationId: 'org-firewall',
        appName: 'Kettle',
        appType: 'web_url',
        primaryUrl: url,
        repositoryPath: null,
        intendedForAppStore: false,
        isGame: false,
        hasAuthentication: false,
        hasPayments: false,
        processesPersonalData: false,
        description: 'A shop that sells kettles.',
      },
    };
    return deterministicChecksStage.run(context);
  }

  it('reports SEC-08 as not tested rather than letting the silence tick', async () => {
    const result = await runAgainst(hostileUrl);
    // The premise: no findings against it, which is what used to be the whole
    // story and read downstream as a pass.
    expect(result.findings.filter((finding) => finding.ruleId === 'SEC-08')).toHaveLength(0);

    const entry = result.notTested?.find((candidate) => candidate.criterion === 'SEC-08');
    expect(
      entry,
      'every request for a commonly exposed file got no answer, no finding was filed, and ' +
        'nothing said so — so the criterion reads as a pass for twelve paths nobody established',
    ).toBeDefined();
    expect(entry?.because).toMatch(/refused every one of/i);
    // The sentence that matters to whoever reads the report: this looks the
    // same from outside as an application with nothing to find.
    expect(entry?.because).toMatch(/looks identical/i);
  }, 240_000);

  it('says nothing of the kind about a host that answers', async () => {
    const result = await runAgainst(honestUrl);
    expect(result.notTested?.find((candidate) => candidate.criterion === 'SEC-08')).toBeUndefined();
    // Anchored: the stage really ran against this host, so the absence above is
    // about this one criterion and not about a stage that did nothing.
    expect(result.findings.length + (result.notes?.length ?? 0)).toBeGreaterThan(0);
  }, 240_000);
});
