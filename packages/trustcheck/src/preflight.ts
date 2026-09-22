/**
 * The check you run on your own application before anybody else does.
 *
 * The consumer trust check beside this one answers a stranger's questions: can
 * I cancel, is there a human, who are these people. This answers the builder's,
 * and they are different questions — it is the same machinery pointed the other
 * way round.
 *
 * Everything here comes out of **one response**. The page is fetched once,
 * exactly as a browser would, and every answer is read from those bytes and
 * those headers. Nothing is probed: no `/.git`, no `/.env`, no guessed paths.
 * That is not caution about false positives, it is the line the brief draws —
 * nothing may be tested against a target without a verified authorisation
 * record, and this runs against a URL somebody typed, which proves nothing
 * about who they are. Reading a public page is what every visitor does.
 * Looking for files nobody linked to is not, and it is the difference between
 * a free tool and a scanner.
 *
 * What it is not, said in its own type: there is no score, no percentage, no
 * band and no badge, and nowhere to put one. A free thing that produces a
 * number becomes the product, and the mark stops meaning anything.
 */
import { runChecks } from './checks.ts';
import { fetchPublicPage, normaliseUrl } from './fetch.ts';
import { TrustCheckInputError, type Observation } from './types.ts';

export type PreflightOutcome = 'ok' | 'missing' | 'unclear';

export interface PreflightItem {
  readonly id: string;
  /** The question in the builder's words. */
  readonly question: string;
  readonly outcome: PreflightOutcome;
  /** One sentence saying what was seen, and what it means for a visitor. */
  readonly detail: string;
  /** What to do about it, where there is something to do. */
  readonly fix: string | null;
  /** What we actually saw, quoted so somebody can check us. */
  readonly evidence: readonly string[];
}

export interface PreflightResult {
  readonly requestedUrl: string;
  readonly finalUrl: string | null;
  readonly checkedAt: string;
  readonly items: readonly PreflightItem[];
  /** Counts, never a score. The moment this is one number it is a rating. */
  readonly summary: { readonly ok: number; readonly missing: number; readonly unclear: number };
  readonly unreachable: string | null;
}

/** Said on every surface that shows a result, verbatim rather than paraphrased. */
export const PREFLIGHT_LEGEND =
  'This looks at one page of your application, from outside, once. It is not an assessment, it produces no score and it leads to no badge. It reports what that page does and does not say. Something not found here may exist elsewhere on your site, behind a sign-in, or in a file this did not open — absence of a finding is not evidence of absence.';

export const PREFLIGHT_NOT_AN_ASSESSMENT =
  'An assessment is a different thing: you prove the application is yours, you say what is in scope, the whole rubric is run against it over a period rather than in one request, and a person reviews the findings before anything is published. This is a few seconds of looking at one page.';

/**
 * Strings whose shape is unambiguous. Nothing here matches an ordinary word.
 *
 * Deliberately short. A long list assembled from a secret-scanning tool finds
 * more and will eventually tell somebody their own page is leaking a key
 * because a base64 image happened to look like one — and a free tool that cries
 * wolf on the first run is a free tool nobody runs twice. The value is never
 * echoed back, not even truncated: the whole point is that it should not be
 * travelling, and we are not going to move it further.
 */
const SECRET_SHAPES: readonly { label: string; pattern: RegExp }[] = [
  { label: 'a Stripe live secret key', pattern: /\bsk_live_[A-Za-z0-9]{16,}/ },
  { label: 'an AWS access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'a Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { label: 'a GitHub personal access token', pattern: /\bghp_[A-Za-z0-9]{36}\b/ },
  { label: 'a Slack bot token', pattern: /\bxoxb-[0-9]{10,}-[0-9]{10,}-[A-Za-z0-9]{20,}/ },
  { label: 'a private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

/** Addresses that only mean something on the machine the page was built on. */
const LOCAL_ADDRESS = /\b(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?\b/i;

const item = (
  id: string,
  question: string,
  outcome: PreflightOutcome,
  detail: string,
  fix: string | null,
  evidence: readonly string[] = [],
): PreflightItem => ({ id, question, outcome, detail, fix, evidence });

interface Page {
  readonly finalUrl: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly html: string;
  readonly redirected: boolean;
}

/** The builder's questions, answered from the one response. */
/** The content of a named meta tag, whichever order its attributes are in. */
function metaContent(html: string, name: string): string {
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const text = tag[0];
    const named = new RegExp(`\\bname\\s*=\\s*["']${name}["']`, 'i').test(text);
    if (!named) continue;
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(text);
    if (content) return content[1]!.trim();
  }
  return '';
}

export function preflightItems(page: Page, requestedUrl: string): PreflightItem[] {
  const html = page.html;
  const header = (name: string) => page.headers[name.toLowerCase()] ?? null;
  const items: PreflightItem[] = [];

  // 1. It answered, and with something.
  items.push(
    page.status >= 400
      ? item(
          'answers',
          'Does the address work at all?',
          'missing',
          `The server answered ${page.status}. Anybody following this link sees an error page rather than your application.`,
          'Check the address you are sharing, and that whatever hosts it is running.',
          [`HTTP ${page.status}`],
        )
      : item(
          'answers',
          'Does the address work at all?',
          'ok',
          `The server answered ${page.status}, so the link works and a visitor gets a page rather than an error.`,
          null,
          [`HTTP ${page.status}`],
        ),
  );

  // 2. Encrypted, and it stays that way.
  const encrypted = page.finalUrl.startsWith('https://');
  const upgraded = requestedUrl.startsWith('http://') && encrypted;
  items.push(
    encrypted
      ? item(
          'https',
          'Is the connection encrypted?',
          'ok',
          upgraded
            ? 'It is, and an unencrypted address is sent to the encrypted one, which is what should happen — an old link somebody saved still ends up in the right place.'
            : 'It is. Anything typed into this page, including a password, is encrypted on the way.',
          null,
          [page.finalUrl],
        )
      : item(
          'https',
          'Is the connection encrypted?',
          'missing',
          'This page was served without encryption. Everything typed into it, including a password, travels in the clear, and browsers now say so to the visitor.',
          'Put it behind HTTPS. Every hosting platform issues a certificate at no cost, and most do it for you.',
          [page.finalUrl],
        ),
  );

  // 3. It says what it is.
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? '';
  // Read whichever way round the attributes are written. `<meta content="..."
  // name="description">` is ordinary HTML and several frameworks emit it, and
  // a pattern that insists on one order tells those builders they have no
  // description when they have one — which is a fix they cannot find.
  const description = metaContent(html, 'description');
  items.push(
    title.length > 2
      ? item(
          'says_what_it_is',
          'Does it say what it is?',
          description.length > 20 ? 'ok' : 'unclear',
          description.length > 20
            ? 'There is a title and a description, so a search result and a shared link both say something.'
            : 'There is a title, but no description. A link shared in a chat or a search result will show the address instead of a sentence.',
          description.length > 20
            ? null
            : 'Add a meta description of a sentence or two. It is the line people read before deciding whether to click.',
          [title].filter(Boolean),
        )
      : item(
          'says_what_it_is',
          'Does it say what it is?',
          'missing',
          'The page has no title. A browser tab, a bookmark and a search result all show the address instead.',
          'Give the page a <title> saying what the application is.',
        ),
  );

  // 4. A phone.
  const viewport = /<meta[^>]+name=["']viewport["'][^>]*>/i.test(html);
  items.push(
    viewport
      ? item(
          'phone',
          'Will it work on a phone?',
          'ok',
          'The page tells a phone how to size itself, which is the setting that stops it rendering as a shrunken desktop page.',
          null,
        )
      : item(
          'phone',
          'Will it work on a phone?',
          'missing',
          'There is no viewport setting, so a phone will render this as a shrunken desktop page and the visitor will have to pinch to read it. This one line is most of what makes a page usable on a phone.',
          'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the head.',
        ),
  );

  // 5. A language, for anybody not reading it with their eyes.
  const lang = /<html[^>]+lang=["']([^"']+)["']/i.exec(html)?.[1] ?? '';
  items.push(
    lang
      ? item(
          'language',
          'Does it say what language it is in?',
          'ok',
          `Declared as “${lang}”, so a screen reader knows how to pronounce it and a browser knows whether to offer a translation.`,
          null,
          [lang],
        )
      : item(
          'language',
          'Does it say what language it is in?',
          'missing',
          'The page does not say what language it is written in. A screen reader then guesses, and reads English in a French accent or the other way round.',
          'Add lang to the <html> element — lang="en" for English.',
        ),
  );

  // 6. The headers a browser acts on.
  const missingHeaders = (
    [
      ['content-security-policy', 'tells the browser which scripts may run'],
      ['strict-transport-security', 'stops a first visit going over plain HTTP'],
      ['x-content-type-options', 'stops the browser guessing a file is a script'],
      ['referrer-policy', 'stops the address of your page leaking to other sites'],
    ] as const
  ).filter(([name]) => header(name) === null);
  items.push(
    missingHeaders.length === 0
      ? item(
          'headers',
          'Does it tell the browser how to protect the visitor?',
          'ok',
          'All four of the headers a browser acts on are set.',
          null,
        )
      : item(
          'headers',
          'Does it tell the browser how to protect the visitor?',
          missingHeaders.length >= 3 ? 'missing' : 'unclear',
          `${missingHeaders.length} of the four headers a browser acts on are not set here: ${missingHeaders
            .map(([name, why]) => `${name}, which ${why}`)
            .join('; ')}.`,
          'Most hosting platforms set these in one configuration file. They cost nothing and they are the cheapest hardening available.',
          missingHeaders.map(([name]) => name),
        ),
  );

  // 7. Something left in.
  const leftIn: string[] = [];
  for (const shape of SECRET_SHAPES) {
    // The value is never captured, only the fact and the kind.
    if (shape.pattern.test(html)) leftIn.push(shape.label);
  }
  const localAddress = LOCAL_ADDRESS.exec(html)?.[0] ?? null;
  items.push(
    leftIn.length > 0
      ? item(
          'left_in',
          'Is anything in the page that should not be?',
          'missing',
          `The page source contains ${leftIn.join(', ')}. Anything in a page a visitor loads is a thing that visitor has. We have not recorded the value and it is not shown here, because the point is that it should not be travelling.`,
          'Treat it as already public: rotate it, then move it to the server side. A key in a page cannot be protected by anything the page does.',
          leftIn,
        )
      : localAddress
        ? item(
            'left_in',
            'Is anything in the page that should not be?',
            'unclear',
            `The page refers to ${localAddress}, which only means something on the machine it was built on. For everybody else that link or request goes nowhere.`,
            'Point it at the address the application actually runs on, and check the rest of the page for the same thing.',
            [localAddress],
          )
        : item(
            'left_in',
            'Is anything in the page that should not be?',
            'ok',
            'Nothing with the shape of a key, and no address that only works on your own machine.',
            null,
          ),
  );

  return items;
}

/** The questions the consumer check already answers well, kept as they are. */
const BORROWED: readonly {
  id: string;
  from: Observation['id'];
  question: string;
  fix: string;
}[] = [
  {
    id: 'contact',
    from: 'contact_email',
    question: 'Can a stranger reach a person?',
    fix: 'Publish an address that reaches somebody. A form with no confirmation, or a no-reply address, is not a route.',
  },
  {
    id: 'privacy',
    from: 'privacy_policy',
    question: 'Do you say what you do with people’s data?',
    fix: 'Publish a privacy policy and link it where somebody signs up, not only in the footer.',
  },
  {
    id: 'cancellation',
    from: 'cancellation',
    question: 'Can somebody who subscribed get out again?',
    fix: 'Put the way out where the way in was. If somebody can start in two clicks, they should not need an email and five working days to stop.',
  },
];

const OUTCOME_FROM: Readonly<Record<string, PreflightOutcome>> = {
  found: 'ok',
  not_found: 'missing',
  unclear: 'unclear',
};

export async function runPreflight(
  rawUrl: string,
  now: Date = new Date(),
): Promise<PreflightResult> {
  const url = normaliseUrl(rawUrl);
  const requestedUrl = url.toString();
  const checkedAt = now.toISOString();

  let page: Page;
  try {
    page = await fetchPublicPage(url);
  } catch (error) {
    return {
      requestedUrl,
      finalUrl: null,
      checkedAt,
      items: [],
      summary: { ok: 0, missing: 0, unclear: 0 },
      unreachable:
        error instanceof TrustCheckInputError
          ? error.message
          : `That address could not be opened: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const borrowed = runChecks(page);
  const items: PreflightItem[] = [
    ...preflightItems(page, requestedUrl),
    ...BORROWED.flatMap((entry) => {
      const observation = borrowed.find((candidate) => candidate.id === entry.from);
      if (!observation) return [];
      const outcome = OUTCOME_FROM[observation.outcome] ?? 'unclear';
      return [
        item(
          entry.id,
          entry.question,
          outcome,
          observation.detail,
          outcome === 'ok' ? null : entry.fix,
          observation.evidence,
        ),
      ];
    }),
  ];

  return {
    requestedUrl,
    finalUrl: page.finalUrl,
    checkedAt,
    items,
    summary: {
      ok: items.filter((entry) => entry.outcome === 'ok').length,
      missing: items.filter((entry) => entry.outcome === 'missing').length,
      unclear: items.filter((entry) => entry.outcome === 'unclear').length,
    },
    unreachable: null,
  };
}
