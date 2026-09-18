/**
 * Plain language, enforced rather than intended.
 *
 * Anré asked for the language on this site to be understandable, and he is
 * right that it is not always. These pages are careful, and careful writing
 * about a careful subject gets long: the sentence that states a limit properly
 * is rarely the short one. The result is pages that are honest and hard work,
 * which is a poor trade for a reader who has not yet decided whether to care —
 * and worse for a reader taking English second.
 *
 * So every long public page opens with two to four short lines saying what it
 * is. The rule is held here rather than in somebody's head, because prose
 * drifts back towards whoever is writing it, and the person writing it is the
 * one who already knows what the page says.
 *
 * The one rule that is not about length: a summary that carries only the good
 * half is worse than no summary. If a page says a thing is limited, its
 * summary says so too — otherwise the limits become small print by layout.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appDir = join(process.cwd(), 'apps/web/app');
const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

/** Public pages, as file paths. The console and the operator screens are not public. */
const publicPages = (() => {
  const found: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const segment =
          entry.name.startsWith('(') || entry.name.startsWith('_')
            ? prefix
            : `${prefix}/${entry.name}`;
        walk(join(dir, entry.name), segment);
      } else if (entry.name === 'page.tsx') {
        found.push(`${prefix === '' ? '/' : prefix}|${join(dir, entry.name)}`);
      }
    }
  };
  walk(appDir, '');
  return found
    .map((entry) => {
      const [route, file] = entry.split('|');
      return { route: route!, file: file! };
    })
    .filter(({ route }) => !/^\/(console|admin|review|auth|invite)(\/|$)/.test(route));
})();

/**
 * Pages long enough that somebody needs a way in.
 *
 * Measured rather than listed: a page nobody has to scroll does not need a
 * summary, and a list of which pages are long is a list that goes stale the
 * first time somebody adds three sections.
 */
const LONG_ENOUGH_CHARS = 6000;

/** Public, long, and deliberately without one. Each needs a reason in writing. */
const EXCUSED: Readonly<Record<string, string>> = {
  '/legal':
    'An index of documents rather than a page with an argument. Each document it links to carries its own summary at the top, written by whoever drafted it.',
  '/legal/[slug]':
    'The legal documents themselves. A summary of a contract that sits above the contract is a second version of it, and a reader who relies on the wrong one has been misled by us rather than by the drafting.',
  '/a/[slug]':
    'The verification page is already written for a stranger who has never heard of us, and it opens with the tick list of what was checked. A second summary above that one would be a summary of a summary.',
  '/verify': 'One input and a sentence saying what to put in it. There is nothing to summarise.',
  '/trust-check/traps/[slug]':
    'Each of these pages is one worked example, and the example is the point. Summarising it would be telling the story twice.',
};

/** Words we use among ourselves that mean nothing on somebody's first visit. */
const JARGON = [
  'rubric',
  'criterion',
  'criteria',
  'remediation',
  'attestation',
  'provenance',
  'methodology',
  'deterministic',
  'idempotent',
  'canonical',
  'heuristic',
  'taxonomy',
  'point-in-time',
];

/** The summaries, read out of the pages rather than restated here. */
const summaries = publicPages
  .map(({ route, file }) => {
    const source = readFileSync(file, 'utf8');
    const block = /const IN_SHORT = \[([\s\S]*?)\n\];/.exec(source);
    const lines = block
      ? [...block[1]!.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)].map((match) =>
          (match[1] ?? match[2]!).replace(/\\'/g, "'"),
        )
      : null;
    return { route, source, lines };
  })
  .filter((page) => page.lines !== null) as {
  route: string;
  source: string;
  lines: string[];
}[];

describe('every long public page has a way in', () => {
  it('found the pages it is talking about', () => {
    expect(publicPages.length).toBeGreaterThan(10);
    expect(summaries.length).toBeGreaterThanOrEqual(8);
  });

  it('gives one to every long page, or says in writing why not', () => {
    const missing = publicPages
      .filter(({ route, file }) => {
        const source = readFileSync(file, 'utf8');
        return (
          source.length >= LONG_ENOUGH_CHARS && !source.includes('<InShort') && !(route in EXCUSED)
        );
      })
      .map(({ route }) => route);
    expect(
      missing,
      `Long public pages with no plain-language summary: ${missing.join(', ')}. Add <InShort lines={IN_SHORT} />, or excuse the page in this test with a reason.`,
    ).toEqual([]);
  });

  it('does not excuse a page without a reason', () => {
    for (const [route, reason] of Object.entries(EXCUSED)) {
      expect(reason.length, route).toBeGreaterThan(40);
    }
  });

  it('does not excuse a page that no longer exists', () => {
    const routes = publicPages.map(({ route }) => route);
    const gone = Object.keys(EXCUSED).filter((route) => !routes.includes(route));
    expect(gone, `Excused routes with no page: ${gone.join(', ')}`).toEqual([]);
  });
});

describe('the summaries are actually plain', () => {
  const each = summaries.flatMap((page) => page.lines.map((line) => [page.route, line] as const));

  it('has lines to check', () => {
    expect(each.length).toBeGreaterThan(20);
  });

  it.each(each)('%s — "%s"', (_route, line) => {
    const sentences = line.split(/(?<=[.?!])\s+/).filter(Boolean);
    for (const sentence of sentences) {
      const words = sentence.split(/\s+/).filter(Boolean);
      // Twenty words is where a sentence stops being one thought.
      expect(words.length, sentence).toBeLessThanOrEqual(20);
    }

    // A semicolon or a dash standing in for a full stop is a long sentence
    // wearing a disguise, and both are hard work for somebody reading slowly.
    expect(line, 'semicolon').not.toContain(';');
    expect(line, 'em dash').not.toContain('—');
    expect(line, 'parenthesis').not.toContain('(');

    for (const word of JARGON) {
      expect(line.toLowerCase(), `jargon: ${word}`).not.toContain(word);
    }
  });

  it('gives each page between two and four lines', () => {
    // One is a slogan. Five is the page again, in smaller type.
    for (const page of summaries) {
      expect(page.lines.length, page.route).toBeGreaterThanOrEqual(2);
      expect(page.lines.length, page.route).toBeLessThanOrEqual(4);
    }
  });
});

describe('a summary carries the limits too', () => {
  /*
   * The failure this is built against is not a wrong sentence. It is a true
   * summary that carries only the half somebody wants to hear, above a page
   * that then states the limit properly — which turns the limit into small
   * print by layout rather than by wording, and is the more effective way of
   * hiding it.
   */
  const refusal = /\b(not|never|cannot|no\b|only|nothing)\b/i;

  it.each(summaries.map((page) => [page.route, page.lines] as const))(
    '%s says what it will not do',
    (_route, lines) => {
      expect(lines.some((line) => refusal.test(line))).toBe(true);
    },
  );

  it('says on the home page that we do not call an application safe', () => {
    // The single most likely sentence for somebody to soften later.
    const home = summaries.find((page) => page.route === '/');
    expect(home?.lines.join(' ')).toMatch(/never say an app is safe/i);
  });

  it('says on the advertising page that money buys nothing but the space', () => {
    const advertise = summaries.find((page) => page.route === '/advertise');
    expect(advertise?.lines.join(' ')).toMatch(/cannot change a score/i);
  });
});

describe('the component itself', () => {
  const component = read('apps/web/components/in-short.tsx');

  it('is a labelled region rather than a decorated paragraph', () => {
    // Somebody using a screen reader should be able to skip it, which needs it
    // to be something they can find the edges of.
    expect(component).toContain('aria-labelledby');
    expect(component).toContain('<aside');
  });

  it('says In short, in those words', () => {
    expect(component).toContain('In short');
  });
});

describe('a word too specialised for a summary is a word we owe a definition', () => {
  /*
   * Banning these from the summaries is only half an answer. They are still
   * used in the body of those pages, and they have to be: "the list of checks,
   * each of which has a weight" is not a phrase anybody can write eleven times
   * on one page. So the ban and the glossary are the same list, and a word
   * added to one without the other is how a glossary comes to be missing
   * exactly the term somebody looked up.
   */
  const glossary = read('apps/web/app/glossary/page.tsx');
  const defined = [...glossary.matchAll(/term: '([^']+)'/g)].map((match) =>
    match[1]!.toLowerCase(),
  );

  it('found the glossary it is talking about', () => {
    expect(defined.length).toBeGreaterThan(15);
  });

  it.each(JARGON)('explains "%s"', (word) => {
    expect(defined).toContain(word.toLowerCase());
  });

  it('explains each word without leaning on the others', () => {
    // A glossary whose entries need each other is a glossary that is no use to
    // the person who actually needs one.
    const entries = [
      ...glossary.matchAll(/term: '([^']+)',\s*\n\s*plain:\s*\n?\s*'([\s\S]*?)',\n/g),
    ];
    expect(entries.length).toBeGreaterThan(15);
    for (const [, term, plain] of entries) {
      const others = defined.filter((word) => word !== term!.toLowerCase() && word.length > 6);
      const leaned = others.filter((word) => plain!.toLowerCase().includes(word));
      // One is a cross-reference. Three is a definition that defers.
      expect(leaned.length, `${term}: leans on ${leaned.join(', ')}`).toBeLessThanOrEqual(2);
    }
  });

  it('is reachable from every page', () => {
    const layout = read('apps/web/app/layout.tsx');
    expect(layout).toContain('href="/glossary"');
  });
});
