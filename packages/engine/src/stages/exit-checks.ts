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
import { classifyStop } from '../runtime/stop.ts';

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

/**
 * A mailing list is not the subscription.
 *
 * Every footer on the internet carries "Subscribe to our newsletter" and
 * "Unsubscribe", and both of them match the words this file looks for. Without
 * this, a pricing page's footer made it the place you join and an email
 * preferences link made it the way out.
 */
const MAILING_LIST =
  /\b(newsletter|mailing list|marketing emails?|email (updates|preferences)|our emails)\b/i;

/** The page's own title and its headings: what the page says it is about. */
const TITLE = /<title\b[^>]*>([\s\S]*?)<\/title>/i;
const HEADINGS = /<(h1|h2|h3)\b[^>]*>([\s\S]*?)<\/\1>/gi;

/** The controls a page offers, each read whole so a label or an action counts. */
const BUTTONS = /<button\b[^>]*>[\s\S]*?<\/button>/gi;
const SUBMITS = /<input\b[^>]*\btype=["']?submit["']?[^>]*>/gi;
const FORM_ACTIONS = /<form\b[^>]*\baction=["']([^"']*)["'][^>]*>/gi;

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
  /**
   * Why the front door could not be read, and null where it was.
   *
   * Without this a walk that read nothing came back as `routeFound: false`,
   * which is scored as "No route found" and published as a statement that a
   * company gives its customers no way to cancel. It is the difference between
   * looking and not finding, and not looking.
   */
  readonly unreadable: string | null;
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

/** Whether the page's title or one of its headings is about this. */
function saysItIsAbout(html: string, what: RegExp): boolean {
  const title = TITLE.exec(html)?.[1];
  if (title !== undefined && what.test(textOf(title))) return true;
  for (const heading of html.matchAll(HEADINGS)) {
    if (what.test(textOf(heading[2]!))) return true;
  }
  return false;
}

/**
 * Whether the page carries a control that is itself about this — a button
 * whose label says so, a submit whose value does, a form that posts to it.
 *
 * Read whole rather than by inner text, so an aria-label on an icon button
 * counts. The alternative — any form anywhere on the page — is what was here
 * before, and on an ordinary site the footer carries a newsletter form on
 * every page.
 */
function controlAbout(html: string, what: RegExp): boolean {
  const counts = (control: string) => what.test(control) && !MAILING_LIST.test(control);
  for (const button of html.matchAll(BUTTONS)) if (counts(textOf(button[0]))) return true;
  for (const submit of html.matchAll(SUBMITS)) if (counts(textOf(submit[0]))) return true;
  for (const form of html.matchAll(FORM_ACTIONS)) if (counts(form[1]!)) return true;
  return false;
}

/**
 * Whether a page *offers* cancelling, rather than merely mentioning it.
 *
 * The distinction this was missing, and it broke the measurement in both
 * directions. A home page that links to "Cancel your subscription" mentions
 * cancelling; it is not the place you cancel. Treating it as the exit scored a
 * well-behaved site at zero clicks and then judged it not self-service, because
 * the home page has no form on it.
 *
 * "Says so and has a form somewhere" was the first repair, and it is not
 * enough: the word appears in the footer of every page of an ordinary site, and
 * so does a newsletter form, which made every page of such a site the exit at
 * whatever depth it was first reached. So the page has to be *about* cancelling
 * — it is in the title or a heading, or there is a control that says so — or it
 * has to give you a person to ask. Asking a person is a worse answer and is
 * still an answer.
 */
function offersCancelling(html: string): { offers: boolean; selfService: boolean } {
  const body = textOf(html);
  if (!CANCEL_LINK.test(body)) return { offers: false, selfService: false };
  const askAHuman = ASK_A_HUMAN.test(body);
  const control = controlAbout(html, CANCEL_LINK);
  const about = control || saysItIsAbout(html, CANCEL_LINK);
  return { offers: about || askAHuman, selfService: control && !askAHuman };
}

/**
 * Whether a page offers joining, held to the same standard as the way out.
 *
 * The gap between the two is the measurement this whole file exists for, and
 * until now only one side of it was confirmed: the exit had to be a page that
 * really offered cancelling, while the entrance was whichever link said
 * "Pricing" first. A pricing page is usually a step on the way to the page you
 * actually join on, so the gap came out one click wider than it is — on every
 * site, in the direction that scores worse.
 */
function offersSubscribing(html: string): boolean {
  return controlAbout(html, SUBSCRIBE_LINK);
}

/**
 * Re-throws the three deliberate stops and swallows nothing else.
 *
 * A crawl catches per-page failures and walks on, which is right for a 404 and
 * wrong for a ceiling: the run has reached its spending cap or the intensity
 * the customer authorised, or the scope boundary has refused, and carrying on
 * means asking again forty-nine more times. The pipeline turns these into an
 * aborted run with a reason, and it can only do that if they are thrown.
 */
function rethrowIfStop(error: unknown): void {
  if (classifyStop(error) !== null) throw error;
}

export async function crawlForTheExit(http: ScopedHttp, startUrl: string): Promise<ExitCrawl> {
  const origin = new URL(startUrl).origin;
  const seen = new Set<string>([startUrl]);
  const queue: { url: string; depth: number }[] = [{ url: startUrl, depth: 0 }];
  const evidenceIds: string[] = [];
  const fetched = new Map<string, string>();
  let unreadable: string | null = 'the front door was never read';

  /*
   * Candidates, gathered and then confirmed — not latched onto.
   *
   * The first version took the first link that matched and stopped, which meant
   * a "Manage your membership" three pages from the real exit fixed both the
   * answer and the click count at the euphemism. A euphemism is a lead, not a
   * destination: it is followed, and it only counts once the page it reaches
   * actually offers a way out.
   */
  const candidates: { url: string; plain: boolean; depth: number }[] = [];
  /** Every page we read, and how many clicks from the front door it was. */
  const depthOf = new Map<string, number>();
  let visited = 0;

  while (queue.length > 0 && visited < MAX_PAGES) {
    const next = queue.shift()!;
    let html: string;
    try {
      const response = await http.request(next.url, {
        summary: `Looking for the way out, ${next.depth} click(s) from the front door`,
        // Only the front door keeps its body; twenty-five copies of somebody's
        // marketing site is not a record, it is a bill. Every exchange is still
        // recorded — what was asked for, and what came back.
        keepBody: next.depth === 0,
      });
      if (next.depth === 0) evidenceIds.push(response.evidenceId);
      if (response.status >= 400) {
        if (next.depth === 0) unreadable = `the front door answered ${response.status}`;
        continue;
      }
      if (next.depth === 0) unreadable = null;
      html = response.body;
    } catch (error) {
      rethrowIfStop(error);
      if (next.depth === 0) {
        unreadable = error instanceof Error ? error.message : String(error);
      }
      continue;
    }
    visited += 1;
    fetched.set(next.url, html);
    if (!depthOf.has(next.url)) depthOf.set(next.url, next.depth);

    for (const link of linksOf(html, next.url)) {
      if (!link.href.startsWith(origin)) continue;
      const clean = link.href;

      // The depth of the page that linked here, plus one: the number of clicks
      // from the front door, which is what somebody actually counts. Path
      // segments were standing in for this and are not the same thing — a site
      // can bury /cancel behind four pages, or link it from the footer of every
      // one.
      if (CANCEL_LINK.test(link.text)) {
        candidates.push({ url: clean, plain: true, depth: next.depth + 1 });
      } else if (EUPHEMISM.test(link.text)) {
        candidates.push({ url: clean, plain: false, depth: next.depth + 1 });
      }

      if (next.depth + 1 <= MAX_DEPTH && !seen.has(clean) && seen.size < MAX_PAGES * 2) {
        seen.add(clean);
        queue.push({ url: clean, depth: next.depth + 1 });
      }
    }
  }

  /** The body of a candidate page, from the crawl where possible. */
  const bodyOf = async (url: string, summary: string): Promise<string | null> => {
    const already = fetched.get(url);
    if (already !== undefined) return already;
    try {
      const response = await http.request(url, { summary, keepBody: false });
      fetched.set(url, response.body);
      return response.body;
    } catch (error) {
      rethrowIfStop(error);
      return null;
    }
  };

  /** Shallowest first, one entry per URL: the shortest path we saw to each. */
  const shallowestFirst = <T extends { url: string; depth: number }>(all: T[]): T[] => {
    const best = new Map<string, T>();
    for (const candidate of all) {
      const existing = best.get(candidate.url);
      if (!existing || candidate.depth < existing.depth) best.set(candidate.url, candidate);
    }
    return [...best.values()].sort((a, b) => a.depth - b.depth);
  };

  // Confirm, shallowest first. The depth recorded is that of the page which
  // actually offers a way out, reached by the shortest path we saw.
  let confirmed: { url: string; depth: number; plain: boolean; selfService: boolean } | null = null;
  for (const candidate of shallowestFirst(candidates)) {
    const html = await bodyOf(candidate.url, 'A page that might offer a way out');
    if (html === null) continue;
    const verdict = offersCancelling(html);
    if (!verdict.offers) continue;
    confirmed = {
      url: candidate.url,
      depth: candidate.depth,
      plain: candidate.plain,
      selfService: verdict.selfService,
    };
    break;
  }

  /*
   * The same standard for the way in, because the gap between the two is the
   * measurement, and a gap between a confirmed exit and an unconfirmed entrance
   * is not a fact about the site.
   *
   * Read from the pages already walked rather than from link text. The way out
   * has to be found by its name — that is what `plainlyNamed` measures — but
   * nothing depends on what the way in is called, and a link that says "Choose
   * Standard" is the way in just as much as one that says "Subscribe". No
   * request is made for this: every body is one the crawl already has.
   */
  let subscribe: { url: string; depth: number } | null = null;
  for (const [url, depth] of [...depthOf].sort((a, b) => a[1] - b[1])) {
    const html = fetched.get(url);
    if (html === undefined || !offersSubscribing(html)) continue;
    subscribe = { url, depth };
    break;
  }

  if (confirmed) {
    try {
      const response = await http.request(confirmed.url, {
        summary: 'The page that offers cancelling',
      });
      evidenceIds.push(response.evidenceId);
    } catch (error) {
      // The measurement already stands; the evidence is a nicety. A ceiling is
      // not, and still stops the run.
      rethrowIfStop(error);
    }
  }

  return {
    routeFound: confirmed !== null,
    selfService: confirmed?.selfService ?? false,
    plainlyNamed: confirmed?.plain ?? false,
    clicksToCancel: confirmed?.depth ?? null,
    clicksToSubscribe: subscribe?.depth ?? null,
    cancelUrl: confirmed?.url ?? null,
    subscribeUrl: subscribe?.url ?? null,
    pagesVisited: visited,
    evidenceIds,
    unreadable,
  };
}
