import { NextResponse } from 'next/server';
import { loadPublishedKeys } from '@vibefycode/badge';

/**
 * The published badge signing keys.
 *
 * A JWKS, so the key can be imported by anything that reads one rather than
 * from a format we invented. Verifying is then an Ed25519 signature check over
 * the bytes described at `/api/badge/{publicId}` — there is no JWS here, which
 * `packages/badge/src/sign.ts` explains.
 *
 * Retired keys stay here forever: removing one would silently break every badge
 * it ever signed, and a verifier that suddenly fails cannot tell "this badge is
 * forged" from "VibefyCode tidied up its keys".
 *
 * ## It no longer reads the signing key, and never should have
 *
 * This built its answer from `loadSigningKey()`, which reads the private pair
 * `docs/RUNBOOK.md` says belongs "on Render and nowhere else". Both statements
 * were right and they could not both be followed: with the pair where the
 * runbook puts it, this route had nothing to derive a key from and published an
 * empty set, so every badge in the world failed to verify and `/verify` told
 * every visitor it could not check one. `loadPublishedKeys` explains the whole
 * trap; what matters here is that this route cannot sign and cannot leak a
 * signing key, because it is not given one.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const published = loadPublishedKeys();

  /*
   * Said at error level, and it is the loudest thing this file does.
   *
   * `loadRetiredKeys` strips a private component rather than publishing it,
   * which stops the exposure from here on and does nothing about the exposure
   * that already happened: a private key that reached this environment
   * variable has to be treated as compromised and rotated. Nothing else in the
   * system can notice that, so this is the one place it can be said.
   */
  if (published.carriedPrivate.length > 0) {
    console.error('a published badge key arrived with its private half', {
      keyIds: published.carriedPrivate,
      stripped: true,
      means:
        'VIBEFYCODE_BADGE_PUBLIC_KEYS or VIBEFYCODE_BADGE_RETIRED_KEYS holds a private key ' +
        'component. It was not published, and it must still be rotated: anything that can read ' +
        'that variable can sign a badge with that key id. Replace the entry with its public half ' +
        'only — the line the worker prints at start-up is already public-only.',
    });
  }
  if (published.unusable > 0) {
    console.error('a published badge key entry is not an Ed25519 public key', {
      count: published.unusable,
      means:
        'It was left out of the published set, so any badge it signed can no longer be verified.',
    });
  }

  const keySet = { keys: published.keys };

  /*
   * An empty key set is a confident wrong answer.
   *
   * A deployment with none of these variables published `{"keys":[]}` with a 200
   * and an hour of cache. A verifier reading that has no key to try and
   * concludes the badge cannot be verified, which reads as forged. Saying so
   * with a 503 is the honest answer, and it is also the one somebody notices.
   *
   * The message names the variable this route actually reads. It used to name
   * the signing pair, which sent whoever read it to put the private key on the
   * deployment that must not hold one — a message that is accurate about the
   * cause and wrong about the fix.
   */
  if (keySet.keys.length === 0) {
    console.error('no badge signing key is published', {
      means:
        'VIBEFYCODE_BADGE_PUBLIC_KEYS is not set on this deployment, and no retired key survived. ' +
        'Until one is, no badge can be verified offline by anybody, and /verify tells every ' +
        'visitor it cannot check a badge.',
      fix:
        'Paste the VIBEFYCODE_BADGE_PUBLIC_KEYS line the worker prints at start-up, or run ' +
        'pnpm badge:keygen for a new key. The signing key itself stays on the worker and is ' +
        'deliberately not read here.',
    });
    return NextResponse.json(
      { error: 'No badge signing key is published yet.' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  return NextResponse.json(keySet, {
    headers: {
      'cache-control': 'public, max-age=3600',
      // Anyone may fetch this. That is the point of publishing it.
      'access-control-allow-origin': '*',
    },
  });
}
