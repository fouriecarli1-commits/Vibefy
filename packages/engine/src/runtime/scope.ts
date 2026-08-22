/**
 * The scope boundary.
 *
 * PART 6 of the brief: "The runner enforces the allowlist at network level;
 * out-of-scope requests are blocked by the sandbox, not merely discouraged by a
 * prompt." This module is the in-process half of that. The container's egress
 * allowlist is the outer half; neither is sufficient alone, because a model that
 * can be talked into fetching a URL is only stopped by something below it, and a
 * container allowlist cannot express "this customer authorised these hosts".
 *
 * What is enforced here:
 *   · Host allowlist, with explicit exclusions taking precedence.
 *   · SSRF and DNS-rebinding defence — every resolved address must be public,
 *     checked at connect time rather than at parse time.
 *   · Non-destructive method ceiling. DELETE, PUT and PATCH never leave here.
 *   · Request-count, rate and wall-clock ceilings, hard-killing the run on breach.
 *
 * Nothing in this file reads a prompt, and no model output can widen any of it.
 */
import { lookup as dnsLookup } from 'node:dns';
import { isPrivateAddress } from './addresses.ts';
import { Agent, type Dispatcher } from 'undici';

export { isPrivateAddress };

export class ScopeViolationError extends Error {
  constructor(
    message: string,
    readonly detail: { url?: string; host?: string; method?: string; reason: string },
  ) {
    super(message);
    this.name = 'ScopeViolationError';
  }
}

export class CeilingExceededError extends Error {
  constructor(
    message: string,
    readonly detail: { ceiling: string; limit: number; observed: number },
  ) {
    super(message);
    this.name = 'CeilingExceededError';
  }
}

/** The runner configuration copied from an authorisation record at dispatch. */
export interface IntensityCeiling {
  readonly nonDestructiveOnly: boolean;
  readonly maxRequestsPerMinute: number;
  readonly maxTotalRequests: number;
  readonly maxDurationSeconds: number;
  readonly allowDataModification: boolean;
  readonly allowDataExport: boolean;
  readonly allowAccountCreation: boolean;
  readonly syntheticAccountsOnly: boolean;
}

export interface ScopePolicy {
  /** Hosts the customer declared and we verified they control. */
  readonly allowedHosts: readonly string[];
  /** Paths and hosts the customer excluded. Exclusions always win. */
  readonly exclusions: readonly string[];
  readonly ceiling: IntensityCeiling;
  /**
   * Permits loopback and private addresses. Only ever true for local fixtures
   * and tests; a policy built from a real authorisation record cannot set it.
   */
  readonly allowPrivateNetworkForTesting?: boolean;
}

export const DEFAULT_CEILING: IntensityCeiling = {
  nonDestructiveOnly: true,
  maxRequestsPerMinute: 60,
  maxTotalRequests: 5000,
  maxDurationSeconds: 1800,
  allowDataModification: false,
  allowDataExport: false,
  allowAccountCreation: true,
  syntheticAccountsOnly: true,
};

/** Methods that change state on someone else's system. Never permitted. */
const DESTRUCTIVE_METHODS = new Set(['DELETE', 'PUT', 'PATCH']);
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface ScopeDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

export class ScopeGuard {
  readonly policy: ScopePolicy;
  private requestCount = 0;
  private readonly startedAt: number;
  private readonly recentRequests: number[] = [];
  private readonly violations: { url: string; reason: string; at: number }[] = [];

  constructor(policy: ScopePolicy, now: number = Date.now()) {
    if (policy.allowedHosts.length === 0) {
      throw new ScopeViolationError('A scope policy with no allowed hosts authorises nothing', {
        reason: 'empty_allowlist',
      });
    }
    this.policy = { ...policy, ceiling: { ...DEFAULT_CEILING, ...policy.ceiling } };
    this.startedAt = now;
  }

  /** Everything that was refused, for the run record. Refusals are evidence too. */
  get refusals(): readonly { url: string; reason: string; at: number }[] {
    return this.violations;
  }

  get requestsMade(): number {
    return this.requestCount;
  }

  /** Host is in scope when it matches an allowed host exactly or is a subdomain of one. */
  hostInScope(host: string): boolean {
    const normalised = host.toLowerCase().replace(/\.$/, '');
    return this.policy.allowedHosts.some((allowed) => {
      const candidate = allowed.toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
      return normalised === candidate || normalised.endsWith(`.${candidate}`);
    });
  }

  private excluded(url: URL): boolean {
    return this.policy.exclusions.some((exclusion) => {
      const trimmed = exclusion.trim().toLowerCase();
      if (!trimmed) return false;
      if (trimmed.startsWith('/')) return url.pathname.toLowerCase().startsWith(trimmed);
      const host = url.host.toLowerCase();
      const hostname = url.hostname.toLowerCase();
      return (
        host === trimmed ||
        hostname === trimmed ||
        `${host}${url.pathname}`.toLowerCase().startsWith(trimmed) ||
        `${hostname}${url.pathname}`.toLowerCase().startsWith(trimmed)
      );
    });
  }

  /**
   * The single decision point. Every request the engine makes passes through
   * here before it reaches the network, and the undici dispatcher below calls it
   * again for anything that tries to bypass the engine.
   */
  check(rawUrl: string, method = 'GET', now: number = Date.now()): ScopeDecision {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return this.refuse(rawUrl, 'unparseable_url');
    }

    if (url.protocol !== 'https:' && !this.policy.allowPrivateNetworkForTesting) {
      return this.refuse(rawUrl, 'non_https_scheme');
    }
    if (!['https:', 'http:'].includes(url.protocol)) {
      return this.refuse(rawUrl, 'unsupported_scheme');
    }

    const upperMethod = method.toUpperCase();
    if (DESTRUCTIVE_METHODS.has(upperMethod)) {
      return this.refuse(rawUrl, 'destructive_method');
    }
    if (!READ_METHODS.has(upperMethod) && upperMethod !== 'POST') {
      return this.refuse(rawUrl, 'unsupported_method');
    }
    if (upperMethod === 'POST' && this.policy.ceiling.nonDestructiveOnly === false) {
      // Defensive: a ceiling that claims to permit destruction is malformed, not permissive.
      return this.refuse(rawUrl, 'malformed_ceiling');
    }

    // hostname, not host: a port is not part of a host allowlist, and comparing
    // against host would refuse every non-default port the customer declared.
    if (!this.hostInScope(url.hostname)) return this.refuse(rawUrl, 'host_out_of_scope');
    if (this.excluded(url)) return this.refuse(rawUrl, 'explicitly_excluded');

    const elapsedSeconds = (now - this.startedAt) / 1000;
    if (elapsedSeconds > this.policy.ceiling.maxDurationSeconds) {
      throw new CeilingExceededError('Run exceeded its wall-clock ceiling', {
        ceiling: 'maxDurationSeconds',
        limit: this.policy.ceiling.maxDurationSeconds,
        observed: Math.round(elapsedSeconds),
      });
    }
    if (this.requestCount >= this.policy.ceiling.maxTotalRequests) {
      throw new CeilingExceededError('Run exceeded its total request ceiling', {
        ceiling: 'maxTotalRequests',
        limit: this.policy.ceiling.maxTotalRequests,
        observed: this.requestCount,
      });
    }

    const windowStart = now - 60_000;
    while (this.recentRequests.length > 0 && this.recentRequests[0]! < windowStart) {
      this.recentRequests.shift();
    }
    if (this.recentRequests.length >= this.policy.ceiling.maxRequestsPerMinute) {
      return this.refuse(rawUrl, 'rate_limited');
    }

    this.recentRequests.push(now);
    this.requestCount += 1;
    return { allowed: true, reason: 'in_scope' };
  }

  /** Throwing variant, for call sites where a refusal must abort the caller. */
  assert(rawUrl: string, method = 'GET', now: number = Date.now()): void {
    const decision = this.check(rawUrl, method, now);
    if (!decision.allowed) {
      throw new ScopeViolationError(`Request refused: ${decision.reason}`, {
        url: rawUrl,
        method,
        reason: decision.reason,
      });
    }
  }

  private refuse(url: string, reason: string): ScopeDecision {
    this.violations.push({ url, reason, at: Date.now() });
    return { allowed: false, reason };
  }
}

// ---------------------------------------------------------------------------
// Network-level enforcement
// ---------------------------------------------------------------------------

/**
 * An undici dispatcher that refuses anything the guard would refuse.
 *
 * This exists so that a future call site which forgets to ask the guard is still
 * stopped. Install it with `setGlobalDispatcher` in the runner and every `fetch`
 * in the process — including one inside a dependency — is bounded by the
 * customer's authorisation.
 */
export function createScopedDispatcher(guard: ScopeGuard): Dispatcher {
  const allowPrivate = guard.policy.allowPrivateNetworkForTesting === true;

  return new Agent({
    connect: {
      lookup(hostname, options, callback) {
        dnsLookup(hostname, options, (error, address, family) => {
          if (error) return callback(error, address as never, family as never);
          const addresses = Array.isArray(address) ? address.map((a) => a.address) : [address];
          const offending = addresses.find((candidate) => isPrivateAddress(String(candidate)));
          if (offending && !allowPrivate) {
            return callback(
              new ScopeViolationError(
                `Refusing to connect to ${hostname}: it resolves to the non-public address ${offending}`,
                { host: hostname, reason: 'private_address' },
              ),
              address as never,
              family as never,
            );
          }
          return callback(null, address as never, family as never);
        });
      },
    },
  }).compose((dispatch) => (options, handler) => {
    const origin = typeof options.origin === 'string' ? options.origin : options.origin?.origin;
    const url = `${origin ?? ''}${options.path ?? ''}`;
    const decision = guard.check(url, options.method ?? 'GET');
    if (!decision.allowed) {
      throw new ScopeViolationError(`Blocked by scope policy: ${decision.reason}`, {
        url,
        method: options.method ?? 'GET',
        reason: decision.reason,
      });
    }
    return dispatch(options, handler);
  });
}

/** Builds a policy from a stored authorisation record. */
export function policyFromAuthorisation(record: {
  scope_domains: string[];
  scope_exclusions: string[];
  intensity_ceiling: Record<string, unknown>;
}): ScopePolicy {
  const raw = record.intensity_ceiling;
  return {
    allowedHosts: record.scope_domains,
    exclusions: record.scope_exclusions,
    ceiling: {
      nonDestructiveOnly: raw.non_destructive_only === true,
      maxRequestsPerMinute: Number(
        raw.max_requests_per_minute ?? DEFAULT_CEILING.maxRequestsPerMinute,
      ),
      maxTotalRequests: Number(raw.max_total_requests ?? DEFAULT_CEILING.maxTotalRequests),
      maxDurationSeconds: Number(raw.max_duration_seconds ?? DEFAULT_CEILING.maxDurationSeconds),
      allowDataModification: raw.allow_data_modification === true,
      allowDataExport: raw.allow_data_export === true,
      allowAccountCreation: raw.allow_account_creation === true,
      syntheticAccountsOnly: raw.synthetic_accounts_only === true,
    },
    // Deliberately absent: a policy derived from a real authorisation record
    // can never permit reaching a private address.
  };
}
