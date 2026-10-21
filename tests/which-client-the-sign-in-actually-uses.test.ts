/**
 * Every visible setting right, and the sign-in still refused.
 *
 * Three days went on a Google sign-in where the redirect address in Google
 * matched the one Supabase publishes, the host matched the configured origin,
 * and the provider was enabled — all three confirmed on the product's own
 * health page. The one field nobody can see from outside is the Client ID
 * pasted into Supabase, and the live error URL from 18 October carried a client
 * from a different Google project entirely. Every correct setting in the
 * project that was open was invisible to the flow.
 *
 * That answer is public and one request away. `/auth/v1/authorize` is where the
 * sign-in button sends a browser; it needs no key and answers with a redirect
 * carrying `client_id`, which is in the address bar of everybody who has ever
 * signed in. The refusal case is as useful: when Supabase will not hand back to
 * the address we ask for, it redirects with an error instead of to the
 * provider, which is the allow-list problem named from the only place that can
 * name it.
 *
 * Reading the redirect is a pure function so it can be held here without a
 * Supabase to talk to.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { projectNumberOf, readAuthorizeRedirect } from '../apps/web/lib/which-provider-client.ts';
import { commentsBlanked } from './setup/source.ts';

const GOOGLE =
  'https://accounts.google.com/o/oauth2/v2/auth?client_id=287952908294-076vcqlpotj8c5fuov6bej7mou510h0c.apps.googleusercontent.com' +
  '&redirect_uri=https%3A%2F%2Flaootpvjfsrvllmxjzgu.supabase.co%2Fauth%2Fv1%2Fcallback&response_type=code&scope=email+profile';

describe('what the authorize endpoint answers', () => {
  it('names the client the sign-in is actually using', () => {
    const read = readAuthorizeRedirect(302, GOOGLE);
    expect(read).toMatchObject({
      kind: 'provider',
      host: 'accounts.google.com',
      clientId: '287952908294-076vcqlpotj8c5fuov6bej7mou510h0c.apps.googleusercontent.com',
      redirectUri: 'https://laootpvjfsrvllmxjzgu.supabase.co/auth/v1/callback',
    });
  });

  it('names the project that client belongs to', () => {
    /*
     * The field that would have ended this in a minute. Two clients from two
     * Google projects look alike and are not interchangeable — a redirect
     * address added to one is invisible to the other — and the error URL of
     * 18 October carried 693137577488 while every client in the project being
     * edited began 287952908294.
     */
    expect(
      projectNumberOf('287952908294-076vcqlpotj8c5fuov6bej7mou510h0c.apps.googleusercontent.com'),
    ).toBe('287952908294');
    expect(
      projectNumberOf('693137577488-010m58tdtv9ppr6plkruha0oebahm7mq.apps.googleusercontent.com'),
    ).toBe('693137577488');
    expect(projectNumberOf(null)).toBeNull();
    expect(projectNumberOf('not-a-client-id')).toBeNull();
  });

  it('reads a refusal as a refusal, wherever it is carried', () => {
    // On the query when Supabase answers for itself, on the fragment when the
    // leg that failed is the one that returns tokens there.
    expect(
      readAuthorizeRedirect(
        302,
        'https://vibefycode.com/?error=validation_failed&error_description=redirect_to+is+not+allowed',
      ),
    ).toEqual({
      kind: 'refused',
      error: 'validation_failed',
      description: 'redirect_to is not allowed',
    });
    expect(readAuthorizeRedirect(302, 'https://vibefycode.com/#error=server_error')).toMatchObject({
      kind: 'refused',
      error: 'server_error',
    });
  });

  it('says it could not tell rather than inventing an answer', () => {
    // Each of these would otherwise read as "no client", which is a statement
    // about the configuration rather than about the question not being asked.
    expect(readAuthorizeRedirect(200, null).kind).toBe('unexpected');
    expect(readAuthorizeRedirect(500, null).kind).toBe('unexpected');
    expect(readAuthorizeRedirect(302, null).kind).toBe('unexpected');
    expect(readAuthorizeRedirect(302, 'not an address').kind).toBe('unexpected');
  });

  it('reports a redirect that names no client at all', () => {
    // A provider panel with the ID left out. Distinct from a refusal, and from
    // not having asked.
    const read = readAuthorizeRedirect(
      302,
      'https://accounts.google.com/o/oauth2/v2/auth?scope=email',
    );
    expect(read).toMatchObject({ kind: 'provider', clientId: null });
  });
});

describe('the page that asks it', () => {
  const page = commentsBlanked(readFileSync('apps/web/app/admin/health/page.tsx', 'utf8'));

  it('never follows the redirect it is reading', () => {
    // The answer is the redirect. Following it would send this server to the
    // provider for nothing.
    expect(page).toMatch(/redirect: 'manual'/);
  });

  it('asks for every provider that is turned on', () => {
    expect(page).toMatch(/providerClient\(provider\)/);
    expect(page).toMatch(/enabledProviders\(\)/);
  });

  it('answers it without a sign-in, which is when it is needed', () => {
    const open = page.slice(page.indexOf('if (!user)'), page.indexOf("platform_role !== 'admin'"));
    expect(open).toMatch(/providerClient\(/);
  });

  it('prints no secret, because it reads none', () => {
    // The client id is public — it is in the address bar of everybody who signs
    // in — and the secret is never on this path at all.
    expect(page).not.toMatch(/client_secret/i);
    expect(page).not.toMatch(/SERVICE_ROLE/);
  });
});
