/**
 * An application that answers every path, and the dozen critical findings it
 * used to get for it.
 *
 * `SEC-08` probes about a dozen paths that should never be served — `.env`,
 * `.git/config`, `.aws/credentials`, `.netrc`, a database dump — and raised a
 * finding when one came back 200 with a non-empty body.
 *
 * A single-page application with a catch-all route answers 200 with a
 * non-empty body for every path. Every one of those probes therefore produced
 * a finding, several of them critical, titled "Environment file is publicly
 * readable" about an application with nothing wrong with it: the score gated
 * to the floor, the badge withheld, and a report accusing somebody of
 * publishing their secrets. We sell to people building with frameworks that do
 * exactly this by default, so it is closer to the common case than to an edge
 * one.
 *
 * It is the mirror image of the firewall case the same file already reasons
 * about at length — a host that refuses every probe reads as an application
 * with nothing to find — and it sat ten lines above it. Somebody thought
 * carefully about probes that fail and not about probes that all succeed.
 *
 * Two tests settle it, and neither needs the body parsed. None of these paths
 * is ever legitimately HTML, so an HTML answer is the application's own page;
 * and a body identical to the front page is the catch-all whatever its content
 * type claims.
 *
 * Not a finding and not silence. The paths were neither found nor ruled out,
 * which is what the note and the not-tested entry say — the same remedy the
 * firewall case already had.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
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

const SHELL =
  '<!doctype html><html lang="en"><head><title>Kettle</title></head><body><div id="root"></div></body></html>';

/** Serves one body for every path, which is what a catch-all route does. */
async function startApp(
  answer: (path: string) => { status: number; body: string; type: string },
): Promise<{ url: string; close: () => Promise<void>; asked: string[] }> {
  const asked: string[] = [];
  const server: Server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    asked.push(path);
    const { status, body, type } = answer(path);
    response.writeHead(status, { 'content-type': type });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    asked,
  };
}

function contextFor(url: string): StageContext {
  return {
    assessmentId: 'assessment-catch-all',
    depth: 'full',
    guard: new ScopeGuard({
      allowedHosts: ['127.0.0.1'],
      exclusions: [],
      ceiling: { ...DEFAULT_CEILING },
      allowPrivateNetworkForTesting: true,
    }),
    meter: new CostMeter({ maxRunCostUsd: 1 }),
    evidence: new EvidenceStore('assessment-catch-all'),
    model: null as never,
    log: () => undefined,
    target: {
      appId: 'app-catch-all',
      organisationId: 'org-catch-all',
      appName: 'Kettle',
      appType: 'web_url',
      primaryUrl: url,
      repositoryPath: null,
      intendedForAppStore: false,
      isGame: false,
      hasAuthentication: true,
      hasPayments: false,
      processesPersonalData: false,
      description: 'A shop that sells kettles.',
    },
  };
}

describe('a single-page application with a catch-all route', () => {
  let app: Awaited<ReturnType<typeof startApp>>;
  let result: StageResult;

  beforeAll(async () => {
    app = await startApp(() => ({ status: 200, body: SHELL, type: 'text/html; charset=utf-8' }));
    result = await deterministicChecksStage.run(contextFor(app.url));
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  it('was actually asked about those paths, or this proves nothing', () => {
    expect(app.asked.length).toBeGreaterThan(8);
    expect(app.asked.some((path) => path.includes('.env'))).toBe(true);
  });

  it('is accused of exposing nothing', () => {
    const exposures = result.findings.filter((finding) => finding.ruleId === 'SEC-08');
    expect(
      exposures.map((finding) => finding.title),
      'an application that answers every path was accused of publishing its secrets',
    ).toEqual([]);
  });

  it('is told the criterion was not established, rather than that it passed', () => {
    const notTested = (result.notTested ?? []).filter((entry) => entry.criterion === 'SEC-08');
    expect(notTested, 'SEC-08 reads as checked and clean').toHaveLength(1);
    expect(notTested[0]!.because).toMatch(/catch-all|application's own page/);
  });

  it('says it in words an owner can act on', () => {
    const because = (result.notTested ?? []).find((entry) => entry.criterion === 'SEC-08')!.because;
    expect(because.length).toBeGreaterThan(80);
    expect(because).toMatch(/neither|either way/);
  });
});

describe('the administrative routes, under the same catch-all', () => {
  /*
   * Four of the eight paths probed belong to software a Vite or Next
   * application does not run: `/wp-admin`, `/phpmyadmin`, `/adminer.php`,
   * `/administrator`. A catch-all answers all eight with the shell, which
   * contains no sign-in prompt, so every one produced a finding at high
   * severity — one of them saying the application served phpMyAdmin without
   * asking who was asking.
   *
   * I read this loop an hour before fixing the exposed paths and left it,
   * reasoning that an application serving its own shell at `/admin` *is* the
   * finding its description names. True of `/admin`, plainly false of
   * `/phpmyadmin`, and the two are indistinguishable from out here.
   */
  let app: Awaited<ReturnType<typeof startApp>>;
  let result: StageResult;

  beforeAll(async () => {
    app = await startApp(() => ({ status: 200, body: SHELL, type: 'text/html; charset=utf-8' }));
    result = await deterministicChecksStage.run(contextFor(app.url));
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  it('was asked about them', () => {
    expect(app.asked.some((path) => path === '/phpmyadmin')).toBe(true);
    expect(app.asked.some((path) => path === '/admin')).toBe(true);
  });

  it('is not accused of serving phpMyAdmin unprotected', () => {
    const admin = result.findings.filter((finding) => finding.ruleId === 'SEC-05');
    expect(
      admin.map((finding) => finding.title),
      'an application with no phpMyAdmin was told it serves one',
    ).toEqual([]);
  });

  it('is told the criterion was not established', () => {
    const notTested = (result.notTested ?? []).filter((entry) => entry.criterion === 'SEC-05');
    expect(notTested).toHaveLength(1);
    expect(notTested[0]!.because).toMatch(/byte for byte|catch-all/);
  });

  it('says why a body returned for every path is no evidence about one of them', () => {
    const because = (result.notTested ?? []).find((entry) => entry.criterion === 'SEC-05')!.because;
    expect(because).toMatch(/no evidence/);
  });
});

describe('an administrative route that really is served unprotected', () => {
  let app: Awaited<ReturnType<typeof startApp>>;
  let result: StageResult;

  beforeAll(async () => {
    // Its own body, not the shell: the server is really serving that route.
    app = await startApp((path) =>
      path === '/admin'
        ? {
            status: 200,
            body: '<!doctype html><html><body><h1>Admin</h1><table><tr><td>users</td></tr></table></body></html>',
            type: 'text/html; charset=utf-8',
          }
        : path === '/'
          ? { status: 200, body: SHELL, type: 'text/html; charset=utf-8' }
          : { status: 404, body: 'not found', type: 'text/plain' },
    );
    result = await deterministicChecksStage.run(contextFor(app.url));
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  it('is still found, which is the positive control for the case above', () => {
    const admin = result.findings.filter((finding) => finding.ruleId === 'SEC-05');
    expect(admin.map((finding) => finding.title).join(' | ')).toMatch(
      /Administrative route \/admin served content/,
    );
  });

  it('is not reported as unestablished, because it was established', () => {
    expect((result.notTested ?? []).filter((entry) => entry.criterion === 'SEC-05')).toEqual([]);
  });
});

describe('the notes, where the catch-all flatters instead of accusing', () => {
  /*
   * The other half, and the half that does not shout. Under a catch-all,
   * `/robots.txt` came back 200 so the note telling an owner to add one was
   * skipped, and `/.well-known/security.txt` came back 200 so the report said
   * they publish one. A flattering untruth in a report somebody pays for is
   * still an untruth.
   */
  let app: Awaited<ReturnType<typeof startApp>>;
  let result: StageResult;

  beforeAll(async () => {
    app = await startApp(() => ({ status: 200, body: SHELL, type: 'text/html; charset=utf-8' }));
    result = await deterministicChecksStage.run(contextFor(app.url));
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  const notes = () => (result.notes ?? []).join(' | ');

  it('does not say a security.txt is published', () => {
    expect(
      notes(),
      'the report credited an owner with a security.txt they do not publish',
    ).not.toMatch(/A security\.txt is published/);
  });

  it('says the request came back as the application instead', () => {
    expect(notes()).toMatch(/security\.txt came back as the application/);
  });

  it('still tells them to add one, which is the advice either way', () => {
    expect(notes()).toMatch(/Publishing one tells a finder/);
  });

  it('says the same about robots.txt rather than crediting one', () => {
    expect(notes()).toMatch(/robots\.txt came back as the application/);
  });
});

describe('an application that really publishes those files', () => {
  let app: Awaited<ReturnType<typeof startApp>>;
  let result: StageResult;

  beforeAll(async () => {
    app = await startApp((path) =>
      path === '/robots.txt'
        ? { status: 200, body: 'User-agent: *\nAllow: /\n', type: 'text/plain' }
        : path === '/.well-known/security.txt'
          ? { status: 200, body: 'Contact: mailto:security@kettle.example\n', type: 'text/plain' }
          : path === '/'
            ? { status: 200, body: SHELL, type: 'text/html; charset=utf-8' }
            : { status: 404, body: 'not found', type: 'text/plain' },
    );
    result = await deterministicChecksStage.run(contextFor(app.url));
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  const notes = () => (result.notes ?? []).join(' | ');

  it('is credited with the security.txt it really publishes', () => {
    // The positive control: a fix that never credited anybody would satisfy
    // every assertion above.
    expect(notes()).toMatch(/A security\.txt is published/);
  });

  it('is not told to add a robots.txt it already has', () => {
    expect(notes()).not.toMatch(/No robots\.txt was served/);
    expect(notes()).not.toMatch(/robots\.txt came back as the application/);
  });
});

describe('an application that serves the files it should not', () => {
  let app: Awaited<ReturnType<typeof startApp>>;
  let result: StageResult;

  beforeAll(async () => {
    app = await startApp((path) =>
      path === '/'
        ? { status: 200, body: SHELL, type: 'text/html; charset=utf-8' }
        : path === '/.env'
          ? {
              status: 200,
              // secret-scan-allow: a fabricated value, which is the fixture
              body: 'STRIPE_SECRET_KEY=sk_live_notarealkeyatall\n',
              type: 'text/plain; charset=utf-8',
            }
          : { status: 404, body: 'not found', type: 'text/plain' },
    );
    result = await deterministicChecksStage.run(contextFor(app.url));
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  it('is still found, which is the whole point of the check', () => {
    // The positive control. A fix that excused every 200 would satisfy the
    // case above and stop the product finding the thing it exists to find.
    const exposures = result.findings.filter((finding) => finding.ruleId === 'SEC-08');
    expect(exposures.map((finding) => finding.title).join(' | ')).toMatch(
      /Environment file is publicly readable/,
    );
  });

  it('is not reported as unestablished, because it was established', () => {
    expect((result.notTested ?? []).filter((entry) => entry.criterion === 'SEC-08')).toEqual([]);
  });
});

describe('an application whose catch-all is not HTML', () => {
  let app: Awaited<ReturnType<typeof startApp>>;
  let result: StageResult;

  beforeAll(async () => {
    // Some hosts answer a catch-all as plain text. The content type then says
    // nothing, and the body being the front page is what settles it.
    app = await startApp(() => ({
      status: 200,
      body: 'the same body for every path',
      type: 'text/plain; charset=utf-8',
    }));
    result = await deterministicChecksStage.run(contextFor(app.url));
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  it('is accused of exposing nothing either', () => {
    expect(result.findings.filter((finding) => finding.ruleId === 'SEC-08')).toEqual([]);
  });

  it('is told so for the right reason', () => {
    const notTested = (result.notTested ?? []).filter((entry) => entry.criterion === 'SEC-08');
    expect(notTested).toHaveLength(1);
  });
});
