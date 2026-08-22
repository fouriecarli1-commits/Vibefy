/**
 * Badge integrity — the signing layer.
 *
 * Vibefy's asset is the credibility of the mark. These tests are about the one
 * thing that could destroy it outright: a badge somebody else could produce.
 * They also pin down the distinction the whole scheme rests on — that a
 * signature attests a historical fact, not current standing.
 */
import { describe, expect, it } from 'vitest';
import {
  PAYLOAD_VERSION,
  PayloadError,
  buildKeySet,
  canonicalise,
  generateSigningKey,
  privateKeyFromBase64,
  publicKeyFromJwk,
  signBadge,
  toJwk,
  verifyBadge,
  type BadgePayload,
} from '../packages/badge/src/index.ts';
import { createPublicKey } from 'node:crypto';

function keyFrom(kid: string) {
  const generated = generateSigningKey(kid);
  const privateKey = privateKeyFromBase64(generated.privateKeyB64);
  return { kid, privateKey, jwk: toJwk(createPublicKey(privateKey), kid) };
}

const key = keyFrom('vibefy-badge-2026-08');
const otherKey = keyFrom('someone-elses-key');
const keySet = buildKeySet(key);

const payload = (over: Partial<BadgePayload> = {}): BadgePayload => ({
  v: PAYLOAD_VERSION,
  kid: key.kid,
  badgeId: 'abcdef0123456789',
  slug: 'kettle-a1b2c3',
  appName: 'Kettle',
  certifiedOrigin: 'https://kettle.example',
  rubricVersion: '1.0.0',
  score: 82.5,
  assessedOn: '2026-08-22',
  issuedAt: '2026-08-22T10:00:00.000Z',
  expiresAt: '2027-08-22T10:00:00.000Z',
  ownerIsMarketingClient: false,
  ...over,
});

describe('canonicalisation', () => {
  it('produces the same bytes whatever order the fields are written in', () => {
    const a = canonicalise(payload());
    const reordered = { ...payload() };
    const shuffled = Object.fromEntries(
      Object.entries(reordered).reverse(),
    ) as unknown as BadgePayload;
    expect(canonicalise(shuffled)).toBe(a);
  });

  it('treats 82 and 82.0 as the same score, so one assessment has one signature', () => {
    expect(canonicalise(payload({ score: 82 }))).toBe(canonicalise(payload({ score: 82.0 })));
  });

  it('refuses to sign a payload with an unexpected field', () => {
    const rogue = { ...payload(), certified: true } as unknown as BadgePayload;
    expect(() => canonicalise(rogue)).toThrow(PayloadError);
  });

  it('refuses a partial payload rather than signing a half-truth', () => {
    const partial = { ...payload() } as Partial<BadgePayload>;
    delete partial.expiresAt;
    expect(() => canonicalise(partial as BadgePayload)).toThrow(/missing "expiresAt"/);
  });

  it('refuses a score outside 0 to 100', () => {
    expect(() => canonicalise(payload({ score: 101 }))).toThrow(PayloadError);
    expect(() => canonicalise(payload({ score: -1 }))).toThrow(PayloadError);
  });
});

describe('a genuine badge', () => {
  it('verifies', () => {
    const signed = signBadge(payload(), key);
    const result = verifyBadge(signed, keySet, { now: new Date('2026-09-01') });
    expect(result.signatureValid).toBe(true);
    expect(result.withinValidity).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('explains what it does and does not attest, in words a person can quote', () => {
    const signed = signBadge(payload(), key);
    const result = verifyBadge(signed, keySet, { now: new Date('2026-09-01') });
    expect(result.explanation).toMatch(/assessed Kettle against Rubric v1\.0\.0 on 2026-08-22/);
    expect(result.explanation).toMatch(/does not confirm the badge is currently active/i);
  });

  it('discloses a marketing relationship inside the signed payload, not only on the page', () => {
    const signed = signBadge(payload({ ownerIsMarketingClient: true }), key);
    const result = verifyBadge(signed, keySet, { now: new Date('2026-09-01') });
    expect(result.payload?.ownerIsMarketingClient).toBe(true);
    expect(result.explanation).toMatch(/marketing-services client/i);
  });
});

describe('a badge somebody else made', () => {
  it('does not verify when the score is edited after signing', () => {
    const signed = signBadge(payload({ score: 41 }), key);
    const tampered = { payload: { ...signed.payload, score: 96 }, signature: signed.signature };
    const result = verifyBadge(tampered, keySet);
    expect(result.signatureValid).toBe(false);
    expect(result.failures).toContain('bad_signature');
    expect(result.explanation).toMatch(/altered, or Vibefy did not issue it/);
  });

  it.each([
    ['appName', { appName: 'A Different App' }],
    ['certifiedOrigin', { certifiedOrigin: 'https://attacker.example' }],
    ['expiresAt', { expiresAt: '2099-01-01T00:00:00.000Z' }],
    ['rubricVersion', { rubricVersion: '9.9.9' }],
    ['ownerIsMarketingClient', { ownerIsMarketingClient: true }],
  ])('does not verify when %s is edited', (_field, change) => {
    const signed = signBadge(payload(), key);
    const result = verifyBadge(
      { payload: { ...signed.payload, ...change }, signature: signed.signature },
      keySet,
    );
    expect(result.signatureValid).toBe(false);
  });

  it('does not verify when signed with a key Vibefy does not publish', () => {
    const forged = signBadge(payload({ kid: otherKey.kid }), otherKey);
    const result = verifyBadge(forged, keySet);
    expect(result.signatureValid).toBe(false);
    expect(result.failures).toContain('unknown_key');
    expect(result.explanation).toMatch(/Vibefy did not issue it/);
  });

  it('does not verify when the signature is swapped in from another badge', () => {
    const a = signBadge(payload({ badgeId: 'aaaaaaaaaaaaaaaa', slug: 'a-1' }), key);
    const b = signBadge(payload({ badgeId: 'bbbbbbbbbbbbbbbb', slug: 'b-1' }), key);
    expect(verifyBadge({ payload: a.payload, signature: b.signature }, keySet).signatureValid).toBe(
      false,
    );
  });

  it('refuses to sign a payload that names a different key than the one signing it', () => {
    expect(() => signBadge(payload({ kid: 'some-other-key' }), key)).toThrow(/nobody can verify/);
  });
});

describe('expiry', () => {
  it('still confirms the historical fact after expiry, and says the badge must not be displayed', () => {
    const signed = signBadge(payload(), key);
    const result = verifyBadge(signed, keySet, { now: new Date('2028-01-01') });
    expect(result.signatureValid, 'the assessment did happen; that does not stop being true').toBe(
      true,
    );
    expect(result.withinValidity).toBe(false);
    expect(result.failures).toContain('expired');
    expect(result.explanation).toMatch(/must no longer be displayed/);
  });

  it('refuses a badge claiming to be issued in the future', () => {
    const signed = signBadge(payload({ issuedAt: '2030-01-01T00:00:00.000Z' }), key);
    const result = verifyBadge(signed, keySet, { now: new Date('2026-09-01') });
    expect(result.failures).toContain('not_yet_valid');
  });
});

describe('key rotation', () => {
  it('keeps verifying badges signed by a retired key', () => {
    const oldSigned = signBadge(payload({ kid: otherKey.kid }), otherKey);
    const rotated = buildKeySet(key, [otherKey.jwk]);
    expect(verifyBadge(oldSigned, rotated, { now: new Date('2026-09-01') }).signatureValid).toBe(
      true,
    );
  });

  it('publishes the active key first, and does not duplicate it', () => {
    const set = buildKeySet(key, [key.jwk, otherKey.jwk]);
    expect(set.keys.filter((entry) => entry.kid === key.kid)).toHaveLength(1);
  });

  it('publishes keys in a format any JOSE library can read', () => {
    expect(key.jwk).toMatchObject({ kty: 'OKP', crv: 'Ed25519', use: 'sig', alg: 'EdDSA' });
    expect(publicKeyFromJwk(key.jwk).asymmetricKeyType).toBe('ed25519');
  });
});

describe('the signing key itself', () => {
  it('is never derivable from what we publish', () => {
    const published = JSON.stringify(buildKeySet(key));
    const secret = privateKeyFromBase64(generateSigningKey(key.kid).privateKeyB64);
    expect(published).not.toContain('PRIVATE');
    expect(published).not.toContain(
      secret.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    );
  });

  it('refuses an unreadable key rather than starting without one', () => {
    expect(() => privateKeyFromBase64('not-a-key')).toThrow(/could not be read/);
  });
});
