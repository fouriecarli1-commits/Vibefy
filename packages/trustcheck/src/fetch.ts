/**
 * Reading a page a stranger asked us to read.
 *
 * This is the most exposed input in the product. Everywhere else, a URL we
 * fetch came from a customer who signed an authorisation warranty and proved
 * they control the host. Here it came from an anonymous person typing into a
 * public box — which means anyone on the internet can choose an address for our
 * server to open a connection to.
 *
 * So this does the smallest possible thing:
 *
 *   · **One GET.** No POST, no credentials, no cookies stored, nothing sent
 *     back. We read what a browser opening that page would read.
 *   · **HTTPS only**, with a single upgrade attempt from a typed `http://`,
 *     because people type it and refusing outright helps nobody.
 *   · **The resolved address is checked**, not just the URL. `169.254.169.254`
 *     is the cloud metadata service and a hostname pointing at it looks
 *     perfectly ordinary. The guard's dispatcher is reused rather than
 *     reimplemented: two copies of an SSRF defence means one of them gets fixed.
 *   · **Bounded** — five redirects, ten seconds, 2MB. A hostile page should not
 *     be able to hold a request open or exhaust memory.
 *
 * It never uses the assessment pipeline. There is no scope to widen here
 * because there is no authorisation, and nothing in this file can reach a
 * second page.
 */
import { fetch } from 'undici';
// The guard only — not the engine. Importing the whole engine would drag in
// the browser-driving stages, and this module must never be able to reach one:
// there is no authorisation here, so there is no assessment to run.
import { createScopedDispatcher, isPrivateAddress, ScopeGuard } from '@vibefycode/engine/scope';
import { TrustCheckInputError } from './types.ts';

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2_000_000;

export interface FetchedPage {
  readonly finalUrl: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly html: string;
  readonly redirected: boolean;
}

/**
 * Turns what a person typed into a URL, or refuses.
 *
 * People paste app store listings, bare domains, and addresses with tracking
 * junk on the end. All of those are fine. What is not fine is a scheme that is
 * not the web, or a host with no dots in it — `localhost`, a container name, an
 * internal short name — which is the shape of an address that only means
 * something from inside our own network.
 */
export function normaliseUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new TrustCheckInputError('Paste the app’s web address first.');
  if (trimmed.length > 2000) throw new TrustCheckInputError('That address is too long to be real.');

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new TrustCheckInputError(
      'That does not look like a web address. It should look like https://example.com.',
    );
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TrustCheckInputError('Only web addresses can be checked — https:// or http://.');
  }
  if (!url.hostname.includes('.') || url.hostname.endsWith('.')) {
    throw new TrustCheckInputError(
      'That address has no domain name in it, so there is nothing public to look at.',
    );
  }
  // Checked here as well as at connect time, so the refusal is a sentence the
  // person can act on rather than a failed connection.
  if (isPrivateAddress(url.hostname)) {
    throw new TrustCheckInputError('That address points inside a private network, not at an app.');
  }

  // Credentials in a URL are either a mistake or an attempt to make us send
  // them somewhere. Either way they are dropped rather than forwarded.
  url.username = '';
  url.password = '';
  url.hash = '';
  return url;
}

function guardFor(host: string) {
  return new ScopeGuard({
    allowedHosts: [host],
    exclusions: [],
    ceiling: {
      nonDestructiveOnly: true,
      maxRequestsPerMinute: 6,
      maxTotalRequests: 1 + MAX_REDIRECTS,
      maxDurationSeconds: 15,
      allowDataModification: false,
      allowDataExport: false,
      allowAccountCreation: false,
      syntheticAccountsOnly: true,
    },
  });
}

export async function fetchPublicPage(url: URL): Promise<FetchedPage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let current = url;
  let redirected = false;

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      // A redirect can move us to a different host, so the guard is rebuilt for
      // whichever host we are about to contact rather than carried along.
      const dispatcher = createScopedDispatcher(guardFor(current.hostname));

      const response = await fetch(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        dispatcher,
        headers: {
          // We say who we are. A checker that arrives disguised is
          // indistinguishable from something worse in somebody's logs.
          'user-agent': 'VibefyCodeTrustCheck/1.0 (+https://vibefycode.app/trust-check)',
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'en',
        },
      });

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });

      const location = headers.location;
      if (location && response.status >= 300 && response.status < 400 && hop < MAX_REDIRECTS) {
        const next = new URL(location, current);
        if (next.protocol !== 'https:' && next.protocol !== 'http:') {
          throw new TrustCheckInputError('That site redirects somewhere that is not a web page.');
        }
        if (isPrivateAddress(next.hostname)) {
          throw new TrustCheckInputError('That site redirects into a private network.');
        }
        current = next;
        redirected = true;
        continue;
      }

      return {
        finalUrl: current.toString(),
        status: response.status,
        headers,
        html: await readCapped(response),
        redirected,
      };
    }

    throw new TrustCheckInputError('That address redirects too many times to follow.');
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(response: { body: unknown }): Promise<string> {
  const body = response.body as ReadableStream<Uint8Array> | null;
  const reader = body?.getReader?.();
  if (!reader) return '';

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      chunks.push(value.slice(0, Math.max(0, MAX_BYTES - (total - value.byteLength))));
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
