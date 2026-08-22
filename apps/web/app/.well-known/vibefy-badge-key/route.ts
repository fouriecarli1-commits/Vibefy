import { NextResponse } from 'next/server';
import { buildKeySet, loadRetiredKeys, loadSigningKey } from '@vibefy/badge';

/**
 * The published badge signing keys.
 *
 * A JWKS, so anyone can verify a Vibefy badge with an off-the-shelf JOSE library
 * rather than trusting a format we invented. Retired keys stay here forever:
 * removing one would silently break every badge it ever signed, and a verifier
 * that suddenly fails cannot tell "this badge is forged" from "Vibefy tidied up
 * its keys".
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const keySet = buildKeySet(loadSigningKey(), loadRetiredKeys());

  return NextResponse.json(keySet, {
    headers: {
      'cache-control': 'public, max-age=3600',
      // Anyone may fetch this. That is the point of publishing it.
      'access-control-allow-origin': '*',
    },
  });
}
