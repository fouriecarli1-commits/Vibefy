import { NextResponse, type NextRequest } from 'next/server';
import { SIGNED_KEYS } from '@vibefycode/badge';
import { readAsAnon } from '@/lib/sql';

/**
 * The signed payload, for anyone who wants to check a badge themselves.
 *
 * Public and CORS-open on purpose: a verification scheme that requires a
 * relationship with the issuer to use is not much of a verification scheme.
 *
 * `signatureAttests` and `signatureDoesNotAttest` are in the response body
 * rather than only in the docs, because the single most likely way to misuse
 * this is to verify the signature, see "valid", and conclude the badge is live.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ publicId: string }> },
) {
  const { publicId } = await params;

  const badge = await readAsAnon(async (client) => {
    const { rows } = await client.query<{
      public_id: string;
      slug: string;
      status: string;
      payload: Record<string, unknown>;
      signature: string;
      signing_key_id: string;
    }>(
      `select public_id, slug, status, payload, signature, signing_key_id
         from public.badge_verification where public_id = $1`,
      [publicId],
    );
    return rows[0] ?? null;
  });

  if (!badge) {
    return NextResponse.json(
      { error: 'No badge with that identifier has been issued by VibefyCode.' },
      { status: 404, headers: { 'access-control-allow-origin': '*' } },
    );
  }

  const verifyOrigin = process.env.NEXT_PUBLIC_VERIFY_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? '';

  return NextResponse.json(
    {
      payload: badge.payload,
      signature: badge.signature,
      algorithm: 'EdDSA (Ed25519)',
      keySet: `${verifyOrigin.replace(/\/+$/, '')}/.well-known/vibefycode-badge-key`,
      /*
       * The instruction a third party follows, built from the key order it
       * describes rather than retyped beside it.
       *
       * It used to end "score fixed to one decimal place", which is what the
       * implementation does to the *number* and not what it writes. The score
       * is rounded to one decimal and then serialised as a JSON number, so 82
       * is `82` — a verifier who read that sentence literally and wrote `82.0`
       * computed different bytes and concluded a genuine badge was forged.
       * Scores are usually whole numbers, so that was most of them.
       */
      canonicalisation:
        `Sign and verify over the payload serialised with its keys in this exact order: ${SIGNED_KEYS.join(', ')}. ` +
        'No whitespace. Each value is written as JSON writes it, and the score is rounded to one ' +
        'decimal first — so a score of 82 is "score":82, not "score":82.0, and 82.5 is "score":82.5.',
      currentStatus: badge.status,
      verificationPage: `${verifyOrigin.replace(/\/+$/, '')}/a/${badge.slug}`,
      signatureAttests:
        'That VibefyCode assessed this application against the named rubric version on the named date, and it scored what the payload says. This remains true forever and can be checked offline.',
      signatureDoesNotAttest:
        'That the badge is currently active. Suspension, expiry and revocation are live states — check currentStatus, or the verification page. A genuine signature on a revoked badge is still a genuine signature.',
    },
    {
      headers: {
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=300',
      },
    },
  );
}
