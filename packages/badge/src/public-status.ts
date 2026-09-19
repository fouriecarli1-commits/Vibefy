/**
 * The answer a stranger's software gets when it asks about a badge.
 *
 * A marketplace that wants to show our mark beside a listing, a directory of
 * AI tools, a platform that wants an assessment before it publishes something —
 * none of them will build against a thing they have to negotiate access to
 * first. So this is public, unauthenticated, CORS-open and cached, and it is
 * how the mark reaches places we would never sell to.
 *
 * Two shapes, and the difference between them is a privacy decision rather than
 * a convenience one.
 *
 *   · `badgeStatus`   — one badge, asked for by its identifier. The caller
 *                       already holds the identifier, so asking tells us
 *                       nothing we did not already give them.
 *   · `liveBadgeList` — every live badge, in one cacheable document. Anybody
 *                       who wants to know whether a site has a badge can
 *                       download this and check locally, without telling us
 *                       which site they are looking at.
 *
 * There is deliberately no "does this domain have a badge" lookup. It is the
 * obvious third shape and it is the one that would let somebody build a browser
 * extension that reports every page a person visits to us. The list above does
 * the same job without the leak, so the leak has nowhere to hide behind
 * convenience.
 */

export type PublicBadgeState = 'live' | 'suspended' | 'expired' | 'revoked';

export interface PublicBadgeStatus {
  readonly badgeId: string;
  readonly state: PublicBadgeState;
  /** True only for `live`. Present because `state === 'live'` gets mistyped. */
  readonly isLive: boolean;
  readonly appName: string;
  /** The origin the badge was issued for. A badge shown elsewhere is misuse. */
  readonly certifiedOrigin: string | null;
  readonly rubricVersion: string;
  readonly assessedOn: string;
  readonly expiresOn: string | null;
  readonly verificationPage: string;
  /** Said in the payload, because this is the field people act on. */
  readonly meaning: string;
  readonly limits: string;
}

/** A row as the public badge view hands it over. */
export interface BadgeRow {
  readonly public_id: string;
  readonly slug: string;
  readonly status: string;
  readonly app_name: string;
  readonly certified_origin: string | null;
  readonly rubric_version: string;
  readonly assessed_at: string | Date;
  readonly expires_at: string | Date | null;
}

const STATE_BY_STATUS: Readonly<Record<string, PublicBadgeState>> = {
  active: 'live',
  suspended: 'suspended',
  expired: 'expired',
  revoked: 'revoked',
};

/**
 * What a live badge means, in the caller's own response.
 *
 * Not in the documentation, because the single most likely way to misuse this
 * is to read `isLive: true` and put a reassurance we never gave beside
 * somebody's listing. If this sentence is in the payload, whoever writes that
 * code has read it.
 */
export const BADGE_MEANING =
  'VibefyCode assessed this application against the named version of its published rubric, on the named date, within the scope the application’s owner authorised, and it met the published threshold.';

export const BADGE_LIMITS =
  'It is not a statement that the application has no defects, that it is lawful, or that it is fit for any particular purpose. It describes one assessment on one date. Absence of a finding is not evidence of absence of a defect.';

const asDate = (value: string | Date): string =>
  (value instanceof Date ? value.toISOString() : value).slice(0, 10);

export function badgeStatus(row: BadgeRow, verifyOrigin: string): PublicBadgeStatus {
  // An unknown status is not reported as live. There is no status the database
  // can invent that should make a stranger's page show our mark.
  const state = STATE_BY_STATUS[row.status] ?? 'revoked';
  return {
    badgeId: row.public_id,
    state,
    isLive: state === 'live',
    appName: row.app_name,
    certifiedOrigin: row.certified_origin,
    rubricVersion: row.rubric_version,
    assessedOn: asDate(row.assessed_at),
    expiresOn: row.expires_at === null ? null : asDate(row.expires_at),
    verificationPage: `${verifyOrigin.replace(/\/+$/, '')}/a/${row.slug}`,
    meaning: BADGE_MEANING,
    limits: BADGE_LIMITS,
  };
}

export interface LiveBadgeEntry {
  readonly badgeId: string;
  readonly certifiedOrigin: string | null;
  readonly rubricVersion: string;
  readonly assessedOn: string;
  readonly expiresOn: string | null;
  readonly verificationPage: string;
}

export interface LiveBadgeList {
  readonly generatedAt: string;
  readonly count: number;
  readonly badges: readonly LiveBadgeEntry[];
  readonly meaning: string;
  readonly limits: string;
  readonly staleness: string;
}

/**
 * Every badge that is live at the moment the list is built.
 *
 * The staleness note is not a disclaimer, it is the operating instruction. A
 * badge can be suspended a minute after this document is served, and anything
 * making a decision that matters should ask about the one badge it cares about
 * rather than trusting a list it downloaded this morning.
 */
export function liveBadgeList(
  rows: readonly BadgeRow[],
  verifyOrigin: string,
  now: Date = new Date(),
): LiveBadgeList {
  const live = rows.filter((row) => STATE_BY_STATUS[row.status] === 'live');
  return {
    generatedAt: now.toISOString(),
    count: live.length,
    badges: live.map((row) => ({
      badgeId: row.public_id,
      certifiedOrigin: row.certified_origin,
      rubricVersion: row.rubric_version,
      assessedOn: asDate(row.assessed_at),
      expiresOn: row.expires_at === null ? null : asDate(row.expires_at),
      verificationPage: `${verifyOrigin.replace(/\/+$/, '')}/a/${row.slug}`,
    })),
    meaning: BADGE_MEANING,
    limits: BADGE_LIMITS,
    staleness:
      'This list is a snapshot. A badge can be suspended or revoked a minute after it was built, and suspension is the mechanism by which a mark stops meaning anything. Anything making a decision that matters should ask about the one badge it cares about rather than trusting a copy of this document.',
  };
}
