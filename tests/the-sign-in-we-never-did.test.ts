/**
 * "We signed in with a test account" — which has never once happened.
 *
 * The assurance list is the public answer to nine questions, and the first of
 * them is the one a visitor worries about first: could somebody else get into
 * my account. Its `whatWeChecked` sentence reads, in the first person and the
 * past tense: "We signed in with a test account and tried the ways accounts
 * are usually taken over."
 *
 * Nothing in this engine signs in. `syntheticCredentials` is an optional field
 * on the worker's job that no caller sets and no queue row holds, there is no
 * sign-in tool on the model's surface, and `fill` now refuses to type a
 * password it was not given. Measured on 2026-10-09: on an application whose
 * owner declared authentication, with the pipeline's own `notTested` list and
 * no findings, that question renders `checked_clear` — a tick, under a sentence
 * saying we did something we did not do.
 *
 * Beneath it is the same shape one level down. SEC-03 is "session cookies
 * carry Secure, HttpOnly and a sane SameSite", and `cookieChecks` returns no
 * finding when the response carried no `set-cookie` at all. No cookie seen and
 * no finding filed is indistinguishable, downstream, from a cookie inspected
 * and found correct.
 *
 * Both halves are held here: the sentence must describe what the engine does,
 * and a criterion read off a cookie nobody saw must say so instead of ticking.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ASSURANCE_CLAIMS,
  assuranceFor,
  type AssuranceInput,
} from '../packages/assurance/src/index.ts';
import { getRubric } from '../packages/rubric/src/index.ts';
import {
  CostMeter,
  DEFAULT_CEILING,
  EvidenceStore,
  ScopeGuard,
  deterministicChecksStage,
  type StageContext,
  type StageResult,
} from '../packages/engine/src/index.ts';
import { browserTools } from '../packages/engine/src/stages/tools.ts';
import { BrowserSession } from '../packages/engine/src/runtime/browser.ts';

describe('what the list says we did', () => {
  /**
   * No claim may assert, in the first person, that we signed in.
   *
   * Written as a rule over the sentences rather than as one assertion about
   * one claim, because the next sentence somebody writes for a question about
   * a signed-in surface will reach for the same words.
   */
  it('does not say we signed in, because nothing in the engine can', () => {
    // The premise, measured rather than remembered: there is no tool that
    // signs in. If one ever arrives this assertion fails, which is the moment
    // to re-read the sentences below rather than years later.
    const session = null as unknown as BrowserSession;
    const names = browserTools({
      session,
      ceiling: DEFAULT_CEILING,
      credentials: undefined,
    }).map((entry) => entry.name);
    expect(names).not.toContain('sign_in');
    expect(names).not.toContain('login');

    for (const claim of ASSURANCE_CLAIMS) {
      const said = `${claim.whatWeChecked} ${claim.limitation}`;
      expect(
        said,
        `${claim.id} tells the reader we signed in. Nothing in this engine signs in: no caller ` +
          'sets `syntheticCredentials`, there is no sign-in tool, and `fill` refuses a password it ' +
          'was not given. Describe what the checks actually do.',
      ).not.toMatch(/\bwe (signed|logged) in\b/i);
    }
  });
});

const rubricCriteria = getRubric('1.1.0').dimensions.flatMap((dimension) =>
  dimension.criteria.map((criterion) => criterion.id),
);

/** An assessment of an application with a sign-in, that was given no account. */
const signedOut = (
  notTested: readonly { criterion: string; because: string }[],
): AssuranceInput => ({
  appName: 'Kettle',
  assessedOn: '2026-10-09',
  rubricVersion: '1.1.0',
  depth: 'full',
  gateFailures: [],
  rubricCriteria,
  notTested,
  findings: [],
  declared: { authentication: true, payments: false, personalData: true },
});

describe('the question about getting into your account', () => {
  it('is not a tick when the session side of it was never observed', () => {
    // Exactly what the pipeline produces today for this application.
    const states = assuranceFor(
      signedOut(
        ['FI-02', 'FI-07', 'PRI-03', 'STR-03', 'SEC-03'].map((criterion) => ({
          criterion,
          because: 'The assessment was given no test account.',
        })),
      ),
    );
    const takeover = states.find((state) => state.claim.id === 'account_takeover')!;
    expect(takeover.state).toBe('not_tested');
    expect(takeover.notTestedBecause).toMatch(/no test account/i);
  });

  it('is still a tick when the cookie was there to look at', () => {
    // The half that makes the other half mean something. An application that
    // hands out a session cookie signed out had its cookie inspected, and the
    // answer for what was inspected is a real one.
    const states = assuranceFor(
      signedOut(
        ['FI-02', 'FI-07', 'PRI-03', 'STR-03'].map((criterion) => ({
          criterion,
          because: 'The assessment was given no test account.',
        })),
      ),
    );
    const takeover = states.find((state) => state.claim.id === 'account_takeover')!;
    expect(takeover.state).toBe('checked_clear');
  });
});

describe('a cookie nobody saw', () => {
  let server: Server;
  let result: StageResult;

  beforeAll(async () => {
    // A page with no `set-cookie` anywhere, which is the ordinary case for a
    // signed-out landing page.
    server = createServer((_request, response) => {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'strict-transport-security': 'max-age=31536000',
      });
      response.end(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Kettle</title></head>' +
          '<body><h1>Kettle</h1><a href="/sign-in">Sign in</a></body></html>',
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    const context: StageContext = {
      assessmentId: 'assessment-no-cookie',
      depth: 'full',
      guard: new ScopeGuard({
        allowedHosts: ['127.0.0.1'],
        exclusions: [],
        ceiling: { ...DEFAULT_CEILING, maxRequestsPerMinute: 600, maxTotalRequests: 400 },
        allowPrivateNetworkForTesting: true,
      }),
      meter: new CostMeter({ maxRunCostUsd: 1 }),
      evidence: new EvidenceStore('assessment-no-cookie'),
      model: null as never,
      log: () => undefined,
      target: {
        appId: 'app-no-cookie',
        organisationId: 'org-no-cookie',
        appName: 'Kettle',
        appType: 'web_url',
        primaryUrl: `http://127.0.0.1:${port}`,
        repositoryPath: null,
        intendedForAppStore: false,
        isGame: false,
        hasAuthentication: true,
        hasPayments: false,
        processesPersonalData: false,
        description: 'A shop that sells kettles.',
      },
    };
    result = await deterministicChecksStage.run(context);
  }, 180_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it('files no finding against SEC-03, which is correct', () => {
    expect(result.findings.filter((finding) => finding.ruleId === 'SEC-03')).toHaveLength(0);
  });

  it('says SEC-03 was not tested, rather than letting the absence tick', () => {
    const entry = result.notTested?.find((candidate) => candidate.criterion === 'SEC-03');
    expect(
      entry,
      'no `set-cookie` was seen, no SEC-03 finding was filed, and nothing said so — so the ' +
        'published question about getting into your account renders a tick for a session cookie ' +
        'that was never looked at',
    ).toBeDefined();
    expect(entry?.because).toMatch(/no cookie/i);
  });
});
