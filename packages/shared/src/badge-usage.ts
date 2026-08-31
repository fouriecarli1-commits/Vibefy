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
  /** e.g. https://verify.vibefycode.example */
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
    throw new BadgeUsageError(
      'The badge is served over HTTPS from the VibefyCode verification origin only.',
    );
  }

  const alt = badgeAltText(options);
  const verificationUrl = `${origin}/a/${options.slug}`;
  // The size travels with the request. The renderer serves the full seal or the
  // compact layout accordingly — a seal shrunk to 96px is a smudge, and the
  // licence permits embedding from 96px.
  const imageUrl = `${origin}/badge/${options.publicId}.svg?size=${size}`;

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

/**
 * The same badge, as JSX.
 *
 * Most of the people this product exists for built their application in React,
 * and pasting the HTML above into a component is a syntax error: `style` takes
 * an object, `class` is `className`, and an unclosed `<img>` will not parse.
 * Handing somebody a snippet that breaks their build the moment they follow the
 * instructions is a bad way to begin a relationship with a trust mark.
 *
 * Identical in what it renders and in what the licence requires of it: the link
 * to the verification page, the alt text carrying the scope, the size and the
 * clear space.
 */
export function badgeEmbedJsx(options: BadgeEmbedOptions): string {
  const size = options.sizePx ?? 128;
  // Validated by the HTML form, which refuses anything the licence does not
  // permit. Calling it here means the two can never disagree about the rules.
  badgeEmbedSnippet(options);

  const origin = options.verifyOrigin.replace(/\/+$/, '');
  const alt = badgeAltText(options);
  const padding = Math.round(size * BADGE_USAGE.clearSpaceRatio);

  return [
    `<a`,
    `  href="${origin}/a/${options.slug}"`,
    `  rel="noopener"`,
    `  target="_blank"`,
    `  style={{ display: 'inline-block', padding: ${padding} }}`,
    `>`,
    `  <img`,
    `    src="${origin}/badge/${options.publicId}.svg?size=${size}"`,
    `    width={${size}}`,
    `    height={${size}}`,
    `    alt=${JSON.stringify(alt)}`,
    `    loading="lazy"`,
    `    decoding="async"`,
    `  />`,
    `</a>`,
  ].join('\n');
}

/**
 * Where the snippet goes, by the tools the people who need it actually use.
 *
 * "Paste this where you want the badge to appear" is only an instruction if you
 * already know how to edit your site. Somebody who built an application by
 * describing it to a model may never have opened a footer component.
 */
export interface EmbedPlacement {
  readonly platform: string;
  readonly steps: readonly string[];
  /** Which form of the snippet that platform takes. */
  readonly form: 'html' | 'jsx';
}

export const EMBED_PLACEMENTS: readonly EmbedPlacement[] = [
  {
    platform: 'Next.js or React',
    form: 'jsx',
    steps: [
      'Open the component that renders your footer — often app/layout.tsx, components/Footer.tsx, or similar.',
      'Paste the JSX inside it, near your copyright line.',
      'Save, commit and deploy. On Vercel that is a push to your main branch.',
    ],
  },
  {
    platform: 'Plain HTML',
    form: 'html',
    steps: [
      'Open the page you want it on, or your shared footer include.',
      'Paste the HTML just before the closing </footer> tag, or before </body> if you have no footer.',
      'Upload the file and reload the page.',
    ],
  },
  {
    platform: 'WordPress',
    form: 'html',
    steps: [
      'Appearance → Editor → Patterns, or Appearance → Widgets on an older theme.',
      'Add a Custom HTML block to the footer area.',
      'Paste the HTML into it and update.',
    ],
  },
  {
    platform: 'Webflow',
    form: 'html',
    steps: [
      'Drag an Embed element into your footer symbol.',
      'Paste the HTML into it and save.',
      'Publish the site — an Embed does not render inside the designer, only on the published page.',
    ],
  },
  {
    platform: 'Squarespace or Wix',
    form: 'html',
    steps: [
      'Add a Code block (Squarespace) or an Embed HTML element (Wix) to the footer section.',
      'Paste the HTML into the code area, replacing the placeholder markup it starts with.',
      'Save, then publish the site so the change reaches visitors.',
    ],
  },
  {
    platform: 'Framer',
    form: 'html',
    steps: [
      'Insert → Embed, and choose the HTML option rather than a URL.',
      'Paste the HTML in, then place the component in your footer.',
      'Publish the site — the embed does not render while you are editing.',
    ],
  },
];

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** The SVG filename a given status renders from. */
export function badgeAssetFor(status: BadgeStatus): string {
  return status === 'active' ? 'vibefycode-badge-verified.svg' : `vibefycode-badge-${status}.svg`;
}
