/**
 * The free tools answer about a stranger's site. That answer is not published.
 *
 * `/trust-check?url=…` and `/pre-flight?url=…` fetch the address somebody typed
 * and print what its public page does and does not say. Both results are
 * shareable links, deliberately — that is how the tool actually gets used, and
 * it is why the form is a GET and works without JavaScript.
 *
 * Two things follow that nothing was handling.
 *
 *   · **It would be a published judgement about somebody who never asked.** An
 *     indexed page under our domain saying "Not found: a way to cancel" about a
 *     company, ranking for that company's name, is exactly what the brief rules
 *     out when it says the directory is first-party and consented. A tool that
 *     builds a shadow directory out of query strings is the same thing through
 *     a side door. The check is fine — it reads what any visitor could read —
 *     and publishing it is not.
 *   · **Each crawl makes us fetch the target again.** These URLs travel in
 *     messages and posts, where unfurlers and crawlers follow them. Indexed,
 *     that is a crawler walking other people's sites with our IP on every
 *     request, and the first we would hear of it is an abuse complaint.
 *
 * So a result page is `noindex, nofollow` and the landing page is not. The
 * landing pages are in the sitemap and have to stay indexable: they are how
 * somebody finds the tool at all.
 *
 * What this does not fix is the rate at which an anonymous caller can make us
 * fetch things. That needs shared state across serverless invocations, which is
 * a decision in `docs/OPEN_ITEMS.md` rather than something to invent in a page.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PUBLIC_PATHS, PRIVATE_PREFIXES } from '../apps/web/lib/sitemap-entries.ts';
import { withoutComments } from './setup/source.ts';

const PAGES = [
  { path: '/trust-check', file: 'apps/web/app/trust-check/page.tsx' },
  { path: '/pre-flight', file: 'apps/web/app/pre-flight/page.tsx' },
] as const;

describe('a result page', () => {
  for (const page of PAGES) {
    describe(page.path, () => {
      const code = withoutComments(readFileSync(page.file, 'utf8'));

      it('refuses indexing once an address has been asked about', () => {
        expect(code).toContain('generateMetadata');
        expect(code).toMatch(/robots: \{ index: false, follow: false \}/);
      });

      it('decides it from the parameter that triggers the fetch', () => {
        // Not from a header, a cookie or the referrer: the thing that makes
        // this page a judgement about somebody is `?url=`, so that is what
        // decides. `asked` is also what the body uses to run the check.
        expect(code).toMatch(/searchParams\?\.url/);
        expect(code).toMatch(/asked \? \{ \.\.\.metadata, robots/);
      });

      it('leaves the landing page indexable, because nobody can find it otherwise', () => {
        expect(code).toMatch(/: metadata;/);
        expect(PUBLIC_PATHS).toContain(page.path);
        for (const prefix of PRIVATE_PREFIXES) {
          expect(page.path.startsWith(prefix), `${page.path} under ${prefix}`).toBe(false);
        }
      });
    });
  }
});

describe('what the tools may reach at all', () => {
  const fetcher = withoutComments(readFileSync('packages/trustcheck/src/fetch.ts', 'utf8'));

  it('refuses a private address before and after a redirect', () => {
    // The defence that matters most on the most exposed input in the product,
    // asserted here because this file is about what these two pages expose.
    // `tests/trust-check.test.ts` holds the behaviour; this holds that both
    // checks are still there, on the input and on every hop.
    const refusals = [...fetcher.matchAll(/isPrivateAddress\(/g)];
    expect(refusals.length).toBeGreaterThanOrEqual(2);
    expect(fetcher).toContain('createScopedDispatcher');
  });

  it('stays bounded, so a hostile page cannot hold the request open', () => {
    expect(fetcher).toMatch(/MAX_REDIRECTS = \d/);
    expect(fetcher).toMatch(/TIMEOUT_MS = \d/);
    expect(fetcher).toMatch(/MAX_BYTES = \d/);
  });
});
