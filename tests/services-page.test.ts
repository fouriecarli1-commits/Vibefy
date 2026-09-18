/**
 * The page that says what we sell.
 *
 * There was no such page. Every service had one of its own and the only way to
 * learn the list existed was to open a menu and read eight links, each of which
 * assumed the reader already knew which one was theirs. Somebody arriving from
 * a badge, or from a search, has one question — what do you actually do — and
 * was being answered in fragments.
 *
 * Two things are worth holding here, and neither is about wording.
 *
 * The first is that a list of services is a list of promises. Every entry has
 * to say what it will not do, on the same page, in the same card. A limit that
 * lives only in the small print has told the reader twice: once generously and
 * once honestly, in that order, which is worse than not saying it at all.
 *
 * The second is that a service page which advertises a page that does not exist
 * is worse than no service page. So every link is checked against the routes on
 * disk rather than against a list somebody maintains by hand.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');
const page = read('apps/web/app/services/page.tsx');
const nav = read('apps/web/components/site-nav.tsx');

/** Every route with a page, as a URL path. */
const routes = (() => {
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
        found.push(prefix === '' ? '/' : prefix);
      }
    }
  };
  walk(join(process.cwd(), 'apps/web/app'), '');
  return found;
})();

const asPattern = (route: string) => new RegExp(`^${route.replace(/\[[^\]]+\]/g, '[^/]+')}$`);

/** The services, read out of the source rather than restated here. */
const services = [
  ...page.matchAll(/\{\s*href: '([^']+)',\s*name: '([^']+)',([\s\S]*?)\n  \},/g),
].map((match) => ({ href: match[1]!, name: match[2]!, body: match[3]! }));

describe('the list itself', () => {
  it('has services on it', () => {
    // Everything below passes vacuously otherwise, which is the worst outcome.
    expect(services.length).toBeGreaterThanOrEqual(8);
  });

  it('offers both halves of the audience', () => {
    // Somebody about to pay for a subscription and somebody who built an
    // application have almost nothing in common, and one list makes each of
    // them read the other's half.
    expect(page).toContain('If you built something');
    expect(page).toContain('If you are about to use something');
  });

  it('links only to pages that exist', () => {
    const broken = services
      .map((service) => service.href.split('?')[0]!)
      .filter((href) => !routes.some((route) => asPattern(route).test(href)));
    expect(broken, `Services linking nowhere: ${broken.join(', ')}`).toEqual([]);
  });
});

describe('every service says what it will not do', () => {
  it.each(services.map((service) => [service.name, service.body] as const))('%s', (_name, body) => {
    const not = /not: '([^']*(?:\\'[^']*)*)'/.exec(body);
    expect(not, 'no "what it is not" at all').not.toBeNull();
    // Long enough to be a limit rather than a gesture at one.
    expect(not![1]!.length).toBeGreaterThan(60);
  });

  it('says who each one is for, and what they end up with', () => {
    for (const service of services) {
      expect(service.body, `${service.name}: who`).toMatch(/who: '.{40,}/);
      expect(service.body, `${service.name}: get`).toMatch(/get: '.{40,}/);
    }
  });
});

describe('the limits are on the page, not only in the small print', () => {
  it('says plainly that none of it is a guarantee', () => {
    expect(page).toMatch(/nothing here is a guarantee/i);
  });

  it('says that nothing bought can move a score', () => {
    // The single claim the whole product rests on. A page that lists what we
    // sell is precisely where somebody will wonder.
    expect(page).toMatch(/Nothing you pay us can change a score/i);
    expect(page).toContain('/legal/rating-methodology-and-independence');
  });

  it('puts the limits after the services, not before them', () => {
    // Before them it is a disclaimer nobody reads. After them it is the last
    // thing on the page.
    expect(page.indexOf('What none of this is')).toBeGreaterThan(page.indexOf('If you built'));
  });
});

describe('somebody can find it', () => {
  it('is offered to a visitor, on its own rather than inside a menu', () => {
    expect(nav).toContain("href: '/services'");
    expect(nav).toMatch(/visitor: \[SERVICES_LINK\]/);
  });

  it('is offered to a customer too, who may not have read it either', () => {
    expect(nav).toMatch(/customer: \[SERVICES_LINK\]/);
  });
});
