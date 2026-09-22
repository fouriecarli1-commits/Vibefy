/**
 * The check you run on your own application before anybody else does.
 *
 * The consumer check answers a stranger's questions — can I cancel, is there a
 * human, who are these people. This answers the builder's, and the value of it
 * is entirely in being right about a page somebody is about to ship.
 *
 * Three things are held here, and only one of them is about the checks.
 *
 * The first is that it distinguishes. A free tool that finds six problems on
 * every page teaches people to ignore it by the second run, so there is a
 * fixture pair: a page with every first-look mistake on it, and the same page
 * after an hour of work. A check that fires on both has not been shown to see
 * anything.
 *
 * The second is that it never becomes the product. There is no score here and
 * nowhere in the shape to put one. A free thing that produces a number is a
 * free thing people screenshot, and then the number rather than the mark is
 * what VibefyCode means.
 *
 * The third is the line the brief draws. Nothing may be tested against a target
 * without a verified authorisation record, and this runs against a URL somebody
 * typed, which proves nothing about whose it is. Reading the page they gave us
 * is what every visitor does. Looking for files nobody linked to is not, and
 * the distance between those two is the distance between a free tool and a
 * scanner.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PREFLIGHT_LEGEND,
  PREFLIGHT_NOT_AN_ASSESSMENT,
  preflightItems,
  runChecks,
  type FetchedPage,
  type PreflightItem,
} from '../packages/trustcheck/src/index.ts';
import { messyPage, readyPage } from './fixtures/shippable-page.ts';

const messy = preflightItems(messyPage, 'http://my-app.example/');
const ready = preflightItems(readyPage, 'https://kettle.example/');

/** A page with exactly the markup a case is about, and nothing else. */
const pageWith = (html: string): FetchedPage => ({
  finalUrl: 'https://kettle.test/',
  status: 200,
  headers: {},
  html: `<!doctype html><html lang="en">${html}</html>`,
  redirected: false,
});

const outcome = (items: PreflightItem[], id: string) =>
  items.find((entry) => entry.id === id)?.outcome;

describe('the page that was shipped on a Friday', () => {
  it('notices it is not encrypted', () => {
    expect(outcome(messy, 'https')).toBe('missing');
    expect(outcome(ready, 'https')).toBe('ok');
  });

  it('notices nothing tells a phone how to size itself', () => {
    // One line, and most of what makes a page usable on a phone.
    expect(outcome(messy, 'phone')).toBe('missing');
    expect(outcome(ready, 'phone')).toBe('ok');
  });

  it('notices the page never says what it is', () => {
    expect(outcome(messy, 'says_what_it_is')).toBe('missing');
    expect(outcome(ready, 'says_what_it_is')).toBe('ok');
  });

  it('notices no language is declared', () => {
    expect(outcome(messy, 'language')).toBe('missing');
    expect(outcome(ready, 'language')).toBe('ok');
  });

  it('notices the headers a browser acts on are absent', () => {
    expect(outcome(messy, 'headers')).toBe('missing');
    expect(outcome(ready, 'headers')).toBe('ok');
  });

  it('notices a live key sitting in the page source', () => {
    expect(outcome(messy, 'left_in')).toBe('missing');
    expect(outcome(ready, 'left_in')).toBe('ok');
  });
});

describe('the page after an hour of work', () => {
  it('has nothing to go and fix', () => {
    // The half that makes the other half mean anything.
    expect(ready.filter((entry) => entry.outcome === 'missing')).toEqual([]);
  });
});

describe('what it says about a key it found', () => {
  it('says what kind, and never what it was', () => {
    /*
     * The whole reason this is a finding is that the value should not be
     * travelling. Echoing it into a page, a log or a screenshot moves it
     * further, and a truncated version is still a hint. So: the kind, and
     * nothing else.
     */
    const found = messy.find((entry) => entry.id === 'left_in')!;
    const everything = `${found.detail} ${found.fix} ${found.evidence.join(' ')}`;
    expect(everything).toContain('Stripe live secret key');
    expect(everything).not.toContain('sk_live_');
    expect(everything).toMatch(/not recorded the value/i);
  });

  it('tells somebody to rotate it rather than to hide it', () => {
    // A key that reached a visitor is already theirs. Moving it server-side
    // without rotating it is a fix that fixes nothing.
    expect(messy.find((entry) => entry.id === 'left_in')!.fix).toMatch(/rotate/i);
  });

  it('matches nothing on a page that has no key on it', () => {
    const plain = preflightItems(
      {
        ...readyPage,
        html: '<html lang="en"><head><title>A page about keys</title></head></html>',
      },
      'https://kettle.example/',
    );
    expect(outcome(plain, 'left_in')).toBe('ok');
  });
});

describe('an address that only works on the machine it was built on', () => {
  it('is worth a look rather than something to panic about', () => {
    const local = preflightItems(
      {
        ...readyPage,
        html: readyPage.html.replace(
          '</body>',
          '<script>fetch("http://localhost:3000/x")</script></body>',
        ),
      },
      'https://kettle.example/',
    );
    expect(outcome(local, 'left_in')).toBe('unclear');
  });
});

describe('every item earns its place', () => {
  it.each([...messy, ...ready].map((entry) => [entry.id, entry] as const))(
    '%s says what was seen',
    (_id, entry) => {
      expect(entry.question.endsWith('?'), entry.question).toBe(true);
      expect(entry.detail.length).toBeGreaterThan(30);
    },
  );

  it('tells somebody what to do about anything that is not fine', () => {
    // An objective eye that ends the paralysis rather than adding to it. A
    // list of what is wrong, with no next step, is the state somebody was
    // already in before they pasted the address.
    for (const entry of [...messy, ...ready]) {
      if (entry.outcome === 'ok') continue;
      expect(entry.fix, entry.id).toBeTruthy();
      expect(entry.fix!.length, entry.id).toBeGreaterThan(30);
    }
  });

  it('says nothing to do about something that is already fine', () => {
    for (const entry of ready.filter((candidate) => candidate.outcome === 'ok')) {
      expect(entry.fix, entry.id).toBeNull();
    }
  });
});

describe('what it must never be mistaken for', () => {
  const source = readFileSync(join(process.cwd(), 'packages/trustcheck/src/preflight.ts'), 'utf8');
  const page = readFileSync(join(process.cwd(), 'apps/web/app/pre-flight/page.tsx'), 'utf8');

  it('has no score, and nowhere to put one', () => {
    // Asserted on the shape rather than on the prose, which talks about the
    // absence of a score and would match a search for the word.
    const shape = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(shape).not.toMatch(/readonly\s+(score|percentage|percentile|band|rating)\b/i);
    expect(Object.keys(messy[0]!).sort()).toEqual(
      ['detail', 'evidence', 'fix', 'id', 'outcome', 'question'].sort(),
    );
  });

  it('says so on the page, before the form rather than after the result', () => {
    // Somebody hoping this is the real thing should find out before they run
    // it, not after they have screenshotted the output.
    expect(page.indexOf('not an assessment')).toBeLessThan(page.indexOf('form-heading'));
  });

  it('carries the legend wherever a result is shown', () => {
    expect(page).toContain('PREFLIGHT_LEGEND');
    expect(PREFLIGHT_LEGEND).toMatch(/not an assessment/i);
    expect(PREFLIGHT_LEGEND).toMatch(/no score/i);
    expect(PREFLIGHT_LEGEND).toMatch(/leads to no badge/i);
    expect(PREFLIGHT_NOT_AN_ASSESSMENT).toMatch(/prove the application is yours/i);
  });

  it('fetches once and probes nothing', () => {
    /*
     * The line the brief draws. We have no way of knowing the address somebody
     * pasted is theirs, so anything beyond what a visitor's browser does is
     * testing a stranger's application without their say-so.
     */
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code.match(/fetchPublicPage\(/g) ?? []).toHaveLength(1);
    expect(code).not.toMatch(/['"`]\/\.(?:git|env)/);
    expect(code).not.toMatch(/robots\.txt|sitemap\.xml|\.map['"`]/);
    // And the reason is written where somebody about to add a second fetch
    // would read it, rather than only being true today.
    expect(source).toMatch(/Nothing is probed/);
  });
});

describe('the header check and the fetcher agree on case', () => {
  /*
   * The headers this reads are looked up in lower case, and the fixture pair
   * supplies them that way — so a fetcher that handed over `Content-Security-
   * Policy` would make the check report all four as missing on every page on
   * the internet, and both halves of the fixture would still pass.
   *
   * It is the kind of mistake that is invisible in a test and obvious in
   * production, so the contract is pinned rather than assumed.
   */
  it('the fetcher lowercases what it hands over', () => {
    const fetcher = readFileSync(join(process.cwd(), 'packages/trustcheck/src/fetch.ts'), 'utf8');
    expect(fetcher).toMatch(/headers\[key\.toLowerCase\(\)\] = value/);
  });

  it('the check looks them up the same way', () => {
    const source = readFileSync(
      join(process.cwd(), 'packages/trustcheck/src/preflight.ts'),
      'utf8',
    );
    expect(source).toMatch(/page\.headers\[name\.toLowerCase\(\)\]/);
  });

  it('reports a header as present when it is there under that name', () => {
    const withOne = preflightItems(
      { ...readyPage, headers: { 'content-security-policy': "default-src 'self'" } },
      'https://kettle.example/',
    );
    const headers = withOne.find((item) => item.id === 'headers')!;
    expect(headers.detail).toContain('3 of the four');
    expect(headers.evidence).not.toContain('content-security-policy');
  });
});

describe('a meta tag written the other way round', () => {
  it('is read, because that is ordinary HTML', () => {
    // `<meta content="..." name="description">` is valid and several frameworks
    // emit it. A pattern that insists on one attribute order tells those
    // builders they have no description when they have one — and the fix it
    // offers is to add the thing they already added.
    const items = preflightItems(
      pageWith(
        '<head><title>Kettle Club</title><meta content="A kettle every month, delivered." name="description"></head><body><h1>Kettle</h1></body>',
      ),
      'https://kettle.test/',
    );
    const says = items.find((entry) => entry.id === 'says_what_it_is')!;
    expect(says.outcome).toBe('ok');
  });

  it('still says so when there really is none', () => {
    const items = preflightItems(
      pageWith('<head><title>Kettle Club</title></head><body><h1>Kettle</h1></body>'),
      'https://kettle.test/',
    );
    const says = items.find((entry) => entry.id === 'says_what_it_is')!;
    expect(says.outcome).toBe('unclear');
    expect(says.fix).toMatch(/meta description/i);
  });
});

describe('every borrowed question', () => {
  it('names a check that exists', () => {
    // A borrowed item whose source id no longer matches is dropped without a
    // word: the question simply stops appearing, and the summary counts one
    // fewer, with nothing anywhere saying a question went missing.
    const source = readFileSync('packages/trustcheck/src/preflight.ts', 'utf8');
    const borrowed = [...source.matchAll(/from: '([a-z_]+)'/g)].map((match) => match[1]!);
    expect(borrowed.length).toBeGreaterThan(0);
    const checks = runChecks(pageWith('<body>x</body>')).map((observation) => observation.id);
    for (const id of borrowed) expect(checks, id).toContain(id);
  });
});
