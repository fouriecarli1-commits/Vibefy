/**
 * The scope boundary.
 *
 * This is the test that matters most in the engine: testing a system we are not
 * authorised to test is a criminal offence, and the guard is what stands between
 * a model's suggestion and a request actually leaving the machine.
 */
import { describe, expect, it } from 'vitest';
import {
  CeilingExceededError,
  DEFAULT_CEILING,
  ScopeGuard,
  ScopeViolationError,
  isPrivateAddress,
  policyFromAuthorisation,
} from '../packages/engine/src/index.ts';

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
