/**
 * The scope boundary.
 *
 * This is the test that matters most in the engine: testing a system we are not
 * authorised to test is a criminal offence, and the guard is what stands between
 * a model's suggestion and a request actually leaving the machine.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BrowserSession,
  CeilingExceededError,
  DEFAULT_CEILING,
  EvidenceStore,
  ScopeGuard,
  ScopedHttp,
  ScopeViolationError,
  classifyStop,
  isPrivateAddress,
  policyFromAuthorisation,
} from '../packages/engine/src/index.ts';
import { startVulnerableApp } from './fixtures/vulnerable-app.ts';

const policy = {
  allowedHosts: ['kettle.example'],
  exclusions: ['/billing', 'admin.kettle.example'],
  ceiling: DEFAULT_CEILING,
};

describe('host allowlist', () => {
  const guard = () => new ScopeGuard(policy);

  it('allows the declared host and its subdomains', () => {
    expect(guard().check('https://kettle.example/').allowed).toBe(true);
    expect(guard().check('https://app.kettle.example/orders').allowed).toBe(true);
  });

  it('refuses anything else, including lookalikes', () => {
    for (const url of [
      'https://kettle.example.attacker.test/',
      'https://notkettle.example/',
      'https://evil.test/',
      'https://kettle-example.test/',
    ]) {
      expect(guard().check(url), url).toMatchObject({
        allowed: false,
        reason: 'host_out_of_scope',
      });
    }
  });

  it('honours exclusions over the allowlist', () => {
    expect(guard().check('https://kettle.example/billing/invoices')).toMatchObject({
      allowed: false,
      reason: 'explicitly_excluded',
    });
    expect(guard().check('https://admin.kettle.example/')).toMatchObject({
      allowed: false,
      reason: 'explicitly_excluded',
    });
  });

  it('refuses a policy that allows nothing, rather than treating it as allowing everything', () => {
    expect(() => new ScopeGuard({ ...policy, allowedHosts: [] })).toThrow(ScopeViolationError);
  });
});

describe('the non-destructive ceiling', () => {
  it('never lets a destructive method leave', () => {
    for (const method of ['DELETE', 'PUT', 'PATCH']) {
      expect(
        new ScopeGuard(policy).check('https://kettle.example/api/orders/1', method),
      ).toMatchObject({
        allowed: false,
        reason: 'destructive_method',
      });
    }
  });

  it('allows the methods a first user actually needs', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST']) {
      expect(
        new ScopeGuard(policy).check('https://kettle.example/signup', method).allowed,
        method,
      ).toBe(true);
    }
  });

  it('refuses a ceiling that claims to permit destruction', () => {
    const permissive = new ScopeGuard({
      ...policy,
      ceiling: { ...DEFAULT_CEILING, nonDestructiveOnly: false },
    });
    expect(permissive.check('https://kettle.example/', 'POST')).toMatchObject({
      allowed: false,
      reason: 'malformed_ceiling',
    });
  });

  it('requires HTTPS outside of local fixtures', () => {
    expect(new ScopeGuard(policy).check('http://kettle.example/')).toMatchObject({
      allowed: false,
      reason: 'non_https_scheme',
    });
  });
});

describe('rate and volume ceilings', () => {
  it('rate-limits within the minute rather than refusing forever', () => {
    const guard = new ScopeGuard({
      ...policy,
      ceiling: { ...DEFAULT_CEILING, maxRequestsPerMinute: 3 },
    });
    const now = 1_000_000;
    for (let i = 0; i < 3; i += 1) {
      expect(guard.check('https://kettle.example/', 'GET', now).allowed).toBe(true);
    }
    expect(guard.check('https://kettle.example/', 'GET', now)).toMatchObject({
      reason: 'rate_limited',
    });
    expect(guard.check('https://kettle.example/', 'GET', now + 61_000).allowed).toBe(true);
  });

  it('hard-kills the run on the total request ceiling', () => {
    const guard = new ScopeGuard({
      ...policy,
      ceiling: { ...DEFAULT_CEILING, maxTotalRequests: 2, maxRequestsPerMinute: 1000 },
    });
    guard.check('https://kettle.example/a');
    guard.check('https://kettle.example/b');
    expect(() => guard.check('https://kettle.example/c')).toThrow(CeilingExceededError);
  });

  it('hard-kills the run on the wall-clock ceiling', () => {
    const guard = new ScopeGuard(
      { ...policy, ceiling: { ...DEFAULT_CEILING, maxDurationSeconds: 10 } },
      0,
    );
    expect(() => guard.check('https://kettle.example/', 'GET', 11_000)).toThrow(
      CeilingExceededError,
    );
  });
});

describe('refusals are recorded', () => {
  it('keeps every refusal, because a refusal is evidence too', () => {
    const guard = new ScopeGuard(policy);
    guard.check('https://evil.test/');
    guard.check('https://kettle.example/billing');
    expect(guard.refusals.map((r) => r.reason)).toEqual([
      'host_out_of_scope',
      'explicitly_excluded',
    ]);
  });
});

describe('SSRF and rebinding defence', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['172.16.0.1', true],
    ['172.32.0.1', false],
    ['192.168.1.1', true],
    ['169.254.169.254', true], // cloud metadata
    ['100.64.0.1', true],
    ['8.8.8.8', false],
    ['::1', true],
    ['fd00::1', true],
    ['2606:4700:4700::1111', false],
    ['::ffff:127.0.0.1', true],
  ])('classifies %s as private=%s', (address, expected) => {
    expect(isPrivateAddress(address)).toBe(expected);
  });
});

describe('the client enforces the address, not only the URL', () => {
  // The gap this closes: `check` reads the URL. An authorised host whose
  // A-record points at 169.254.169.254 passes every check made against a URL,
  // and only the dispatcher — which sees what the name resolved to — stops it.
  // That dispatcher used to be reachable only through a global install that no
  // production code path performed.
  it('refuses a host in scope that resolves to a private address', async () => {
    const guard = new ScopeGuard({
      allowedHosts: ['localhost'],
      exclusions: [],
      ceiling: DEFAULT_CEILING,
    });

    // The URL-level check is content with it: the host is exactly what the
    // customer authorised.
    expect(guard.check('https://localhost/', 'GET').allowed).toBe(true);

    // The request is not. Nothing is listening on that port either, so what
    // matters is *which* failure comes back.
    const http = new ScopedHttp(guard, new EvidenceStore('scope-fixture'));
    await expect(http.request('https://localhost:9443/')).rejects.toThrow(/non-public address/);
  });

  it('needs no global install to do it', () => {
    // A defence that only works once someone remembers to call a setup method
    // is a defence that is off in the deployment where it matters.
    const source = readFileSync(join(process.cwd(), 'packages/engine/src/runtime/http.ts'), 'utf8');
    expect(source).toContain('createScopedDispatcher(guard)');
    expect(source).toContain('dispatcher: this.dispatcher');
    // Nothing in the engine or the worker calls the global installer, so it
    // cannot be what the address check depends on.
    expect(source.indexOf('this.dispatcher = createScopedDispatcher')).toBeLessThan(
      source.indexOf('installGlobalDispatcher()'),
    );
  });
});

describe('the private-network escape hatch', () => {
  /** Every TypeScript file that ships, which is everything outside `tests/`. */
  function shippedSources(): { path: string; source: string }[] {
    const found: { path: string; source: string }[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.next') continue;
          walk(full);
        } else if (/\.(ts|tsx|mts)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          found.push({ path: full, source: readFileSync(full, 'utf8') });
        }
      }
    };
    for (const root of ['packages', 'apps']) walk(join(process.cwd(), root));
    return found;
  }

  it('is not opened by anything that ships', () => {
    // `allowPrivateNetworkForTesting` turns off the one check a URL allowlist
    // cannot make: whether the address a host resolves to is somewhere we are
    // permitted to connect. The tests need it, because the fixture application
    // is on loopback. Nothing else may have it, and the way it would arrive is
    // somebody switching it on to make a stubborn case work and never switching
    // it back — which is invisible in a diff nobody is reading closely.
    const opened = shippedSources()
      .filter(({ source }) => /allowPrivateNetworkForTesting\s*:\s*true/.test(source))
      .map(({ path }) => path.replace(`${process.cwd()}/`, ''));
    expect(opened, 'shipped files that permit reaching a private address').toEqual([]);
  });

  it('finds it when it is there, so this guard is not decorative', () => {
    // The check above passing means nothing unless it can fail. This is the
    // same predicate against a file that does open the hatch.
    const pretend = 'const policy = { allowedHosts: [], allowPrivateNetworkForTesting: true };';
    expect(/allowPrivateNetworkForTesting\s*:\s*true/.test(pretend)).toBe(true);
  });
});

describe('policies built from an authorisation record', () => {
  it('can never reach a private address', () => {
    const built = policyFromAuthorisation({
      scope_domains: ['kettle.example'],
      scope_exclusions: [],
      intensity_ceiling: {
        non_destructive_only: true,
        allow_data_modification: false,
        allow_data_export: false,
        allow_account_creation: true,
        synthetic_accounts_only: true,
      },
    });
    expect(built.allowPrivateNetworkForTesting).toBeUndefined();
    expect(built.ceiling.nonDestructiveOnly).toBe(true);
    expect(built.ceiling.allowDataExport).toBe(false);
  });

  it('carries the customer’s declared scope through unchanged', () => {
    const built = policyFromAuthorisation({
      scope_domains: ['a.example', 'b.example'],
      scope_exclusions: ['/private'],
      intensity_ceiling: { non_destructive_only: true, max_requests_per_minute: 12 },
    });
    expect(built.allowedHosts).toEqual(['a.example', 'b.example']);
    expect(built.exclusions).toEqual(['/private']);
    expect(built.ceiling.maxRequestsPerMinute).toBe(12);
  });
});

describe('a ceiling reached inside a page’s own traffic', () => {
  it('stops the run and says which ceiling, rather than timing out', async () => {
    // `guard.check` throws when the run passes its request ceiling, and in a
    // browser session it is called from inside a Playwright route handler. An
    // exception thrown out of a route handler does not reach the caller —
    // Playwright swallows it and the request hangs until the navigation times
    // out. So the one event a customer most needs named correctly, a run
    // stopped at the intensity their own authorisation permits, used to arrive
    // as "the browser pass did not complete".
    const app = await startVulnerableApp();
    const guard = new ScopeGuard({
      allowedHosts: [app.host.split(':')[0]!],
      exclusions: [],
      // One request is the navigation itself; everything the page then asks for
      // is over the line.
      ceiling: { ...DEFAULT_CEILING, maxTotalRequests: 1, maxRequestsPerMinute: 600 },
      allowPrivateNetworkForTesting: true,
    });
    const session = new BrowserSession(guard, new EvidenceStore('assessment-ceiling'));
    try {
      await session.open();
      // The navigation itself may or may not be the request that crosses the
      // line, so the stop is asserted on the session rather than on one call.
      await session.goto(app.url, 'load').catch(() => undefined);
      const raised = await session
        .screenshot('after the ceiling')
        .then(() => null)
        .catch((error: unknown) => error);

      expect(session.stoppedByCeiling, 'the ceiling was reached and remembered').toBeInstanceOf(
        CeilingExceededError,
      );
      expect(raised, 'and raised at the next thing the stage asked for').toBeInstanceOf(
        CeilingExceededError,
      );
      // Which is what lets the pipeline call it a stop rather than a fault.
      expect(classifyStop(raised)).toBe('intensity_ceiling');
    } finally {
      await session.close();
      await app.close();
    }
  }, 120_000);
});
