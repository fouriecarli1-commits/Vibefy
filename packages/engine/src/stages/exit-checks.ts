/**
 * Measuring the way out.
 *
 * Every review of every subscription tells you how good it is to join. The
 * thing that actually costs people money is the other end — and nobody rates
 * it, which is why Anré asked for this.
 *
 * A bounded walk of the application's own pages, from the front door, looking
 * for two things: where the way in is, and where the way out is. The gap
 * between them is the measurement that matters, because nobody puts the cancel
 * link four pages deeper than the subscribe button by accident.
 *
 * Three rules it obeys.
 *
 * **It walks to the exit and stops.** It never presses cancel. Whether a
 * cancellation is honoured cannot be observed from outside without cancelling
 * somebody's subscription, and that is not ours to do — so this measures the
 * route rather than the outcome, and every sentence it produces says so.
 *
 * **It stays inside the authorised scope and the ceiling.** The crawl goes
 * through `ScopedHttp` like everything else, so the same allowlist, the same
 * rate limit and the same total request cap apply. A crawl is the easiest way
 * to turn an assessment into something that looks like an attack.
 *
 * **It is bounded, and says what it did not see.** Three levels, twenty-five
 * pages. A route that exists behind a sign-in is not found here, and the
 * finding says that rather than concluding there is none.
 */
import type { ScopedHttp } from '../runtime/http.ts';

/** How far from the front door to walk, and how many pages to open. */
const MAX_DEPTH = 3;
const MAX_PAGES = 25;

/** The way out, by every name it is given. */
const CANCEL_LINK =
  /\b(cancel|unsubscribe|close (my )?account|delete (my )?account|end (your |my )?(subscription|membership|plan)|opt[- ]?out)\b/i;

/** What the euphemisms look like when somebody would rather you did not find it. */
const EUPHEMISM =
  /\b(manage (your )?(preferences|subscription|plan|membership)|account settings|billing settings|options|membership options)\b/i;

/** The way in. */
const SUBSCRIBE_LINK =
  /\b(subscribe|sign ?up|start (your )?(free )?trial|get started|pricing|plans?|upgrade|buy|join)\b/i;

/** A route that ends by asking somebody else to do it for you. */
const ASK_A_HUMAN =
  /\b(email us|write to us|contact (our |the )?(support|us|customer)|call us|telephone us|raise a ticket|submit a request|get in touch)\b[^.]{0,80}\b(to )?(cancel|unsubscribe|close|end)\b|\b(to )?(cancel|unsubscribe|close your account)\b[^.]{0,80}\b(email|contact|call|write to|phone)\b/i;

/** A form or button the user operates themselves. */
const SELF_SERVICE = /<(button|input[^>]+type=["']?submit)[^>]*>|<form\b/i;

export interface ExitCrawl {
  readonly routeFound: boolean;
  readonly selfService: boolean;
  readonly plainlyNamed: boolean;
  readonly clicksToCancel: number | null;
  readonly clicksToSubscribe: number | null;
  /** Where the way out was found, for the evidence trail. */
  readonly cancelUrl: string | null;
  readonly subscribeUrl: string | null;
  readonly pagesVisited: number;
  readonly evidenceIds: readonly string[];
}

interface Link {
  readonly href: string;
  readonly text: string;
}

/** Anchors, with the words a person would actually click. */
function linksOf(html: string, base: string): Link[] {
  const found: Link[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const raw = match[1]!;
    if (/^(mailto:|tel:|javascript:|#)/i.test(raw)) continue;
    let href: string;
    try {
      href = new URL(raw, base).toString();
    } catch {
      continue;
    }
    found.push({
      href,
      text: match[2]!
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120),
    });
  }
  return found;
}

const textOf = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ');

/**
 * Whether a page *offers* cancelling, rather than merely mentioning it.
 *
 * The distinction this was missing, and it broke the measurement in both
 * directions. A home page that links to "Cancel your subscription" mentions
 * cancelling; it is not the place you cancel. Treating it as the exit scored a
 * well-behaved site at zero clicks and then judged it not self-service, because
 * the home page has no form on it.
 *
 * A page offers cancelling when it says so *and* gives you a way to act — a
 * button to press, or an address to write to. The second is a worse answer and
 * is still an answer.
 */
function offersCancelling(html: string): { offers: boolean; selfService: boolean } {
  const body = textOf(html);
  if (!CANCEL_LINK.test(body)) return { offers: false, selfService: false };
  const askAHuman = ASK_A_HUMAN.test(body);
  const hasControl = SELF_SERVICE.test(html);
  return { offers: askAHuman || hasControl, selfService: hasControl && !askAHuman };
}

export async function crawlForTheExit(http: ScopedHttp, startUrl: string): Promise<ExitCrawl> {
  const origin = new URL(startUrl).origin;
  const seen = new Set<string>([startUrl]);
  const queue: { url: string; depth: number }[] = [{ url: startUrl, depth: 0 }];
  const evidenceIds: string[] = [];
  const fetched = new Map<string, string>();

  /*
   * Candidates, gathered and then confirmed — not latched onto.
   *
   * The first version took the first link that matched and stopped, which meant
   * a "Manage your membership" three pages from the real exit fixed both the
   * answer and the click count at the euphemism. A euphemism is a lead, not a
   * destination: it is followed, and it only counts once the page it reaches
   * actually offers a way out.
   */
  const candidates: { url: string; plain: boolean }[] = [];
  let subscribe: { url: string; depth: number } | null = null;
  let visited = 0;

  while (queue.length > 0 && visited < MAX_PAGES) {
    const next = queue.shift()!;
    let html: string;
    try {
      const response = await http.request(next.url, {
        summary: `Looking for the way out, ${next.depth} click(s) from the front door`,
        // Only the front door is kept as evidence; twenty-five copies of
        // somebody's marketing site is not a record, it is a bill.
        captureEvidence: next.depth === 0,
      });
      if (next.depth === 0) evidenceIds.push(response.evidenceId);
      if (response.status >= 400) continue;
      html = response.body;
    } catch {
      continue;
    }
    visited += 1;
    fetched.set(next.url, html);

    for (const link of linksOf(html, next.url)) {
      if (!link.href.startsWith(origin)) continue;
      const clean = link.href;

      if (CANCEL_LINK.test(link.text)) candidates.push({ url: clean, plain: true });
      else if (EUPHEMISM.test(link.text)) candidates.push({ url: clean, plain: false });

      if (!subscribe && SUBSCRIBE_LINK.test(link.text)) {
        subscribe = { url: clean, depth: next.depth + 1 };
      }

      if (next.depth + 1 <= MAX_DEPTH && !seen.has(clean) && seen.size < MAX_PAGES * 2) {
        seen.add(clean);
        queue.push({ url: clean, depth: next.depth + 1 });
      }
    }
  }

  // Confirm, shallowest first. The depth recorded is the depth of the page that
  // actually offers a way out, which is the number somebody would count.
  const depthOf = (url: string) => {
    const path = new URL(url).pathname.replace(/\/+$/, '');
    return path === '' ? 0 : path.split('/').filter(Boolean).length;
  };

  let confirmed: { url: string; depth: number; plain: boolean; selfService: boolean } | null = null;
  const ordered = [...new Map(candidates.map((c) => [c.url, c])).values()].sort(
    (a, b) => depthOf(a.url) - depthOf(b.url),
  );

  for (const candidate of ordered) {
    let html = fetched.get(candidate.url);
    if (html === undefined) {
      try {
        const response = await http.request(candidate.url, {
          summary: 'A page that might offer a way out',
          captureEvidence: false,
        });
        html = response.body;
        fetched.set(candidate.url, html);
      } catch {
        continue;
      }
    }
    const verdict = offersCancelling(html);
    if (!verdict.offers) continue;
    confirmed = {
      url: candidate.url,
      depth: depthOf(candidate.url),
      plain: candidate.plain,
      selfService: verdict.selfService,
    };
    break;
  }

  if (confirmed) {
    try {
      const response = await http.request(confirmed.url, {
        summary: 'The page that offers cancelling',
      });
      evidenceIds.push(response.evidenceId);
    } catch {
      // The measurement already stands; the evidence is a nicety.
    }
  }

  return {
    routeFound: confirmed !== null,
    selfService: confirmed?.selfService ?? false,
    plainlyNamed: confirmed?.plain ?? false,
    clicksToCancel: confirmed?.depth ?? null,
    clicksToSubscribe: subscribe ? depthOf(subscribe.url) : null,
    cancelUrl: confirmed?.url ?? null,
    subscribeUrl: subscribe?.url ?? null,
    pagesVisited: visited,
    evidenceIds,
  };
}
