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
 */
import { setGlobalDispatcher } from 'undici';
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
  constructor(
    private readonly guard: ScopeGuard,
    private readonly evidence: EvidenceStore,
  ) {}

  /**
   * Installs the guard as the process-wide dispatcher. Anything in this process
   * that calls `fetch` — including code inside a dependency that never heard of
   * the scope guard — is bounded by the customer's authorisation from here on.
   */
  installGlobalDispatcher(): void {
    setGlobalDispatcher(createScopedDispatcher(this.guard));
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
          headers: {
            // We identify ourselves. An assessment service that arrives
            // disguised is indistinguishable from an attacker in a customer's
            // logs, and would deserve to be treated as one.
            'user-agent': 'VibefyAssessment/1.0 (+https://vibefy.example/methodology)',
            accept: '*/*',
            ...options.headers,
          },
          ...(options.body ? { body: options.body } : {}),
        });
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
