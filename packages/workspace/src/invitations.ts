/**
 * Invitation tokens.
 *
 * An invitation link is a credential: whoever holds it joins a workspace and can
 * see every assessment in it. So the same rules apply as to any other credential
 * we handle — it is generated with a CSPRNG, only its hash is stored, it expires,
 * and it is compared in constant time.
 *
 * The plaintext token exists in exactly one place: the email we send. If that
 * email is lost, the invitation is reissued, not recovered — we cannot recover it,
 * which is the property we want.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const INVITATION_TTL_DAYS = 7;

export interface NewInvitationToken {
  /** Goes in the email. Never stored. */
  readonly token: string;
  /** Goes in the database. */
  readonly tokenSha256: string;
  readonly expiresAt: Date;
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createInvitationToken(now: Date = new Date()): NewInvitationToken {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + INVITATION_TTL_DAYS);
  return { token, tokenSha256: hashInvitationToken(token), expiresAt };
}

/** Constant-time, so a wrong token cannot be found one character at a time. */
export function tokenMatches(token: string, storedSha256: string): boolean {
  const candidate = Buffer.from(hashInvitationToken(token), 'hex');
  let stored: Buffer;
  try {
    stored = Buffer.from(storedSha256, 'hex');
  } catch {
    return false;
  }
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

export type InvitationRefusal =
  | 'not_found'
  | 'already_accepted'
  | 'revoked'
  | 'expired'
  | 'wrong_account';

export interface InvitationRecord {
  readonly email: string;
  readonly acceptedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly expiresAt: Date;
}

/**
 * Whether an invitation may be accepted, and by whom.
 *
 * The address is checked as well as the token. An invitation forwarded to
 * somebody else is a link that works for the wrong person, and "we sent it to
 * the right inbox" is not a defence anyone accepts afterwards.
 */
export function canAccept(
  invitation: InvitationRecord | null,
  signedInEmail: string,
  now: Date = new Date(),
): { ok: true } | { ok: false; reason: InvitationRefusal; message: string } {
  if (!invitation) {
    return { ok: false, reason: 'not_found', message: 'That invitation link is not valid.' };
  }
  if (invitation.acceptedAt) {
    return {
      ok: false,
      reason: 'already_accepted',
      message: 'That invitation has already been used.',
    };
  }
  if (invitation.revokedAt) {
    return { ok: false, reason: 'revoked', message: 'That invitation was withdrawn.' };
  }
  if (invitation.expiresAt <= now) {
    return {
      ok: false,
      reason: 'expired',
      message: `That invitation expired on ${invitation.expiresAt.toISOString().slice(0, 10)}. Ask for a new one.`,
    };
  }
  if (invitation.email.trim().toLowerCase() !== signedInEmail.trim().toLowerCase()) {
    return {
      ok: false,
      reason: 'wrong_account',
      message: `That invitation was sent to a different address. Sign in as ${invitation.email} to accept it.`,
    };
  }
  return { ok: true };
}
