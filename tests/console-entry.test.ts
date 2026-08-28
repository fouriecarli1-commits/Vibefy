/**
 * The console keeps the promise the navigation makes about it.
 *
 * For its first weeks it did not. The overview queried `apps` and threw the
 * result away, nothing anywhere linked to `/console/apps/new`, and a notice at
 * the bottom said the assessment engine "arrives in M1" long after it had
 * shipped. The navigation described the page as "your applications and their
 * state" the entire time.
 *
 * That is a worse failure than a missing page. A missing page sends somebody
 * looking elsewhere; a page that quietly does not do what it says leaves them
 * certain they are the one who cannot find it.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const overview = read('apps/web/app/console/page.tsx');
const nav = read('apps/web/components/site-nav.tsx');

describe('the console overview', () => {
  it('offers the one action the console exists for', () => {
    expect(overview).toContain('/console/apps/new');
    expect(overview).toMatch(/Add an application/i);
  });

  it('renders the applications it queries', () => {
    // The query was there from the start. Reading rows and not drawing them is
    // the shape of this bug, so the assertion is that the data reaches the page
    // rather than that a query exists.
    expect(overview).toContain("from('apps')");
    expect(overview).toContain('primary_url');
    expect(overview).toMatch(/apps \?\? \[\]\)\.map/);
  });

  it('links each application to its own page', () => {
    expect(overview).toContain('/console/apps/${String(app.id)}');
  });

  it('says what to do when there is nothing to show', () => {
    // An empty list under a heading reads as broken. An empty state that names
    // the next step reads as waiting.
    expect(overview).toMatch(/Nothing here yet/i);
  });

  it('makes no claim about what has not been built', () => {
    // The old notice outlived three of the milestones it described. A page that
    // reports the roadmap has to be edited every time the roadmap moves, and it
    // never is — so it states none.
    expect(overview).not.toMatch(/arrive in M\d|not here yet/i);
  });
});

describe('every console page the navigation names exists', () => {
  const routes = readdirSync(join(process.cwd(), 'apps/web/app/console'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('['))
    .map((entry) => `/console/${entry.name}`);

  it('and every one it names is reachable without typing a URL', () => {
    for (const match of nav.matchAll(/href: '(\/console\/[a-z-]+)'/g)) {
      const route = match[1]!;
      expect(routes, `${route} is in the navigation`).toContain(route);
    }
  });
});
