/**
 * The questions a grey badge cannot answer, asked inside the product.
 *
 * `docs/DOEN.md` sends the founder to a Vercel log to find out why a badge is
 * grey: a private window, a time picker set to Live, the request row, a panel
 * three clicks down. Four rounds of that in a week, to read one sentence the
 * running deployment already knows — and the greyness itself says only "we
 * could not look", which is the one thing it is least useful to know.
 *
 * `/admin/health` asks those questions on the request: is the connection
 * string set and is its shape right, can Supabase be reached over HTTPS, which
 * of the badge's two routes answers, are the signing keys published, and is
 * there a badge to look at at all. The last one matters because the two causes
 * are indistinguishable from outside: the route cannot answer, or nothing has
 * ever been issued.
 *
 * What this file holds is the part that would go wrong quietly: the page
 * printing a secret, a count it could not read reported as a zero, a check
 * writing its own explanation instead of using the shared one, and an
 * administrator page nothing links to.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withoutComments } from './setup/source.ts';

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8');
const page = withoutComments(read('apps/web/app/admin/health/page.tsx'));
const layout = withoutComments(read('apps/web/app/admin/layout.tsx'));

describe('who may read it', () => {
  it('sends a stranger to sign in', () => {
    expect(page).toContain("redirect('/sign-in?next=/admin/health')");
  });

  it('refuses anybody who is not an administrator', () => {
    // Not a reviewer either: these sentences are about our own plumbing.
    expect(page).toContain("profile?.platform_role !== 'admin'");
  });
});

describe('what it prints', () => {
  it('never prints the value of a variable', () => {
    // The whole page is about environment variables, which is exactly how a
    // connection string ends up on a screen somebody screenshots. It may say
    // whether a variable is set and what is wrong with its shape, and nothing
    // more — so no `process.env` value may reach the markup.
    const rendered = page.slice(page.indexOf('return ('));
    expect(rendered).not.toContain('process.env');
    for (const name of [
      'SUPABASE_DB_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'VIBEFYCODE_BADGE_PUBLIC_KEYS',
    ]) {
      // Named in prose is fine; interpolated is not.
      expect(page).not.toContain(`{process.env.${name}}`);
    }
  });

  it('uses the shared explanations rather than writing its own', () => {
    // `whyTheDatabaseRefused` exists because a tripped pooler breaker reads
    // exactly like our own bad password. A second copy of that sentence here
    // would be a second copy to keep in step.
    expect(page).toContain('whatIsWrongWithTheConnectionString');
    expect(page).toContain('whyTheDatabaseRefused');
    expect(page).toContain('loadPublishedKeys');
    expect(page).toContain('lookUpBadgeVerification');
  });

  it('separates the three answers a badge lookup can give', () => {
    // Direct, the spare route, and neither — which is the distinction the grey
    // frame destroys and the reason this page exists.
    expect(page).toContain("source === 'direct'");
    expect(page).toMatch(/Supabase’s API/);
    expect(page).toContain('Neither route answered');
  });

  it('prints the address a provider console has to carry', () => {
    /*
     * Google answered "Error 400: redirect_uri_mismatch" and the sign-in was
     * dead, which also locked this page — it needs an administrator. The
     * mismatch is never about this deployment: the address Google is handed is
     * Supabase's own callback, and it has to be in the OAuth client's
     * authorised list in Google Cloud. Printing the exact string beats
     * remembering its shape while reading an error page.
     */
    expect(page).toContain('/auth/v1/callback');
    expect(page).toContain('redirect_uri_mismatch');
    expect(page).toContain('enabledProviders');
  });

  it('reports a count it could not read as that, not as none', () => {
    // A zero reads as "nothing exists", and under row-level security a read
    // that returns nothing is not the same statement.
    expect(page).toContain('cannot tell');
    expect(page).toContain('badgeError');
  });

  it('says a private key in a public variable is a thing to fix', () => {
    // `loadPublishedKeys` separates this case already; the page must not fold
    // it in with "no keys published", which has a different remedy.
    expect(page).toContain('carriedPrivate');
    expect(page).toContain('badge:keygen');
  });
});

describe('finding it at all', () => {
  it('links every administrator page from the administrator nav', () => {
    for (const href of [
      '/admin/health',
      '/admin/accounts',
      '/admin/costs',
      '/admin/sponsorships',
    ]) {
      expect(layout).toContain(`href: '${href}'`);
    }
  });

  it('links nothing that is not a page', () => {
    // Read off the nav rather than listed again here: a link to a page that
    // does not exist is a 404 somebody meets while looking for the thing that
    // tells them what is wrong.
    const hrefs = [...layout.matchAll(/href: '([^']+)'/g)].map((match) => match[1]!);
    expect(hrefs.length).toBeGreaterThanOrEqual(4);
    for (const href of hrefs) {
      expect(
        existsSync(join(root, 'apps/web/app', href, 'page.tsx')),
        `${href} is in the admin nav and has no page`,
      ).toBe(true);
    }
  });
});
