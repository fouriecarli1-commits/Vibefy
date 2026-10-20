/**
 * A date that cannot be read is a badge that never expires.
 *
 * `verifyBadge` asks `expiresAt <= now` and `issuedAt > now`. `new Date('one
 * day')` is `Invalid Date`, and every comparison against it is false — so a
 * payload whose `expiresAt` is not a date collected no `expired` failure, no
 * `not_yet_valid` failure, and came back `withinValidity: true`. Genuine and
 * current, for ever.
 *
 * `canonicalise` is the gate that would have caught it. It checks that every
 * signed key is present, that there are no extra ones, that the version is
 * right and that the score is a number between nought and a hundred — three
 * strings that are supposed to be dates, and nothing looked.
 *
 * Reaching that state takes our own signature, so this is not a way in from
 * outside. It is the one shape of our own mistake that a signature makes
 * permanent, and the expiry is the whole of the difference between an
 * assessment of a product as it was and a claim about the product as it is.
 *
 * Both files hold the rule now: the payload refuses the date, and the
 * comparison is written so that an unreadable one counts as expired rather than
 * as eternal. Either alone would do; a badge reading as current when it is not
 * takes both being wrong.
 */
import { createPublicKey } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PAYLOAD_VERSION,
  PayloadError,
  canonicalise,
  generateSigningKey,
  parsePayload,
  privateKeyFromBase64,
  signBadge,
  toJwk,
  verifyBadge,
  type BadgePayload,
} from '../packages/badge/src/index.ts';

const generated = generateSigningKey('vibefycode-badge-2026-10');
const privateKey = privateKeyFromBase64(generated.privateKeyB64);
const key = {
  kid: 'vibefycode-badge-2026-10',
  privateKey,
  jwk: toJwk(createPublicKey(privateKey), 'vibefycode-badge-2026-10'),
};

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

describe('a payload carrying something that is not a date', () => {
  it('cannot be signed', () => {
    expect(() => signBadge(payload({ expiresAt: 'one day' }), key)).toThrow(PayloadError);
  });

  it('cannot be canonicalised, which is what signing and verifying both do', () => {
    for (const field of ['assessedOn', 'issuedAt', 'expiresAt'] as const) {
      expect(() => canonicalise(payload({ [field]: 'soon' })), field).toThrow(PayloadError);
    }
  });

  it('says what the consequence would have been, not just that it is invalid', () => {
    try {
      canonicalise(payload({ expiresAt: '' }));
      expect.unreachable('an unreadable expiry was accepted');
    } catch (error) {
      expect(String(error)).toMatch(/expiresAt/);
      expect(String(error)).toMatch(/never expires/i);
    }
  });

  it('is refused on the way in, not only on the way out', () => {
    expect(() => parsePayload(payload({ issuedAt: 'yesterday' }))).toThrow(PayloadError);
  });

  it('is reported as malformed rather than as genuine', () => {
    // The whole point, from the reader's side. Verification of such a badge —
    // were one ever to exist — answers "not a well-formed payload", which is a
    // statement nobody can read as "valid and current".
    const result = verifyBadge(
      { payload: payload({ expiresAt: 'one day' }), signature: 'whatever' },
      { keys: [key.jwk] },
    );
    expect(result.failures).toEqual(['malformed_payload']);
    expect(result.withinValidity).toBe(false);
    expect(result.signatureValid).toBe(false);
  });
});

describe('the comparison itself', () => {
  /*
   * The second of the two statements. `parsePayload` refuses the date, so this
   * is only reachable past a mutation of that file — which is exactly when it
   * matters.
   */
  const signed = signBadge(payload(), key);

  it('still expires a badge whose expiry has passed', () => {
    const result = verifyBadge(signed, { keys: [key.jwk] }, { now: new Date('2028-01-01') });
    expect(result.failures).toContain('expired');
    expect(result.withinValidity).toBe(false);
  });

  it('still refuses a badge issued in the future', () => {
    const result = verifyBadge(signed, { keys: [key.jwk] }, { now: new Date('2020-01-01') });
    expect(result.failures).toContain('not_yet_valid');
  });

  it('still accepts one inside its window, at either edge', () => {
    const inside = verifyBadge(signed, { keys: [key.jwk] }, { now: new Date('2027-01-01') });
    expect(inside.failures).toEqual([]);
    expect(inside.withinValidity).toBe(true);

    // Issued exactly now is issued, and expiring exactly now is expired: the
    // badge is valid through the moment it is signed and not through the moment
    // it lapses.
    const atIssue = verifyBadge(
      signed,
      { keys: [key.jwk] },
      { now: new Date(signed.payload.issuedAt) },
    );
    expect(atIssue.withinValidity).toBe(true);
    const atExpiry = verifyBadge(
      signed,
      { keys: [key.jwk] },
      { now: new Date(signed.payload.expiresAt) },
    );
    expect(atExpiry.failures).toContain('expired');
  });
});
