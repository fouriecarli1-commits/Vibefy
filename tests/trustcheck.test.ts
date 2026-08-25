/**
 * The consumer trust check.
 *
 * Two things are being defended here and they pull in opposite directions.
 *
 * The first is the person about to hand over a card. The check has to be useful
 * to them — to answer "can I get out of this again?" in words they recognise.
 *
 * The second is everybody else: the company being looked at, who did not ask to
 * be, and our own network, because the URL comes from an anonymous box on a
 * public page. That makes it the most exposed input in the product, and the
 * tests spend more effort on what it refuses than on what it finds.
 */
import { describe, expect, it } from 'vitest';
import {
  ARTICLES_NOTE,
  CHECK_COUNT,
  TRAP_ARTICLES,
  TRUST_CHECK_LEGEND,
  TRUST_CHECK_NOT_A_BADGE,
  TrustCheckInputError,
  normaliseUrl,
  runChecks,
  runTrustCheck,
  type FetchedPage,
} from '../packages/trustcheck/src/index.ts';
import { lintText } from '../tools/copy-lint.mjs';

function page(html: string, overrides: Partial<FetchedPage> = {}): FetchedPage {
  return {
    finalUrl: 'https://kettle.example/',
    status: 200,
    headers: {},
    html,
    redirected: false,
    ...overrides,
  };
}

const outcome = (html: string, id: string) =>
  runChecks(page(html)).find((entry) => entry.id === id)!;

describe('what it refuses to look at', () => {
  it('refuses an address inside a private network', () => {
    // The whole attack: a stranger types an address that means something only
    // from inside our network, and we fetch it for them.
    for (const address of [
      'http://169.254.169.254/latest/meta-data/',
      'http://127.0.0.1:8080',
      'http://10.1.2.3',
      'https://192.168.0.1/admin',
    ]) {
      expect(() => normaliseUrl(address), address).toThrow(TrustCheckInputError);
    }
  });

  it('refuses a host with no domain in it', () => {
    // `localhost`, a container name, an internal short name — all of them are
    // addresses that only resolve to something from where we are standing.
    for (const address of ['localhost', 'http://db', 'intranet', 'https://gateway/']) {
      expect(() => normaliseUrl(address), address).toThrow(TrustCheckInputError);
    }
  });

  it('refuses a scheme that is not the web', () => {
    for (const address of ['file:///etc/passwd', 'ftp://example.com', 'gopher://example.com']) {
      expect(() => normaliseUrl(address), address).toThrow(TrustCheckInputError);
    }
  });

  it('drops credentials rather than forwarding them', () => {
    const url = normaliseUrl('https://user:secret@kettle.example/pricing');
    expect(url.username).toBe('');
    expect(url.password).toBe('');
    expect(url.toString()).not.toContain('secret');
  });

  it('accepts what a person would actually type', () => {
    expect(normaliseUrl('kettle.example').toString()).toBe('https://kettle.example/');
    expect(normaliseUrl('  https://kettle.example/pricing?ref=x  ').pathname).toBe('/pricing');
  });

  it('never uses the assessment pipeline', () => {
    // There is no authorisation here, so there is no assessment to run. The
    // import is narrowed to the egress guard so this cannot drift.
    const source = readSource('packages/trustcheck/src/fetch.ts');
    expect(source).toContain("from '@vibefycode/engine/scope'");
    expect(source).not.toMatch(/from '@vibefycode\/engine'/);
    for (const file of ['fetch.ts', 'checks.ts', 'run.ts', 'articles.ts']) {
      expect(readSource(`packages/trustcheck/src/${file}`)).not.toContain('runPipeline');
    }
  });
});

describe('what it tells the person', () => {
  it('finds a cancellation route when one is linked', () => {
    const found = outcome('<a href="/account/cancel">Cancel your plan</a>', 'cancellation');
    expect(found.outcome).toBe('found');
    expect(found.evidence.join(' ')).toContain('/account/cancel');
  });

  it('separates being told you can cancel from being shown where', () => {
    // "Cancel any time" with no link is the single most common line on exactly
    // the pages this check exists for.
    const unclear = outcome('<p>Cancel any time, no questions asked.</p>', 'cancellation');
    expect(unclear.outcome).toBe('unclear');
    expect(unclear.detail).toContain('not the same as being shown where');
  });

  it('does not count a no-reply address as somebody to contact', () => {
    const result = outcome('<a href="mailto:no-reply@kettle.example">Contact</a>', 'contact_email');
    expect(result.outcome).toBe('not_found');
  });

  it('reports a company name without a registration number as unclear', () => {
    const result = outcome('<footer>© Kettle Trading Pty Ltd</footer>', 'company_identity');
    expect(result.outcome).toBe('unclear');
    expect(result.detail).toContain('difficult to trace');
  });

  it('calls out a free trial that does not say what happens next', () => {
    const result = outcome('<h1>Start your free trial</h1>', 'recurring_payment');
    expect(result.outcome).toBe('unclear');
    expect(result.detail.toLowerCase()).toContain('the point at which people find');
  });

  it('credits a page that says the payment repeats, before you pay', () => {
    const result = outcome('<p>R99 per month until you cancel.</p>', 'recurring_payment');
    expect(result.outcome).toBe('found');
  });

  it('quotes what it matched, every time it claims a match', () => {
    // An observation without its evidence is an assertion, and this product
    // does not publish assertions about anybody.
    const html =
      '<a href="/cancel">Cancel</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a>' +
      '<a href="mailto:help@kettle.example">Help</a><p>R99 per month until you cancel.</p>';
    for (const entry of runChecks(page(html))) {
      if (entry.outcome === 'found' || entry.outcome === 'unclear') {
        expect(
          entry.evidence.length,
          `${entry.id} claims a match with no evidence`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('ignores text inside scripts', () => {
    const result = outcome('<script>var t = "cancel any time";</script>', 'cancellation');
    expect(result.outcome).toBe('not_found');
  });
});

describe('what it may never become', () => {
  it('produces counts, never a score', () => {
    const result = runChecks(page('<p>Nothing here.</p>'));
    const serialised = JSON.stringify(result);
    expect(serialised).not.toMatch(/"score"/);
    expect(serialised).not.toMatch(/"rating"/);
    expect(serialised).not.toMatch(/out of 100/i);
  });

  it('says plainly that it is not an assessment and not a badge', () => {
    expect(TRUST_CHECK_LEGEND).toContain('not an assessment');
    expect(TRUST_CHECK_LEGEND).toContain('Absence of a finding is not evidence of absence');
    expect(TRUST_CHECK_LEGEND).toContain('no liability');
    expect(TRUST_CHECK_NOT_A_BADGE).toContain('is not a');
    expect(TRUST_CHECK_NOT_A_BADGE).toContain('badge');
  });

  it('never reaches a verdict about the company', () => {
    // "No cancellation link was found" is a fact. "This app is a scam" is a
    // defamation claim about a named third party.
    const html = '<p>Nothing at all.</p>';
    const text = runChecks(page(html))
      .map((entry) => `${entry.question} ${entry.detail}`)
      .join(' ')
      .toLowerCase();
    for (const word of ['scam', 'fraud', 'dishonest', 'untrustworthy', 'avoid', 'dangerous']) {
      expect(text, `a check calls somebody "${word}"`).not.toContain(word);
    }
  });

  it('reports absence as absence of a finding', () => {
    const missing = runChecks(page('<p>Nothing at all.</p>')).filter(
      (entry) => entry.outcome === 'not_found',
    );
    expect(missing.length).toBeGreaterThan(3);
    for (const entry of missing) {
      expect(entry.detail, entry.id).toMatch(/was found|were found|found on this page|Nothing/i);
    }
  });

  it('passes the copy gate that governs everything else we publish', () => {
    const copy = [
      TRUST_CHECK_LEGEND,
      TRUST_CHECK_NOT_A_BADGE,
      ARTICLES_NOTE,
      ...runChecks(page('<p>x</p>')).map((entry) => `${entry.question} ${entry.detail}`),
    ].join('\n');
    expect(lintText(copy, 'trustcheck')).toEqual([]);
  });
});

describe('the articles about how people get caught', () => {
  it('names practices, never companies', () => {
    const all = JSON.stringify(TRAP_ARTICLES);
    expect(ARTICLES_NOTE).toContain('practices, not companies');
    // A capitalised name followed by a company form would be an accusation
    // against a real business.
    expect(all).not.toMatch(/\b[A-Z][a-z]+ (?:Pty Ltd|Ltd|Inc|LLC|GmbH)\b/);
  });

  it('gives each one something to actually do', () => {
    expect(TRAP_ARTICLES.length).toBeGreaterThanOrEqual(4);
    for (const article of TRAP_ARTICLES) {
      expect(article.howItWorks.length, article.slug).toBeGreaterThanOrEqual(3);
      expect(article.signs.length, article.slug).toBeGreaterThanOrEqual(3);
      expect(article.whatToDo.length, article.slug).toBeGreaterThanOrEqual(2);
    }
  });

  it('sends a recurring charge to the bank rather than to another email', () => {
    // The one piece of practical guidance that actually stops the money.
    const all = JSON.stringify(TRAP_ARTICLES) + ARTICLES_NOTE;
    expect(all.toLowerCase()).toContain('bank');
  });

  it('offers no legal advice', () => {
    expect(ARTICLES_NOTE).toContain('none of it is legal advice');
  });
});

describe('a run that cannot reach the site', () => {
  it('reports that as a finding rather than as an error', async () => {
    // A paid-for application whose site does not open is exactly what somebody
    // about to pay would want to know.
    const result = await runTrustCheck('https://this-domain-does-not-exist.invalid');
    expect(result.unreachable).not.toBeNull();
    expect(result.observations[0]!.id).toBe('reachable');
    expect(result.observations[0]!.outcome).toBe('not_found');
    expect(result.summary.highWeightMissing).toBeGreaterThan(0);
  }, 30_000);

  it('refuses a private address before any request leaves', async () => {
    await expect(runTrustCheck('http://169.254.169.254/')).rejects.toThrow(TrustCheckInputError);
  });

  it('checks every signal it declares', () => {
    expect(CHECK_COUNT).toBeGreaterThanOrEqual(9);
  });
});

function readSource(path: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('node:fs').readFileSync(require('node:path').join(process.cwd(), path), 'utf8');
}
