/**
 * A published key we cannot read, reported as a badge somebody forged.
 *
 * `verifyBadge` built the public key inside the `try` around the signature
 * check, so `publicKeyFromJwk` throwing — an unsupported curve, or an `x` that
 * is not a key — came out as `signatureValid = false`. This file's own
 * `explain` then wrote the sentence that follows from that: "The signature does
 * not match this payload. Either the badge was altered, or VibefyCode did not
 * issue it."
 *
 * About a badge we did issue, to whoever pasted it in, because one character
 * was lost on its way into an environment variable.
 *
 * `loadPublishedKeys` cannot catch it either: its check is on the shape of the
 * entry — `kty`, `crv`, a non-empty `x`, a `kid` — and a truncated line keeps
 * its shape. It stops being a key, which only `createPublicKey` can tell you.
 *
 * This is the same defect `/verify` has had a third answer for since the row
 * lookup was corrected — "We cannot tell you right now", rather than accusing
 * somebody over a read that failed on our side — arriving through the key
 * instead of through the row. So it gets the same treatment: `key_unusable` is
 * about us, `bad_signature` is about the badge, and they are no longer the same
 * answer.
 */
import { createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PAYLOAD_VERSION,
  generateSigningKey,
  privateKeyFromBase64,
  publicKeyFromJwk,
  signBadge,
  toJwk,
  verifyBadge,
  type BadgePayload,
  type PublicJwk,
} from '../packages/badge/src/index.ts';
import { commentsBlanked } from './setup/source.ts';

const generated = generateSigningKey('vibefycode-badge-2026-10');
const privateKey = privateKeyFromBase64(generated.privateKeyB64);
const key = {
  kid: 'vibefycode-badge-2026-10',
  privateKey,
  jwk: toJwk(createPublicKey(privateKey), 'vibefycode-badge-2026-10'),
};

const payload: BadgePayload = {
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
};

const signed = signBadge(payload, key);

/** The same published entry, with its key material spoilt the way a paste does. */
const truncated: PublicJwk = { ...key.jwk, x: key.jwk.x.slice(0, -4) };

describe('a badge whose key we publish and cannot read', () => {
  it('is not called a forgery', () => {
    const result = verifyBadge(signed, { keys: [truncated] });
    expect(result.failures).toEqual(['key_unusable']);
    expect(result.failures, 'our own fault, reported as the badge’s').not.toContain(
      'bad_signature',
    );
    expect(result.signatureValid).toBe(false);
    expect(result.withinValidity).toBe(false);
  });

  it('says whose fault it is, in the sentence a person reads', () => {
    const { explanation } = verifyBadge(signed, { keys: [truncated] });
    expect(explanation).toMatch(/fault on our side/i);
    expect(explanation, 'this is the accusation the whole state exists to avoid').not.toMatch(
      /did not issue it/i,
    );
    // The key it could not read, so somebody can fix the right line.
    expect(explanation).toContain(key.kid);
  });

  it('still carries the payload and the key id it was checking', () => {
    // A caller with no payload cannot say which application the visitor asked
    // about, and the page is still obliged to answer them.
    const result = verifyBadge(signed, { keys: [truncated] });
    expect(result.payload?.appName).toBe('Kettle');
    expect(result.kid).toBe(key.kid);
  });

  it('is told apart from a key of the wrong kind', () => {
    // `publicKeyFromJwk` refuses a curve that is not Ed25519 before any
    // signature is checked, and that is the same fault: published, unreadable.
    const wrongCurve = { ...key.jwk, crv: 'X25519' } as unknown as PublicJwk;
    expect(verifyBadge(signed, { keys: [wrongCurve] }).failures).toEqual(['key_unusable']);
  });
});

describe('what it is not', () => {
  it('still calls an altered payload a bad signature', () => {
    // The positive control. A readable key and a payload that does not match is
    // a statement about the badge, and the strong sentence is correct there.
    const altered = { ...signed, payload: { ...payload, score: 99 } };
    const result = verifyBadge(altered, { keys: [key.jwk] });
    expect(result.failures).toContain('bad_signature');
    expect(result.explanation).toMatch(/does not match/i);
  });

  it('still calls a badge signed by somebody else unknown', () => {
    const other = generateSigningKey('someone-elses-key');
    const otherPrivate = privateKeyFromBase64(other.privateKeyB64);
    const theirs = signBadge(
      { ...payload, kid: 'someone-elses-key' },
      {
        kid: 'someone-elses-key',
        privateKey: otherPrivate,
        jwk: toJwk(createPublicKey(otherPrivate), 'someone-elses-key'),
      },
    );
    expect(verifyBadge(theirs, { keys: [key.jwk] }).failures).toEqual(['unknown_key']);
  });

  it('still verifies a badge whose key is intact', () => {
    const result = verifyBadge(signed, { keys: [key.jwk] });
    expect(result.signatureValid).toBe(true);
    expect(result.failures).toEqual([]);
  });
});

describe('the surfaces that have to know', () => {
  it('gives the verification page its third answer for this too', () => {
    const page = commentsBlanked(readFileSync('apps/web/app/verify/page.tsx', 'utf8'));
    expect(page, 'a key we cannot read still answers “No.”').toMatch(/key_unusable/);
    const decision = page.slice(page.indexOf('couldNotCheck'));
    expect(decision).toMatch(/no_published_keys/);
    expect(decision).toMatch(/key_unusable/);
    // And it is said somewhere other than the visitor's screen.
    expect(page).toMatch(/couldNot\(/);
  });

  it('is what the health page actually tests, rather than counting entries', () => {
    const health = commentsBlanked(readFileSync('apps/web/app/admin/health/page.tsx', 'utf8'));
    // Building the key is the only way to know. A shape check passes a
    // truncated line, which is the case that brought this on.
    expect(health).toMatch(/publicKeyFromJwk\(/);
  });

  it('is a key the shape check does accept, or this file proves nothing', () => {
    // The whole premise: `loadPublishedKeys` would publish this entry happily.
    expect(truncated.kty).toBe('OKP');
    expect(truncated.crv).toBe('Ed25519');
    expect(truncated.x.length).toBeGreaterThan(0);
    expect(() => publicKeyFromJwk(truncated)).toThrow();
  });
});
