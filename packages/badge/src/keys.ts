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

/** Retired public keys, published alongside the active one. */
export function loadRetiredKeys(env: NodeJS.ProcessEnv = process.env): PublicJwk[] {
  const raw = env.VIBEFYCODE_BADGE_RETIRED_KEYS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as PublicJwk[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new KeyError(
      'VIBEFYCODE_BADGE_RETIRED_KEYS is not valid JSON. Refusing to publish an incomplete key set.',
    );
  }
}
