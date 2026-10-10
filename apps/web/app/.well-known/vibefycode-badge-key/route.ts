import { NextResponse } from 'next/server';
import { buildKeySet, loadRetiredKeys, loadSigningKey } from '@vibefycode/badge';

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
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const retired = loadRetiredKeys();

  /*
   * Said at error level, and it is the loudest thing this file does.
   *
   * `loadRetiredKeys` strips a private component rather than publishing it,
   * which stops the exposure from here on and does nothing about the exposure
   * that already happened: a private key that reached this environment
   * variable has to be treated as compromised and rotated. Nothing else in the
   * system can notice that, so this is the one place it can be said.
   */
  if (retired.carriedPrivate.length > 0) {
    console.error('a retired badge key arrived with its private half', {
      keyIds: retired.carriedPrivate,
      stripped: true,
      means:
        'VIBEFYCODE_BADGE_RETIRED_KEYS holds a private key component. It was not published, and ' +
        'it must still be rotated: anything that can read that variable can sign a badge with ' +
        'that key id. Replace the entry with its public half only.',
    });
  }
  if (retired.unusable > 0) {
    console.error('a retired badge key entry is not an Ed25519 public key', {
      count: retired.unusable,
      means:
        'It was left out of the published set, so any badge it signed can no longer be verified.',
    });
  }

  const keySet = buildKeySet(loadSigningKey(), retired.keys);

  /*
   * An empty key set is a confident wrong answer.
   *
   * `loadSigningKey` returns null when the signing variables are unset, so a
   * deployment missing them published `{"keys":[]}` with a 200 and an hour of
   * cache. A verifier reading that has no key to try and concludes the badge
   * cannot be verified, which reads as forged. Saying so with a 503 is the
   * honest answer, and it is also the one somebody notices.
   */
  if (keySet.keys.length === 0) {
    console.error('no badge signing key is published', {
      means:
        'VIBEFYCODE_BADGE_SIGNING_KEY_B64 and VIBEFYCODE_BADGE_KEY_ID are not set, and no retired ' +
        'key survived. Until one is, no badge can be verified offline by anybody.',
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
