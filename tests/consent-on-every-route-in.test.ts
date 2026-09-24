/**
 * Nobody reaches the console without an acceptance on record.
 *
 * Signing in with a provider *creates* an account when there is not one already
 * — GoTrue does that unless sign-up is disabled — so the buttons on the sign-in
 * page could produce a new account with full console access and nothing
 * recording that anybody had agreed to anything.
 *
 * The password path could not do that: acceptance travels in the sign-up
 * metadata and `recordSignUpConsents` writes it down. The provider path had
 * `accepted` in the callback URL, and only the sign-up page put it there. So the
 * gap was narrow and it was in the worst place, on a table this product keeps
 * append-only precisely because the record is evidence. Evidence that exists for
 * most accounts is not a rule.
 *
 * The check is in the auth callback rather than on each console page, because
 * that is the one door every route that creates an account comes through — and a
 * check on the far side is one that whoever adds the tenth provider next year
 * has to remember.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('the door every new account comes through', () => {
  const callback = read('apps/web/app/auth/callback/route.ts');

  it('asks whether anything is missing before letting anybody past', () => {
    expect(callback).toContain('missingConsents()');
    // Before the redirect to `next`, not after it.
    expect(callback.indexOf('missingConsents()')).toBeLessThan(
      callback.lastIndexOf('NextResponse.redirect(`${origin}${next}`)'),
    );
  });

  it('sends them to accept rather than to the console', () => {
    expect(callback).toContain("new URL('/auth/accept', origin)");
    expect(callback).toMatch(/missing\.length > 0/);
  });

  it('materialises a password sign-up’s acceptance there too', () => {
    // The metadata exists at this point and has not been written down yet; the
    // console page that used to be the only caller runs later.
    expect(callback).toContain('recordSignUpConsents()');
  });
});

describe('the acceptance page', () => {
  const page = read('apps/web/app/auth/accept/page.tsx');
  const action = read('apps/web/app/auth/accept/actions.ts');

  it('does not hold somebody who has already accepted', () => {
    // Reachable by typing the address. A wall with nothing behind it is a bug
    // that looks like a rule.
    expect(page).toMatch(/missingConsents\(\)\)\.length === 0\) redirect\(destination\)/);
  });

  it('resolves its destination against our own origin only', () => {
    // An open redirect on a page people arrive at mid-sign-in is how phishing
    // gets a foothold — the same rule the callback already keeps.
    expect(page).toMatch(/startsWith\('\/'\) && !next\.startsWith\('\/\/'\)/);
  });

  it('shows the version of each document it is about to record', () => {
    expect(page).toContain('consentPayload()');
    expect(page).toMatch(/Version \{entry\.version\}/);
  });

  it('takes the version from the registry, never from the caller', () => {
    // A client that could name the version it accepted could name an older one.
    expect(action).toContain('consentPayload()');
    expect(action).not.toMatch(/formData|searchParams|request\./);
  });

  it('refuses rather than continuing when the write fails', () => {
    // An acceptance we failed to write is an account that carries on looking
    // accepted, which is what this whole path exists to prevent.
    expect(action).toMatch(/if \(error\) return \{ error:/);
  });

  it('is one button, and the button is the acceptance', () => {
    // A checkbox beside a button records that somebody found the checkbox.
    const form = read('apps/web/components/accept-form.tsx');
    expect(form).not.toMatch(/type="checkbox"/);
    expect(form).toMatch(/Continuing records your acceptance/);
  });
});

describe('the redirect URI, which is the thing people get wrong', () => {
  it('is printed whether or not any provider is off', () => {
    /*
     * It used to appear only in the block for providers that are not enabled,
     * and the person who needs it most is the opposite one: somebody whose
     * provider is on, whose button appears, and who gets
     * `Error 400: redirect_uri_mismatch` — which means the provider's own
     * console has the application's address where Supabase's belongs.
     */
    const tool = read('tools/providers.mjs');
    const printedAlways = tool.slice(0, tool.indexOf('const off = PROVIDERS.filter'));
    expect(printedAlways).toContain('/auth/v1/callback');
    expect(printedAlways).toMatch(/redirect_uri_mismatch/);
    expect(printedAlways).toMatch(/no trailing slash/);
  });
});
