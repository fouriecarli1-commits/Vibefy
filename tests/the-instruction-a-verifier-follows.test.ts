/**
 * The instruction we publish for checking a badge ourselves.
 *
 * `/api/badge/{publicId}` hands out the signed payload, the signature, the key
 * set URL, and a sentence saying exactly how to rebuild the bytes. The
 * verification page says the same thing in prose: "You do not have to take our
 * word for it… Any JOSE library can verify it without contacting us."
 *
 * That sentence is the whole offline-verification claim. If it does not match
 * what `canonicalise` does, a third party who follows it computes different
 * bytes, the signature does not verify, and the conclusion they reach is not
 * "the instructions are wrong" — it is that our badge is forged. For a product
 * whose only asset is being believed, that is the worst available failure, and
 * it is one unreviewed sentence away.
 *
 * It was wrong. The sentence ended "score fixed to one decimal place", which
 * describes what the implementation does to the number and not what it writes:
 * the score is rounded to one decimal and then serialised as a JSON number, so
 * 82 is `82`. A verifier who read that literally wrote `82.0`, got different
 * bytes, and had a genuine badge fail. Scores are usually whole numbers, so
 * that was most badges.
 *
 * Nothing tied the key order either. A thirteenth payload field would change
 * the signature while the published list kept naming twelve.
 *
 * So the sentence is built from `SIGNED_KEYS`, and this reconstructs the bytes
 * from the published instruction and checks they are the bytes we signed.
 */
import { describe, expect, it } from 'vitest';
import { SIGNED_KEYS, canonicalise, type BadgePayload } from '../packages/badge/src/index.ts';
import { withoutComments } from './setup/source.ts';
import { readFileSync } from 'node:fs';

const route = withoutComments(readFileSync('apps/web/app/api/badge/[publicId]/route.ts', 'utf8'));

const payload = (score: number): BadgePayload =>
  ({
    v: 1,
    kid: 'k1',
    badgeId: 'b1',
    slug: 'an-app',
    appName: 'An App',
    certifiedOrigin: 'https://an-app.example',
    rubricVersion: '1.1.0',
    score,
    assessedOn: '2026-10-01',
    issuedAt: '2026-10-01T00:00:00.000Z',
    expiresAt: '2027-10-01T00:00:00.000Z',
    ownerIsMarketingClient: false,
  }) as BadgePayload;

/**
 * What a third party writes, having read the published sentence.
 *
 * Keys in the named order, no whitespace, values as JSON writes them, score
 * rounded to one decimal first.
 */
function asTheInstructionSays(source: BadgePayload): string {
  const parts = SIGNED_KEYS.map((key) => {
    const value = (source as unknown as Record<string, unknown>)[key];
    const written =
      key === 'score'
        ? JSON.stringify(Number((value as number).toFixed(1)))
        : JSON.stringify(value);
    return `${JSON.stringify(key)}:${written}`;
  });
  return `{${parts.join(',')}}`;
}

describe('following our own instruction', () => {
  it('has keys to follow, or the rest of this is about nothing', () => {
    expect(SIGNED_KEYS.length).toBeGreaterThan(8);
    expect(SIGNED_KEYS[0]).toBe('v');
    expect(SIGNED_KEYS).toContain('score');
  });

  it.each([82, 82.5, 100, 0, 7.25])(
    'rebuilds the exact bytes we sign, for a score of %s',
    (score) => {
      expect(asTheInstructionSays(payload(score))).toBe(canonicalise(payload(score)));
    },
  );

  it('would not rebuild them if the score were written with a trailing zero', () => {
    // The positive control for the sentence's one correction. Without it, the
    // case above passes whatever the sentence says.
    const asItUsedToRead = canonicalise(payload(82)).replace('"score":82,', '"score":82.0,');
    expect(asItUsedToRead).not.toBe(canonicalise(payload(82)));
  });
});

describe('what the verification page tells a visitor', () => {
  const page = withoutComments(readFileSync('apps/web/app/a/[slug]/page.tsx', 'utf8'));

  it('does not send them to a JOSE library, because there is no JWS here', () => {
    // It read "Any JOSE library can verify it without contacting us". A JOSE
    // library verifies a compact serialisation with an `alg` header, and
    // sign.ts has neither on purpose — "no algorithm negotiation, no alg field
    // read from the thing being verified". The advice named a tool that cannot
    // do the job on a scheme chosen for not needing it.
    expect(page).not.toMatch(/JOSE/);
    expect(page).toMatch(/Ed25519/);
    expect(page).toMatch(/JWK/);
  });

  it('tells them the bytes have to be rebuilt, which is the part they cannot guess', () => {
    // Without this the honest reader re-encodes the JSON, gets different
    // bytes, and concludes a genuine badge is forged. The page used to say
    // nothing about it at all.
    expect(page).toMatch(/rebuilding those bytes|rule for/);
    expect(page).toMatch(/api\/badge\//);
  });

  it('still says what the signature does not cover', () => {
    expect(page).toMatch(/genuine signature on a revoked badge is still a genuine signature/);
  });
});

describe('the sentence we publish', () => {
  it('names the keys in the order they are signed in, because it is built from them', () => {
    expect(route).toContain('SIGNED_KEYS.join');
    expect(route, 'the order is retyped rather than derived').not.toMatch(
      /v, kid, badgeId, slug, appName/,
    );
  });

  it('says what is written rather than what is rounded', () => {
    expect(route).toMatch(/rounded to one\s*' \+\s*'?decimal|rounded to one decimal/);
    expect(route).toMatch(/not "score":82\.0|82\.0/);
    expect(route, 'the wording that sent a verifier to the wrong bytes').not.toMatch(
      /score fixed to one decimal place/,
    );
  });

  it('still says what the signature does and does not attest', () => {
    // The qualifier is the honest half of the claim and the easier half to
    // lose: a genuine signature on a revoked badge is still genuine.
    expect(route).toMatch(/signatureDoesNotAttest/);
    expect(route).toMatch(/revoked badge is still a genuine signature/);
  });
});
