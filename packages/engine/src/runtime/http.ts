/**
 * The scoped HTTP client.
 *
 * Every request the engine makes goes through here so that three things happen
 * without a stage having to remember them: the scope guard decides whether the
 * request may leave at all, the exchange is captured as evidence, and response
 * bodies are size-capped so a hostile target cannot exhaust the runner's memory.
 *
 * Redirects are followed manually because an automatic redirect is a request the
 * guard never saw — a target could redirect us to a host the customer never
 * authorised, or to a link-local address.
 *
 * Every request also goes out through the guard's own dispatcher. `guard.check`
 * reads the URL, which is not enough on its own: an authorised host whose
 * A-record points at 169.254.169.254 passes a host allowlist and reaches the
 * metadata service. Only the dispatcher sees the address the name actually
 * resolved to, so it is attached per request rather than left to a global
 * install that a caller has to remember.
 */
// `fetch` comes from undici rather than the global, because the dispatcher does
// too. Node bundles its own copy of undici for the global `fetch`, and handing
// that copy a dispatcher built by the npm one fails at the handler interface —
// two implementations of the same library that do not recognise each other.
import { fetch, setGlobalDispatcher } from 'undici';
import type { Dispatcher, RequestInit, Response } from 'undici';
import { createScopedDispatcher, ScopeGuard, ScopeViolationError } from './scope.ts';
import type { EvidenceStore } from './evidence.ts';

const MAX_BODY_BYTES = 2_000_000;
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 20_000;

export interface ScopedResponse {
  readonly url: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly truncated: boolean;
  readonly redirectChain: readonly string[];
  readonly elapsedMs: number;
  readonly evidenceId: string;
}

export interface ScopedRequestOptions {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
  readonly captureEvidence?: boolean;
  readonly summary?: string;
}

export class ScopedHttp {
  private readonly dispatcher: Dispatcher;

  constructor(
    private readonly guard: ScopeGuard,
    private readonly evidence: EvidenceStore,
  ) {
    this.dispatcher = createScopedDispatcher(guard);
  }

  /**
   * Additionally installs the guard as the process-wide dispatcher.
   *
   * Not required for anything this class does — its own requests are already
   * dispatched through the guard. This is for the rest of the process: a call
   * to `fetch` inside a dependency that never heard of the scope guard is
   * bounded by the customer's authorisation once this has run.
   */
  installGlobalDispatcher(): void {
    setGlobalDispatcher(this.dispatcher);
  }

  async request(rawUrl: string, options: ScopedRequestOptions = {}): Promise<ScopedResponse> {
    const method = (options.method ?? 'GET').toUpperCase();
    const redirectChain: string[] = [];
    let currentUrl = rawUrl;
    const startedAt = Date.now();

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      this.guard.assert(currentUrl, method);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(currentUrl, {
          method,
          redirect: 'manual',
          signal: controller.signal,
          // The guard checked the URL above; the dispatcher checks the address
          // that URL's host resolves to. A host allowlist cannot do the second.
          dispatcher: this.dispatcher,
          headers: {
            // We identify ourselves. An assessment service that arrives
            // disguised is indistinguishable from an attacker in a customer's
            // logs, and would deserve to be treated as one.
            'user-agent': 'VibefyCodeAssessment/1.0 (+https://vibefycode.example/methodology)',
            accept: '*/*',
            ...options.headers,
          },
          ...(options.body ? { body: options.body } : {}),
        });
      } catch (error) {
        // undici wraps whatever the connector threw in a bare `fetch failed`.
        // A scope refusal that reaches a log as "fetch failed" is a refusal
        // nobody can act on, so the real reason is put back in front.
        throw unwrapScopeViolation(error);
      } finally {
        clearTimeout(timer);
      }

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });

      const location = headers.location;
      if (location && response.status >= 300 && response.status < 400 && hop < MAX_REDIRECTS) {
        redirectChain.push(currentUrl);
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      const { body, truncated } = await readCapped(response);
      const elapsedMs = Date.now() - startedAt;

      const artefact = this.evidence.capture({
        kind: 'http_exchange',
        summary: options.summary ?? `${method} ${currentUrl} → ${response.status}`,
        body: {
          request: { method, url: currentUrl, redirectChain },
          response: {
            status: response.status,
            headers,
            bodyPreview: body.slice(0, 4000),
            truncated,
            elapsedMs,
          },
        },
      });

      return {
        url: currentUrl,
        status: response.status,
        headers,
        body,
        truncated,
        redirectChain,
        elapsedMs,
        evidenceId: artefact.id,
      };
    }

    throw new ScopeViolationError('Too many redirects', { url: rawUrl, reason: 'redirect_loop' });
  }

  /** Probes a path, treating a refusal or a network error as "not reachable". */
  async probe(baseUrl: string, path: string): Promise<ScopedResponse | null> {
    try {
      return await this.request(new URL(path, baseUrl).toString(), {
        summary: `Probe ${path}`,
      });
    } catch {
      return null;
    }
  }
}

/** Digs a ScopeViolationError out of a wrapped fetch failure, if that is what it was. */
function unwrapScopeViolation(error: unknown): unknown {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (current instanceof ScopeViolationError) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return error;
}

async function readCapped(response: Response): Promise<{ body: string; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { body: '', truncated: false };

  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      chunks.push(value.slice(0, Math.max(0, MAX_BODY_BYTES - (total - value.byteLength))));
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return { body: Buffer.concat(chunks).toString('utf8'), truncated };
}
