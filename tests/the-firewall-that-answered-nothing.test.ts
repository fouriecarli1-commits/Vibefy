/**
 * A host that drops a scanner's requests, and what we say about it.
 *
 * `deterministic.ts` reasons this out in full, forty lines above where it stops
 * doing it: "a host that serves its root and destroys every other socket is
 * what a web application firewall does to anything asking for `.env` or
 * `.git`, and every one of those probes comes back null. No findings, and until
 * now no note either: the better defended the application, the quieter this
 * scan." SEC-08 is reported as not tested, with three sentences for the three
 * ways nothing was established.
 *
 * Three probes further down the same function never asked.
 *
 *   · **The administrative routes.** All of them dropped means no finding and
 *     no note, so SEC-05 reads as checked and clean on an application nobody
 *     could look at. The catch-all case beside it was handled; this one was not.
 *   · **`/robots.txt`.** A dropped request produced "No robots.txt was served",
 *     which is a statement about the application we did not establish.
 *   · **`/.well-known/security.txt`.** The same, in a report somebody pays for.
 *     The comment above those two probes says "a flattering untruth in a report
 *     somebody pays for is still an untruth" about the opposite case — a
 *     catch-all crediting an owner with files they may not have — and the
 *     unflattering untruth was sitting in the same `if`.
 *
 * The fixture is the one shape that produces all of it: a server that answers
 * its front page and destroys the socket for everything else.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CostMeter,
  DEFAULT_CEILING,
  EvidenceStore,
  ScopeGuard,
  deterministicChecksStage,
  type StageResult,
} from '../packages/engine/src/index.ts';

async function firewalledApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const { createServer } = await import('node:http');
  const server = createServer((request, response) => {
    if (request.url === '/' || request.url === '') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(
        '<!doctype html><html lang="en"><head><title>Kettle</title>' +
          '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
          '</head><body><h1>Kettle</h1><p>We sell kettles.</p></body></html>',
      );
      return;
    }
    // What a firewall does to a request for `.env`: no refusal, no response.
    request.socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function runAgainst(url: string): Promise<StageResult> {
  return deterministicChecksStage.run({
    assessmentId: 'assessment-firewalled',
    depth: 'full',
    guard: new ScopeGuard({
      allowedHosts: ['127.0.0.1'],
      exclusions: [],
      ceiling: { ...DEFAULT_CEILING, maxRequestsPerMinute: 600 },
      // A loopback fixture. `tests/engine-scope.test.ts` asserts that a policy
      // built from a real authorisation record cannot set this.
      allowPrivateNetworkForTesting: true,
    }),
    meter: new CostMeter({ maxRunCostUsd: 1 }),
    evidence: new EvidenceStore('assessment-firewalled'),
    model: null as never,
    log: () => undefined,
    target: {
      appId: 'app-firewalled',
      organisationId: 'org-fixture',
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
  });
}

describe('an application whose host drops everything but the front page', () => {
  let result: StageResult;

  it('runs the stage against it', async () => {
    const fixture = await firewalledApp();
    try {
      result = await runAgainst(fixture.url);
    } finally {
      await fixture.close();
    }
    // The front page answered, so the HTTP half did its job and the stage is
    // not empty. What follows is about what it says.
    expect(result).toBeDefined();
  }, 120_000);

  const notTestedFor = (criterion: string) =>
    (result.notTested ?? []).filter((entry) => entry.criterion === criterion);

  it('reports the exposed-file criterion as not tested, which it already did', () => {
    // The control: this is the 2026-10-09 fix, and it is what the three below
    // are being held to.
    expect(notTestedFor('SEC-08')).toHaveLength(1);
    expect(notTestedFor('SEC-08')[0]!.because).toMatch(/firewall that drops a scanner/i);
  });

  it('reports the administrative-route criterion as not tested too', () => {
    expect(notTestedFor('SEC-05')).toHaveLength(1);
    /*
     * The firewall's own sentence, not the combined one.
     *
     * Found by mutation: deleting the firewall branch left the combined branch
     * to fire — all ten unestablished still sums to all unestablished — and a
     * looser assertion passed on wording written for a different owner. SEC-08
     * says why the three sentences exist: somebody whose host drops scanner
     * traffic and somebody whose application answers everything have different
     * things to do about it.
     */
    expect(notTestedFor('SEC-05')[0]!.because).toMatch(
      /gave no answer at all to any of the \d+ requests/,
    );
    expect(notTestedFor('SEC-05')[0]!.because).toMatch(/every route properly protected/);
    expect(notTestedFor('SEC-05')[0]!.because).not.toMatch(/came back as the application/);
  });

  it('counts each loop own unanswered probes, not the client running total', () => {
    /*
     * `http.unanswered` is cumulative, and SEC-08's count used to be read as
     * the whole of it — correct only while the exposed-path loop was the first
     * thing to probe anything. Adding a probe above it would have inflated the
     * count and reported SEC-08 as not tested on an application that answered
     * every one of those paths.
     *
     * No fixture can show that today, because nothing probes earlier. Asserted
     * on the source instead, which is honest about what it is: the shape that
     * keeps a future probe from breaking a count silently.
     */
    const stage = readFileSync('packages/engine/src/stages/deterministic.ts', 'utf8');
    expect(stage).toContain('http.unanswered.length - unansweredBeforeExposed');
    expect(stage).toContain('http.unanswered.length - unansweredBeforeAdmin');
  });

  it('does not say a robots.txt was not served, because that was not established', () => {
    const notes = (result.notes ?? []).join(' ');
    expect(notes).not.toMatch(/No robots\.txt was served/);
    expect(notes).toMatch(/robots\.txt[^.]*(no answer|not answered|could not be established)/i);
  });

  it('does not say a security.txt was not published either', () => {
    const notes = (result.notes ?? []).join(' ');
    expect(notes).not.toMatch(/No security\.txt was served/);
    expect(notes).toMatch(/security\.txt[^.]*(no answer|not answered|could not be established)/i);
  });

  it('claims no finding against an application it could not read', () => {
    // The whole point. A dropped probe must never become a finding, and the
    // ones that did answer — the front page's own headers — still stand.
    for (const finding of result.findings) {
      expect(['SEC-05', 'SEC-08'], `${finding.ruleId} from a dropped probe`).not.toContain(
        finding.ruleId,
      );
    }
  });
});
