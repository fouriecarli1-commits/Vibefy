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
import { classifyStop } from './stop.ts';

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
  /**
   * Whether the response body is kept in the evidence artefact. Default true.
   *
   * The exchange is always recorded — what we asked for, what came back, when.
   * Being unable to say what a request was is not something this client offers.
   * What a crawl does not need is fifty copies of somebody's marketing site
   * held for ninety days, so the entry page keeps its body and the rest keep
   * their headers.
   *
   * It used to be called `captureEvidence`, and it was declared here, passed
   * deliberately at two call sites with a comment explaining the cost, and read
   * nowhere at all: every page of every crawl was stored in full.
   */
  readonly keepBody?: boolean;
  readonly summary?: string;
}

/**
 * A target that redirects to itself, which is the application's defect and not
 * a boundary we were turned back at.
 *
 * It used to be raised as a ScopeViolationError, which `classifyStop` reads as
 * one of the three deliberate stops — so a redirect loop aborted the whole run
 * and told the customer it had been turned back at the edge of what they
 * authorised. It is an ordinary failed request.
 */
export class TooManyRedirectsError extends Error {
  constructor(
    readonly url: string,
    readonly chain: readonly string[],
  ) {
    super(`More than ${MAX_REDIRECTS} redirects starting at ${url}`);
    this.name = 'TooManyRedirectsError';
  }
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
      // The timer covers the body as well as the headers, and is cleared once
      // the body has been read rather than once the headers have arrived. It
      // used to be cleared in a `finally` around the fetch alone, so a target
      // that answered immediately and then sent its body one byte a minute had
      // nothing stopping it: the size cap bounds what the runner holds, and
      // bounded nothing about how long it holds the runner.
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
        clearTimeout(timer);
        // undici wraps whatever the connector threw in a bare `fetch failed`.
        // A scope refusal that reaches a log as "fetch failed" is a refusal
        // nobody can act on, so the real reason is put back in front.
        throw unwrapScopeViolation(error);
      }

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });

      const location = headers.location;
      if (location && response.status >= 300 && response.status < 400) {
        clearTimeout(timer);
        // On the last hop this throws rather than falling through. Falling
        // through returned the redirect itself as the answer — status 302, an
        // empty body — and the `throw` below this loop was unreachable, so a
        // target that redirects to itself for ever came back looking like a
        // page that had been read.
        if (hop >= MAX_REDIRECTS) throw new TooManyRedirectsError(rawUrl, redirectChain);
        redirectChain.push(currentUrl);
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      let body: string;
      let truncated: boolean;
      try {
        ({ body, truncated } = await readCapped(response));
      } catch (error) {
        throw controller.signal.aborted
          ? new Error(
              `The response body from ${currentUrl} was still arriving after ${REQUEST_TIMEOUT_MS / 1000} seconds.`,
            )
          : error;
      } finally {
        clearTimeout(timer);
      }
      const elapsedMs = Date.now() - startedAt;
      const keepBody = options.keepBody ?? true;

      const artefact = this.evidence.capture({
        kind: 'http_exchange',
        summary: options.summary ?? `${method} ${currentUrl} → ${response.status}`,
        body: {
          request: { method, url: currentUrl, redirectChain },
          response: {
            status: response.status,
            headers,
            bodyPreview: keepBody ? body.slice(0, 4000) : null,
            bodyRetained: keepBody,
            bodyLength: body.length,
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

    throw new TooManyRedirectsError(rawUrl, redirectChain);
  }

  /** Probes a path, treating a refusal or a network error as "not reachable". */
  /**
   * A request whose failure is an answer: null means the path was not served.
   *
   * A ceiling is not that answer. Reaching the spending cap or the intensity
   * the customer authorised used to come back from here as null, which the
   * caller reads as "nothing is exposed at /.env" — a clean security posture
   * reported from a probe that was never sent. The three deliberate stops are
   * thrown; everything else is still an answer.
   */
  async probe(baseUrl: string, path: string): Promise<ScopedResponse | null> {
    try {
      return await this.request(new URL(path, baseUrl).toString(), {
        summary: `Probe ${path}`,
      });
    } catch (error) {
      if (classifyStop(error) !== null) throw error;
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
