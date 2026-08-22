/**
 * Badge usage rules, as code.
 *
 * A badge that does not link to its verification page is a claim without
 * evidence, so the only supported way to obtain an embed snippet is this
 * function — and it cannot produce an unlinked badge. The rules below are the
 * same ones the Badge Licence states in words; keeping one copy means the
 * licence and the product cannot disagree.
 */
import { badgeAltText, type ScopeStatementFacts } from './legal.ts';

export const BADGE_USAGE = {
  /** Below this the wordmark stops being legible and the mark stops being honest. */
  minimumSizePx: 96,
  /** Clear space on every side, as a fraction of the rendered badge width. */
  clearSpaceRatio: 0.25,
  /** Rendered from our origin on every load. That is what makes revocation instant. */
  servedFromOurOriginOnly: true,
  alterationsForbidden: [
    'recolouring',
    'rotation',
    'cropping',
    'distortion',
    'altering the wordmark',
    'adding text inside the mark',
    'removing the link to the verification page',
  ],
} as const;

export type BadgeStatus = 'active' | 'suspended' | 'expired' | 'revoked';

export interface BadgeEmbedOptions extends ScopeStatementFacts {
  /** e.g. https://verify.vibefy.example */
  readonly verifyOrigin: string;
  readonly publicId: string;
  readonly slug: string;
  readonly sizePx?: number;
}

export class BadgeUsageError extends Error {}

/**
 * The embed snippet. Always an anchor wrapping an image served from our origin,
 * always carrying the scope-qualified alt text, never smaller than the minimum.
 */
export function badgeEmbedSnippet(options: BadgeEmbedOptions): string {
  const size = options.sizePx ?? 128;

  if (size < BADGE_USAGE.minimumSizePx) {
    throw new BadgeUsageError(
      `Badge must render at least ${BADGE_USAGE.minimumSizePx}px; ${size}px was requested. Below that the mark is not legible and the licence does not permit it.`,
    );
  }

  const origin = options.verifyOrigin.replace(/\/+$/, '');
  if (!/^https:\/\//.test(origin)) {
    throw new BadgeUsageError('The badge is served over HTTPS from the Vibefy verification origin only.');
  }

  const alt = badgeAltText(options);
  const verificationUrl = `${origin}/a/${options.slug}`;
  const imageUrl = `${origin}/badge/${options.publicId}.svg`;

  return [
    `<a href="${verificationUrl}" rel="noopener" target="_blank"`,
    `   style="display:inline-block;padding:${Math.round(size * BADGE_USAGE.clearSpaceRatio)}px">`,
    `  <img src="${imageUrl}"`,
    `       width="${size}" height="${size}"`,
    `       alt="${escapeAttribute(alt)}"`,
    `       loading="lazy" decoding="async">`,
    `</a>`,
  ].join('\n');
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** The SVG filename a given status renders from. */
export function badgeAssetFor(status: BadgeStatus): string {
  return status === 'active' ? 'vibefy-badge-verified.svg' : `vibefy-badge-${status}.svg`;
}
