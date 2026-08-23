/**
 * Signing and verifying.
 *
 * Ed25519 over the canonical payload bytes. No algorithm negotiation, no `alg`
 * field read from the thing being verified — the algorithm is fixed in code,
 * because "let the token tell you how to check it" is how signature schemes get
 * broken.
 */
import { sign as nodeSign, verify as nodeVerify, type KeyObject } from 'node:crypto';
import { canonicalise, parsePayload, type BadgePayload } from './payload.ts';
import { publicKeyFromJwk, type PublicJwk, type SigningKey } from './keys.ts';

export interface SignedBadge {
  readonly payload: BadgePayload;
  /** base64url, so it survives a URL and a copy-paste without escaping. */
  readonly signature: string;
}

export function signBadge(payload: BadgePayload, key: SigningKey): SignedBadge {
  if (payload.kid !== key.kid) {
    throw new Error(
      `Payload names key "${payload.kid}" but was handed key "${key.kid}". Signing it anyway would produce a badge nobody can verify.`,
    );
  }
  const signature = nodeSign(null, Buffer.from(canonicalise(payload), 'utf8'), key.privateKey);
  return { payload, signature: signature.toString('base64url') };
}

export type VerificationFailure =
  | 'unknown_key'
  | 'bad_signature'
  | 'malformed_payload'
  | 'expired'
  | 'not_yet_valid';

export interface VerificationResult {
  /** True when the signature is genuine. Says nothing about current standing. */
  readonly signatureValid: boolean;
  /** True when the signature is genuine *and* the badge has not passed its expiry. */
  readonly withinValidity: boolean;
  readonly payload: BadgePayload | null;
  readonly kid: string | null;
  readonly failures: readonly VerificationFailure[];
  /** Plain-English summary, written to be quoted directly to a person. */
  readonly explanation: string;
}

export interface VerifyOptions {
  readonly now?: Date;
}

/**
 * Verifies a badge against a published key set.
 *
 * Deliberately returns a result rather than throwing: a caller checking someone
 * else's badge wants to know *why* it failed, and an exception loses that.
 */
export function verifyBadge(
  raw: { payload: unknown; signature: string },
  keySet: { keys: readonly PublicJwk[] },
  options: VerifyOptions = {},
): VerificationResult {
  const now = options.now ?? new Date();
  const failures: VerificationFailure[] = [];

  let payload: BadgePayload;
  try {
    payload = parsePayload(raw.payload);
  } catch {
    return {
      signatureValid: false,
      withinValidity: false,
      payload: null,
      kid: null,
      failures: ['malformed_payload'],
      explanation: 'This is not a well-formed VibefyCode badge payload.',
    };
  }

  const jwk = keySet.keys.find((key) => key.kid === payload.kid);
  if (!jwk) {
    return {
      signatureValid: false,
      withinValidity: false,
      payload,
      kid: payload.kid,
      failures: ['unknown_key'],
      explanation: `This badge names signing key "${payload.kid}", which VibefyCode does not publish. VibefyCode did not issue it.`,
    };
  }

  let signatureValid = false;
  try {
    signatureValid = nodeVerify(
      null,
      Buffer.from(canonicalise(payload), 'utf8'),
      publicKeyFromJwk(jwk),
      Buffer.from(raw.signature, 'base64url'),
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) failures.push('bad_signature');

  const expiresAt = new Date(payload.expiresAt);
  const issuedAt = new Date(payload.issuedAt);
  if (signatureValid && expiresAt <= now) failures.push('expired');
  if (signatureValid && issuedAt > now) failures.push('not_yet_valid');

  const withinValidity = signatureValid && failures.length === 0;

  return {
    signatureValid,
    withinValidity,
    payload,
    kid: payload.kid,
    failures,
    explanation: explain(payload, signatureValid, failures),
  };
}

function explain(
  payload: BadgePayload,
  signatureValid: boolean,
  failures: readonly VerificationFailure[],
): string {
  if (!signatureValid) {
    return 'The signature does not match this payload. Either the badge was altered, or VibefyCode did not issue it.';
  }
  if (failures.includes('expired')) {
    return `VibefyCode did assess ${payload.appName} against Rubric v${payload.rubricVersion} on ${payload.assessedOn}, scoring ${payload.score}. That badge expired on ${payload.expiresAt.slice(0, 10)} and must no longer be displayed.`;
  }
  if (failures.includes('not_yet_valid')) {
    return 'This badge claims to have been issued in the future, which VibefyCode does not do.';
  }
  return [
    `VibefyCode assessed ${payload.appName} against Rubric v${payload.rubricVersion} on ${payload.assessedOn}, scoring ${payload.score} out of 100.`,
    'The signature is genuine, so that historical fact is confirmed offline.',
    'It does not confirm the badge is currently active — suspension and revocation are live states, and only vibefycode’s verification page can answer that.',
    payload.ownerIsMarketingClient
      ? 'The owner is also a VibefyCode marketing-services client. This is disclosed wherever the rating appears.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}
