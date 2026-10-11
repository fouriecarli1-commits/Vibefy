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

/**
 * Public JWKs out of one environment variable.
 *
 * Shared by the two variables that carry them, because the sanitising is the
 * part that matters and a second copy of it is a second chance to publish a
 * private component.
 */
function publicJwksFrom(raw: string | undefined, variable: string): RetiredKeys {
  if (!raw) return { keys: [], carriedPrivate: [], unusable: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new KeyError(`${variable} is not valid JSON. Refusing to publish an incomplete key set.`);
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

/** Retired public keys, published alongside the active one. */
export function loadRetiredKeys(env: NodeJS.ProcessEnv = process.env): RetiredKeys {
  return publicJwksFrom(env.VIBEFYCODE_BADGE_RETIRED_KEYS, 'VIBEFYCODE_BADGE_RETIRED_KEYS');
}

/**
 * Every public key a serving deployment publishes, from public variables only.
 *
 * This exists because two true sentences could not both be followed. The
 * runbook says `VIBEFYCODE_BADGE_SIGNING_KEY_B64` and `VIBEFYCODE_BADGE_KEY_ID`
 * "belong on Render and nowhere else", for the right reason — every instance
 * that can sign is another place the one key that ends the business can leak
 * from. The key generator said the public half "is derived from the private key
 * at start-up, so it does not need to be configured", which was also true of
 * the code: `/.well-known/vibefycode-badge-key` built its answer from
 * `loadSigningKey()`.
 *
 * Follow both and the console has no key to derive anything from, so the key
 * set is empty — and an empty key set is not a quiet degradation. Every badge
 * fails to verify, `/verify` tells each visitor it cannot check, and the
 * conclusion a stranger reaches about a genuine badge is that we never issued
 * it. The alternative anybody would reach for, putting the signing key on
 * Vercel too, breaks the rule the runbook calls the one that must never cross.
 *
 * So the serving side reads public halves and nothing else:
 *
 *   · `VIBEFYCODE_BADGE_PUBLIC_KEYS` — the active key first, then any key still
 *     needed to verify badges it signed. Public data: it is already served to
 *     anybody who asks, so a build log, a dashboard field or a pasted message
 *     costs nothing.
 *   · `VIBEFYCODE_BADGE_RETIRED_KEYS` — kept, read and merged, because it is
 *     already set on deployments that have rotated and dropping it would
 *     unpublish exactly the keys it exists to keep published.
 *
 * First mention of a key id wins, so the active key stays first in the
 * published set. The private pair is not read here at all, which is what makes
 * "the console never holds the signing key" a property of the code rather than
 * a promise in a document.
 */
export function loadPublishedKeys(env: NodeJS.ProcessEnv = process.env): RetiredKeys {
  const announced = publicJwksFrom(
    env.VIBEFYCODE_BADGE_PUBLIC_KEYS,
    'VIBEFYCODE_BADGE_PUBLIC_KEYS',
  );
  const retired = loadRetiredKeys(env);

  const keys: PublicJwk[] = [];
  for (const jwk of [...announced.keys, ...retired.keys]) {
    if (!keys.some((already) => already.kid === jwk.kid)) keys.push(jwk);
  }
  return {
    keys,
    carriedPrivate: [...announced.carriedPrivate, ...retired.carriedPrivate],
    unusable: announced.unusable + retired.unusable,
  };
}

/**
 * The line to paste into a serving deployment, built from the key that signs.
 *
 * Printed by the generator and said once by the worker at start-up, so the
 * public half never has to be derived by hand from the private one. Deriving it
 * by hand is not hard; it is a step that puts the signing key on somebody's
 * laptop and in their shell history, which is the thing this whole file is
 * arranged to avoid.
 */
export function publishedKeysLine(active: PublicJwk): string {
  return `VIBEFYCODE_BADGE_PUBLIC_KEYS=${JSON.stringify([active])}`;
}
