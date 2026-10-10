/**
 * The key set we publish, and what could travel in it.
 *
 * `/.well-known/vibefycode-badge-key` is a JWKS served to anybody, with an
 * hour of cache and a wildcard cross-origin header. It is the whole basis of
 * the offline-verification claim.
 *
 * The active key has always been constructed field by field, in `toJwk`, so
 * nothing private could ride along. The retired keys were
 * `JSON.parse(raw) as PublicJwk[]` — a cast, not a check — so whatever JSON
 * sat in `VIBEFYCODE_BADGE_RETIRED_KEYS` was published verbatim.
 *
 * Measured on 2026-10-10: an entry carrying `d`, the Ed25519 private scalar,
 * came back in the key set exactly as pasted. Retiring a key means pasting
 * JSON into that variable, and the natural thing to paste is the JWK you have
 * — which for a key you generated yourself has `d` in it. Anybody reading the
 * published set could then sign a badge with our key id saying anything they
 * liked. For a product whose only asset is being believed, there is no worse
 * outcome available.
 *
 * The public fields are copied out now and nothing else travels, whatever
 * arrives. Stripping rather than refusing, because refusing publishes no key
 * set at all and makes every badge ever signed unverifiable — which is worse,
 * and does not undo an exposure that has already happened. So the route says
 * it, loudly, since rotation is the only real remedy and nothing else in the
 * system can notice.
 */
import { describe, expect, it } from 'vitest';
import { buildKeySet, loadRetiredKeys, publicPartOf } from '../packages/badge/src/keys.ts';

const aPublicJwk = { kty: 'OKP', crv: 'Ed25519', x: 'PUBLIC-PART', kid: 'old-1' };
const withPrivate = { ...aPublicJwk, d: 'THE-PRIVATE-SCALAR', use: 'sig', alg: 'EdDSA' };

const envWith = (keys: unknown) =>
  ({ VIBEFYCODE_BADGE_RETIRED_KEYS: JSON.stringify(keys) }) as NodeJS.ProcessEnv;

describe('a retired key that arrives with its private half', () => {
  it('keeps the public part, so every badge it signed still verifies', () => {
    const { keys } = loadRetiredKeys(envWith([withPrivate]));
    expect(keys).toHaveLength(1);
    expect(keys[0]!.kid).toBe('old-1');
    expect(keys[0]!.x).toBe('PUBLIC-PART');
  });

  it('does not publish the private half, in the key set or anywhere near it', () => {
    const { keys } = loadRetiredKeys(envWith([withPrivate]));
    const published = JSON.stringify(buildKeySet(null, keys));
    expect(published, 'the private scalar is in the published key set').not.toContain(
      'THE-PRIVATE-SCALAR',
    );
    expect(Object.keys(keys[0]!)).not.toContain('d');
  });

  it('is named, because stripping it does not un-expose it', () => {
    // The key reached a variable the deployment can read. It has to be rotated,
    // and this list is the only thing that can tell anybody so.
    expect(loadRetiredKeys(envWith([withPrivate])).carriedPrivate).toEqual(['old-1']);
  });

  it('says so even when the entry is otherwise unusable', () => {
    const { carriedPrivate, keys } = loadRetiredKeys(
      envWith([{ kty: 'RSA', d: 'PRIVATE', kid: 'wrong-type' }]),
    );
    expect(carriedPrivate).toEqual(['wrong-type']);
    expect(keys).toEqual([]);
  });
});

describe('a retired key that is not one', () => {
  it('is left out rather than published as it stands', () => {
    const { keys, unusable } = loadRetiredKeys(
      envWith([{ kty: 'RSA', n: 'nonsense', kid: 'rsa-1' }, aPublicJwk]),
    );
    expect(unusable).toBe(1);
    expect(keys.map((key) => key.kid)).toEqual(['old-1']);
  });

  it('is left out when it names no key id, because a verifier selects on that', () => {
    expect(loadRetiredKeys(envWith([{ kty: 'OKP', crv: 'Ed25519', x: 'P' }])).keys).toEqual([]);
  });

  it('does not take the whole set down with it', () => {
    // The positive control for every absence above: a sound entry beside a
    // broken one still arrives.
    const { keys } = loadRetiredKeys(envWith([null, 'not an object', aPublicJwk]));
    expect(keys.map((key) => key.kid)).toEqual(['old-1']);
  });
});

describe('what publicPartOf copies', () => {
  it('builds the fields rather than keeping what it was given', () => {
    const { jwk } = publicPartOf({ ...aPublicJwk, surprise: 'a field nobody expected' });
    expect(Object.keys(jwk!).sort()).toEqual(['alg', 'crv', 'kid', 'kty', 'use', 'x']);
  });

  it('refuses anything that is not an Ed25519 public key', () => {
    expect(publicPartOf(null).jwk).toBeNull();
    expect(publicPartOf({ kty: 'OKP', crv: 'X25519', x: 'P', kid: 'k' }).jwk).toBeNull();
    expect(publicPartOf({ kty: 'OKP', crv: 'Ed25519', x: '', kid: 'k' }).jwk).toBeNull();
  });

  it('accepts the shape the active key is built in, so the two agree', () => {
    expect(publicPartOf(aPublicJwk).jwk).not.toBeNull();
  });
});

describe('the variable holding nothing usable', () => {
  it('reads as no retired keys rather than as an error', () => {
    expect(loadRetiredKeys({} as NodeJS.ProcessEnv)).toEqual({
      keys: [],
      carriedPrivate: [],
      unusable: 0,
    });
  });

  it('still refuses JSON it cannot parse, rather than publishing half a set', () => {
    expect(() =>
      loadRetiredKeys({ VIBEFYCODE_BADGE_RETIRED_KEYS: '{not json' } as NodeJS.ProcessEnv),
    ).toThrow(/not valid JSON/);
  });
});
