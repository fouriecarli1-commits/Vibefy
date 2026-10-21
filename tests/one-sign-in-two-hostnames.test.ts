/**
 * A sign-in started on one hostname and finished on another.
 *
 * `vibefycode.com` and `www.vibefycode.com` both answer, and the Google client
 * lists both as origins. The provider button built its hand-back address from
 * `window.location.origin` — whichever of the two the visitor happened to be
 * on — and the two are not interchangeable:
 *
 *   · Supabase refuses a `redirect_to` outside its allow-list and falls back to
 *     the Site URL, so the visitor lands somewhere with nothing on the address.
 *     That is the "this link arrived with nothing on it to exchange" page, for
 *     a sign-in that never visibly failed;
 *   · the PKCE verifier is kept in a cookie on the host that starts the flow,
 *     and a cookie set on `www.` is not sent to the apex. Even an allowed
 *     redirect then reaches a callback that cannot finish it.
 *
 * Neither is visible to the person: they press a button and arrive back at the
 * sign-in page. Both are fixed the same way — the flow starts on the host this
 * deployment calls its own, and then the verifier, the hand-back and the
 * session cookie are all on one host.
 *
 * `NEXT_PUBLIC_SITE_URL` is what says which host that is. When it says nothing
 * the current origin is the only answer available, so nothing changes, which is
 * why this cannot make a working deployment worse.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { isPlaceholderOrigin, siteOriginFor } from '../apps/web/lib/verify-origin.ts';
import { commentsBlanked } from './setup/source.ts';

const kept = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  if (kept === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = kept;
});

describe('which host a sign-in starts on', () => {
  it('is the configured one, whichever the visitor arrived at', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://vibefycode.com';
    // The browser has no request to read a host from, so the configured value
    // is the whole answer there.
    expect(siteOriginFor(null)).toBe('https://vibefycode.com');
    expect(isPlaceholderOrigin(siteOriginFor(null))).toBe(false);
  });

  it('tolerates the shapes somebody actually types into that variable', () => {
    for (const written of [
      'vibefycode.com',
      'https://vibefycode.com/',
      'https://vibefycode.com/console',
    ]) {
      process.env.NEXT_PUBLIC_SITE_URL = written;
      expect(siteOriginFor(null), written).toBe('https://vibefycode.com');
    }
  });

  it('says nothing usable when the variable says nothing', () => {
    // The case that must change no behaviour: with nothing configured and no
    // host to read, the resolver answers its placeholder, and the button is
    // required to notice that rather than redirect somewhere invented.
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(isPlaceholderOrigin(siteOriginFor(null))).toBe(true);
  });
});

describe('the button that starts it', () => {
  const button = commentsBlanked(readFileSync('apps/web/components/provider-button.tsx', 'utf8'));

  it('moves to the configured host before asking the provider for anything', () => {
    const moved = button.indexOf('location.replace');
    const asked = button.indexOf('signInWithOAuth');
    expect(moved, 'the button never leaves the hostname it was pressed on').toBeGreaterThan(-1);
    expect(
      moved,
      'it asks the provider first, which is the thing that cannot be undone',
    ).toBeLessThan(asked);
  });

  it('refuses to move anywhere the configuration did not name', () => {
    // `siteOriginFor` answers with a placeholder when nothing is configured.
    // Redirecting to that would take a working deployment off its own domain.
    expect(button).toMatch(/isPlaceholderOrigin\(/);
  });

  it('keeps the page the visitor was on, and what they were signing in for', () => {
    // `next` lives in the query. Moving host and dropping it would sign
    // somebody in and land them somewhere they did not ask to be.
    const move = button.slice(
      button.indexOf('location.replace'),
      button.indexOf('signInWithOAuth'),
    );
    expect(move).toMatch(/location\.pathname/);
    expect(move).toMatch(/location\.search/);
  });

  it('still sends the hand-back to this deployment, not to a configured guess', () => {
    // After the move, the current origin *is* the canonical one, and it is the
    // origin the verifier cookie was written on. Building the callback from
    // anything else would reintroduce the mismatch from the other side.
    const callback = button.slice(
      button.indexOf('const callback'),
      button.indexOf('signInWithOAuth'),
    );
    expect(callback).toMatch(/window\.location\.origin/);
    expect(callback).toMatch(/\/auth\/callback/);
  });
});
