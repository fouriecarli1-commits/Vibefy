/**
 * What a badge signature actually attests.
 *
 * This is the most important boundary in the product to state precisely, because
 * the whole business rests on people trusting it and on us never claiming more
 * than it says.
 *
 * **The signature attests a historical fact:** that VibefyCode assessed this
 * application, against this rubric version, on this date, and it scored this.
 * That fact does not stop being true when a badge is revoked, so the signature
 * keeps verifying. A third party can check it offline, forever, without asking
 * us anything.
 *
 * **The signature does not attest current standing.** Whether the badge is still
 * active — not suspended, not revoked, not expired — is a live question, and the
 * only honest answer comes from our origin. That is exactly why we serve the
 * image ourselves rather than handing out a file.
 *
 * Anyone who conflates the two ends up trusting a revoked badge, so the
 * distinction is written into the payload's own field names and into the
 * verification document we publish.
 */

export const PAYLOAD_VERSION = 1 as const;

export interface BadgePayload {
  /** Payload schema version. Bumped only when the signed field set changes. */
  readonly v: typeof PAYLOAD_VERSION;
  /** Which signing key produced the signature. */
  readonly kid: string;
  /** Public badge identifier, as it appears in the image URL. */
  readonly badgeId: string;
  /** Verification page slug. */
  readonly slug: string;
  readonly appName: string;
  /** The single origin this badge is licensed to appear on. */
  readonly certifiedOrigin: string;
  readonly rubricVersion: string;
  /** Score at the moment of issue. It never changes; a re-assessment issues anew. */
  readonly score: number;
  /** ISO date the assessment was completed. */
  readonly assessedOn: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  /**
   * Disclosed in the signed payload rather than only on the page, so a third
   * party checking a badge offline sees the commercial relationship too.
   */
  readonly ownerIsMarketingClient: boolean;
}

export class PayloadError extends Error {}

const REQUIRED_KEYS = [
  'v',
  'kid',
  'badgeId',
  'slug',
  'appName',
  'certifiedOrigin',
  'rubricVersion',
  'score',
  'assessedOn',
  'issuedAt',
  'expiresAt',
  'ownerIsMarketingClient',
] as const;

/**
 * The exact bytes that get signed.
 *
 * Keys in a fixed order, no whitespace, no locale-dependent formatting. Two
 * implementations must produce byte-identical output from the same payload, or
 * third-party verification does not work — so this function is specified in the
 * published verification document, not just implemented here.
 */
export function canonicalise(payload: BadgePayload): string {
  for (const key of REQUIRED_KEYS) {
    if (payload[key] === undefined || payload[key] === null) {
      throw new PayloadError(
        `Badge payload is missing "${key}". A partial payload must never be signed.`,
      );
    }
  }
  if (Object.keys(payload).length !== REQUIRED_KEYS.length) {
    // An extra field would be signed by one implementation and ignored by
    // another, which is how signature schemes quietly stop meaning anything.
    throw new PayloadError(
      `Badge payload has unexpected fields: ${Object.keys(payload)
        .filter((key) => !(REQUIRED_KEYS as readonly string[]).includes(key))
        .join(', ')}`,
    );
  }
  if (payload.v !== PAYLOAD_VERSION) {
    throw new PayloadError(`Unsupported badge payload version ${String(payload.v)}.`);
  }
  if (!Number.isFinite(payload.score) || payload.score < 0 || payload.score > 100) {
    throw new PayloadError('Badge score must be a number between 0 and 100.');
  }

  const ordered = REQUIRED_KEYS.map((key) => `${JSON.stringify(key)}:${serialise(payload[key])}`);
  return `{${ordered.join(',')}}`;
}

function serialise(value: string | number | boolean): string {
  // Scores are fixed to one decimal so that 82 and 82.0 cannot produce two
  // different signatures for the same assessment.
  if (typeof value === 'number') return JSON.stringify(Number(value.toFixed(1)));
  return JSON.stringify(value);
}

export function parsePayload(raw: unknown): BadgePayload {
  if (typeof raw !== 'object' || raw === null)
    throw new PayloadError('Badge payload is not an object.');
  const payload = raw as BadgePayload;
  canonicalise(payload); // validates, and throws with a useful message if not
  return payload;
}
