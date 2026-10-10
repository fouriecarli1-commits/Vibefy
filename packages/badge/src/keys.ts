/**
 * Badge signing keys.
 *
 * If this key leaks, every badge becomes forgeable and the business is over —
 * so a few things are deliberately awkward:
 *
 *   · The private key is only ever loaded from the platform secret store. There
 *     is no code path that reads one from a file in the repository, and the
 *     generator writes to stdout rather than to disk.
 *   · Keys carry an id (`kid`) and badges record which one signed them, so
 *     rotation does not invalidate history: old badges keep verifying against the
 *     retired public key, which stays published.
 *   · The published document is a JWKS, so a third party can verify with any
 *     off-the-shelf JOSE library rather than trusting a format we invented.
 */
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from 'node:crypto';

export interface PublicJwk {
  readonly kty: 'OKP';
  readonly crv: 'Ed25519';
  readonly x: string;
  readonly kid: string;
  readonly use: 'sig';
  readonly alg: 'EdDSA';
  /** ISO date after which this key signs nothing new. It keeps verifying. */
  readonly retiredAt?: string;
}

export interface KeySet {
  readonly keys: readonly PublicJwk[];
}

export class KeyError extends Error {}

/** Generates a fresh keypair. Output goes to the secret store, never to a file. */
export function generateSigningKey(kid: string): {
  kid: string;
  privateKeyB64: string;
  jwk: PublicJwk;
} {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    kid,
    privateKeyB64: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    jwk: toJwk(publicKey, kid),
  };
}

export function toJwk(publicKey: KeyObject, kid: string): PublicJwk {
  const jwk = publicKey.export({ format: 'jwk' }) as { kty?: string; crv?: string; x?: string };
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || !jwk.x) {
    throw new KeyError('Expected an Ed25519 public key.');
  }
  return { kty: 'OKP', crv: 'Ed25519', x: jwk.x, kid, use: 'sig', alg: 'EdDSA' };
}

export function publicKeyFromJwk(jwk: PublicJwk): KeyObject {
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519') {
    throw new KeyError(`Unsupported key type ${jwk.kty}/${jwk.crv}. Badges are Ed25519 only.`);
  }
  return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x }, format: 'jwk' });
}

export function privateKeyFromBase64(base64: string): KeyObject {
  try {
    return createPrivateKey({ key: Buffer.from(base64, 'base64'), format: 'der', type: 'pkcs8' });
  } catch (error) {
    throw new KeyError(
      `The badge signing key could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export interface SigningKey {
  readonly kid: string;
  readonly privateKey: KeyObject;
  readonly jwk: PublicJwk;
}

/**
 * The active signing key, from the environment.
 *
 * Absent is not an error here — issuance is what needs a key, and a deployment
 * that only serves and verifies badges should not have one. Callers that need to
 * sign say so by using `requireSigningKey`.
 */
export function loadSigningKey(env: NodeJS.ProcessEnv = process.env): SigningKey | null {
  const base64 = env.VIBEFYCODE_BADGE_SIGNING_KEY_B64;
  const kid = env.VIBEFYCODE_BADGE_KEY_ID;
  if (!base64 || !kid) return null;

  const privateKey = privateKeyFromBase64(base64);
  return { kid, privateKey, jwk: toJwk(createPublicKey(privateKey), kid) };
}

export function requireSigningKey(env: NodeJS.ProcessEnv = process.env): SigningKey {
  const key = loadSigningKey(env);
  if (!key) {
    throw new KeyError(
      'No badge signing key is configured. Set VIBEFYCODE_BADGE_SIGNING_KEY_B64 and VIBEFYCODE_BADGE_KEY_ID in the platform secret store — never in the repository.',
    );
  }
  return key;
}

/**
 * The published key set: the active key plus every retired one.
 *
 * Retired keys stay published forever. Removing one would silently break every
 * badge it ever signed, and a verifier that suddenly fails has no way to tell
 * "this badge is forged" from "VibefyCode tidied up its keys".
 */
export function buildKeySet(active: SigningKey | null, retired: readonly PublicJwk[] = []): KeySet {
  const keys: PublicJwk[] = [...retired];
  if (active && !keys.some((key) => key.kid === active.kid)) keys.unshift(active.jwk);
  return { keys };
}

/**
 * The public half of a JWK, built field by field.
 *
 * Never a copy of what came in. `toJwk` has always constructed the active
 * key's JWK from an explicit list for this reason, and the retired keys had no
 * such protection: `JSON.parse(raw) as PublicJwk[]` is a cast, not a check, so
 * whatever JSON sat in the environment variable was published verbatim at a
 * public, cacheable, cross-origin URL.
 *
 * Measured on 2026-10-10: an entry carrying `d` — the Ed25519 private scalar —
 * was served in the key set exactly as pasted. Retiring a key means pasting
 * JSON into that variable, and the natural thing to paste is the JWK you have,
 * which for a key you generated yourself includes `d`. Anybody reading the
 * published set could then sign a badge with our key id, saying anything they
 * liked. There is no worse outcome available to a product whose only asset is
 * being believed.
 *
 * So the public fields are copied out and nothing else travels, whatever
 * arrives. A private component cannot be published by this function even if
 * somebody pastes one.
 */
export function publicPartOf(candidate: unknown): {
  jwk: PublicJwk | null;
  carriedPrivate: boolean;
} {
  if (typeof candidate !== 'object' || candidate === null)
    return { jwk: null, carriedPrivate: false };
  const source = candidate as Record<string, unknown>;
  const carriedPrivate = typeof source.d === 'string' && source.d.length > 0;
  const usable =
    source.kty === 'OKP' &&
    source.crv === 'Ed25519' &&
    typeof source.x === 'string' &&
    source.x.length > 0 &&
    typeof source.kid === 'string' &&
    source.kid.length > 0;
  if (!usable) return { jwk: null, carriedPrivate };
  return {
    jwk: {
      kty: 'OKP',
      crv: 'Ed25519',
      x: source.x as string,
      kid: source.kid as string,
      use: 'sig',
      alg: 'EdDSA',
    },
    carriedPrivate,
  };
}

export interface RetiredKeys {
  readonly keys: PublicJwk[];
  /**
   * Entries that arrived carrying a private component, by key id.
   *
   * Stripped rather than refused: refusing would publish no key set at all and
   * make every badge ever signed unverifiable, which is worse than the
   * stripping and does not undo the exposure. Returned rather than logged here
   * so the route can say it — and it has to be said, because a private key
   * that reached a public environment variable must be treated as compromised
   * and rotated, which no amount of stripping achieves.
   */
  readonly carriedPrivate: string[];
  /** Entries that are not an Ed25519 public key, and were left out. */
  readonly unusable: number;
}

/** Retired public keys, published alongside the active one. */
export function loadRetiredKeys(env: NodeJS.ProcessEnv = process.env): RetiredKeys {
  const raw = env.VIBEFYCODE_BADGE_RETIRED_KEYS;
  if (!raw) return { keys: [], carriedPrivate: [], unusable: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new KeyError(
      'VIBEFYCODE_BADGE_RETIRED_KEYS is not valid JSON. Refusing to publish an incomplete key set.',
    );
  }
  if (!Array.isArray(parsed)) return { keys: [], carriedPrivate: [], unusable: 0 };

  const keys: PublicJwk[] = [];
  const carriedPrivate: string[] = [];
  let unusable = 0;
  for (const candidate of parsed) {
    const { jwk, carriedPrivate: hadPrivate } = publicPartOf(candidate);
    if (hadPrivate) {
      const named = (candidate as Record<string, unknown>).kid;
      carriedPrivate.push(typeof named === 'string' ? named : '(unnamed)');
    }
    if (jwk) keys.push(jwk);
    else unusable += 1;
  }
  return { keys, carriedPrivate, unusable };
}
