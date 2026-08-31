/**
 * Telling somebody where to put the badge.
 *
 * "Paste this where you want the badge to appear" is only an instruction if you
 * already know how to edit your site — and the people this product exists for
 * built theirs by describing it to a model. Some of them have never opened a
 * footer component.
 *
 * The sharper problem is that the HTML snippet does not compile in JSX. Most of
 * them are on React, so following the instruction exactly would break their
 * build. A trust mark whose first act is to break your site starts badly.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BADGE_USAGE,
  EMBED_PLACEMENTS,
  badgeAltText,
  badgeEmbedJsx,
  badgeEmbedSnippet,
} from '../packages/shared/src/index.ts';

const facts = {
  appName: 'Kettle',
  rubricVersion: '1.0.0',
  assessedOn: '2026-08-22',
  verifyOrigin: 'https://verify.vibefycode.example',
  publicId: 'abcdef0123456789',
  slug: 'kettle',
};

const page = readFileSync(join(process.cwd(), 'apps/web/app/console/apps/[id]/page.tsx'), 'utf8');

describe('the React snippet', () => {
  it('is valid JSX where the HTML one is not', () => {
    const jsx = badgeEmbedJsx(facts);
    // The three things that make the HTML form a syntax error in a component.
    expect(jsx).not.toContain('style="');
    expect(jsx).toContain('style={{');
    expect(jsx).toContain('/>');
    expect(jsx).not.toMatch(/\sclass=/);
  });

  it('keeps every rule the licence puts on the HTML one', () => {
    const jsx = badgeEmbedJsx(facts);
    expect(jsx).toContain(`${facts.verifyOrigin}/a/${facts.slug}`);
    expect(jsx).toContain(`${facts.publicId}.svg`);
    expect(jsx).toContain(JSON.stringify(badgeAltText(facts)));
    expect(jsx).toContain('rel="noopener"');
  });

  it('renders the same badge as the HTML one', () => {
    const html = badgeEmbedSnippet(facts);
    const jsx = badgeEmbedJsx(facts);
    for (const fragment of [`/a/${facts.slug}`, `${facts.publicId}.svg?size=128`]) {
      expect(html).toContain(fragment);
      expect(jsx).toContain(fragment);
    }
  });

  it('refuses a size the licence refuses, exactly as the HTML one does', () => {
    // Enforced in one place and borrowed here, so the two forms cannot come to
    // disagree about what is permitted.
    expect(() => badgeEmbedJsx({ ...facts, sizePx: BADGE_USAGE.minimumSizePx - 1 })).toThrow();
  });
});

describe('where it goes', () => {
  it('covers the ways these customers actually built their sites', () => {
    const platforms = EMBED_PLACEMENTS.map((placement) => placement.platform).join(' ');
    for (const expected of ['Next.js', 'HTML', 'WordPress', 'Webflow', 'Wix', 'Framer']) {
      expect(platforms).toContain(expected);
    }
  });

  it('sends React users to the React snippet and everybody else to the HTML one', () => {
    const react = EMBED_PLACEMENTS.find((placement) => placement.platform.includes('React'));
    expect(react?.form).toBe('jsx');
    for (const placement of EMBED_PLACEMENTS.filter((p) => !p.platform.includes('React'))) {
      expect(placement.form, placement.platform).toBe('html');
    }
  });

  it('gives steps rather than a gesture', () => {
    for (const placement of EMBED_PLACEMENTS) {
      expect(placement.steps.length, placement.platform).toBeGreaterThanOrEqual(2);
      for (const step of placement.steps) {
        expect(step.length, `${placement.platform}: "${step}"`).toBeGreaterThan(20);
      }
    }
  });

  it('says to publish, where publishing is a separate act', () => {
    // The Webflow one is the trap: an Embed renders as a grey box in the
    // designer and only appears on the published site, so somebody will
    // otherwise conclude the badge is broken.
    const webflow = EMBED_PLACEMENTS.find((placement) => placement.platform === 'Webflow');
    expect(webflow?.steps.join(' ')).toMatch(/publish/i);
  });
});

describe('the console offers both', () => {
  it('shows the HTML and the React snippet, not one of them', () => {
    expect(page).toContain('badgeEmbedSnippet(');
    expect(page).toContain('badgeEmbedJsx(');
  });

  it('explains why the HTML one will not do for a component', () => {
    expect(page).toMatch(/will not compile in JSX/i);
  });

  it('carries the placement steps', () => {
    expect(page).toContain('EMBED_PLACEMENTS');
    expect(page).toMatch(/Where exactly does it go/i);
  });

  it('suggests the footer, which is where a visitor looks', () => {
    expect(page).toMatch(/footer/i);
  });
});

describe('the link, before it is somebody else’s problem', () => {
  // Whitespace-collapsed: a sentence does not change meaning because the
  // formatter moved the line break.
  const collapsed = page.replace(/\s+/g, ' ');

  it('shows the verification URL on its own, clickable', () => {
    // Both snippets carry it, and a snippet is the one place nobody checks a
    // URL — it is a block of code to be copied, not a link to be followed.
    expect(collapsed).toMatch(/Where the badge sends people/i);
    expect(collapsed).toContain('href={`${verifyOrigin}/a/${String(badge.slug)}`}');
  });

  it('says why the badge can show while the link does not', () => {
    // The image and the link are separate addresses. If one is altered in
    // transit the mark still appears, and the first person to find out is a
    // visitor who clicked it to check — the worst possible person to find out.
    expect(collapsed).toMatch(/the two are separate addresses/i);
  });
});
