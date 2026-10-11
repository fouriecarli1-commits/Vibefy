/**
 * What a screen reader is told about a badge that is no longer current.
 *
 * Our own two pages that show a badge — the public verification page and the
 * console — wrote the `alt` attribute out by hand, and what they wrote was the
 * sentence for an *active* badge:
 *
 *     alt={`Verified by VibefyCode — ${badge.app_name}, Rubric v${badge.rubric_version},
 *           assessed ${assessedOn}. Scope-limited assessment, not a security guarantee.`}
 *
 * On all four statuses. A suspended, expired or revoked badge serves the
 * drained artwork and the page prints a red status line beside it, and neither
 * of those reaches a screen reader: the renderer's own `role="img"` and
 * `aria-label` live inside an SVG fetched through `<img src>`, which is a
 * replaced element contributing nothing to the page, and the status line is a
 * separate element the image's name does not include. The accessible name of
 * the picture was the whole claim, and it was false for three of the four
 * states — on the one page whose purpose is to say precisely what is and is not
 * true, to the readers least able to see the red line.
 *
 * `badgeDescription` has handled all four states since the renderer did, and it
 * is what labels the SVG itself. It had no caller outside its own module.
 *
 * The sentence is now written in one place, which is the other half of this: an
 * `alt` assembled by hand is one that keeps the old wording when the scope
 * qualifier is next revised, and the qualifier is not ours to drift.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { badgeDescription } from '../packages/badge/src/index.ts';
import { badgeAltText } from '../packages/shared/src/index.ts';
import { withoutComments } from './setup/source.ts';

const FACTS = {
  appName: 'Kettle',
  rubricVersion: '1.1.0',
  assessedOn: '2026-08-30',
} as const;

const source = (...path: string[]) =>
  withoutComments(readFileSync(join(process.cwd(), ...path), 'utf8'));

const PAGES = {
  'the verification page': source('apps/web/app/a/[slug]/page.tsx'),
  'the console': source('apps/web/app/console/apps/[id]/page.tsx'),
};

describe('the name of the picture', () => {
  it('is the published sentence while the badge is active', () => {
    // The positive control: the common case is unchanged, and it is unchanged
    // because it comes from the same function the embed snippet uses.
    expect(badgeDescription({ status: 'active', ...FACTS })).toBe(badgeAltText(FACTS));
    expect(badgeDescription({ status: 'active', ...FACTS })).toContain(
      'Scope-limited assessment, not a security guarantee.',
    );
  });

  it('does not claim verification for a badge that is not verified', () => {
    for (const status of ['suspended', 'expired', 'revoked'] as const) {
      const name = badgeDescription({ status, ...FACTS });
      expect(name).toMatch(/^Not currently verified by VibefyCode/);
      expect(name).toContain(status);
      // Still the facts, because "not current" raises the question of what was
      // assessed and when, and this is the only text that can answer it.
      expect(name).toContain(FACTS.appName);
      expect(name).toContain(FACTS.rubricVersion);
      expect(name).toContain(FACTS.assessedOn);
      expect(name).not.toMatch(/^Verified by VibefyCode/);
    }
  });
});

describe('our own pages', () => {
  for (const [where, page] of Object.entries(PAGES)) {
    it(`shows a badge, on ${where}`, () => {
      // A positive control per page: both assertions below pass vacuously on a
      // page that no longer renders the mark at all.
      expect(page).toMatch(/\.svg`\}/);
    });

    it(`names it with the status, on ${where}`, () => {
      expect(page).toContain('alt={badgeDescription(');
      // The badge's own status, not a literal. `status: 'active'` here is the
      // defect with one more step in it.
      const argument = /alt=\{badgeDescription\(\{\s*status:\s*([^,\n]+)/.exec(page)?.[1];
      expect(argument).toBeDefined();
      expect(argument).not.toMatch(/['"]/);
    });

    it(`does not write the sentence out again, on ${where}`, () => {
      expect(page).not.toContain('Verified by VibefyCode —');
    });
  }

  it('does not promise verification in the card a pasted link shows', () => {
    // `robots` is not the fix and never was: a share preview is not fetched by
    // an indexer. Both are asserted — the exclusion from the index is still
    // right, and it is not what makes the card honest.
    const page = PAGES['the verification page'];
    expect(page).toContain("robots: { index: badge.status === 'active'");
    expect(page).toContain('const description = badgeDescription(');
    expect(page).toMatch(/const title =\s*\n?\s*badge\.status === 'active'/);
  });

  it('leaves the sentence with one author', () => {
    // Everywhere a badge is described, not only the two pages above. The home
    // page's illustration of the mark is not a specific badge and says so.
    const files = ['apps/web/app/a/[slug]/page.tsx', 'apps/web/app/console/apps/[id]/page.tsx'];
    for (const file of files) {
      expect(source(file)).not.toContain('Scope-limited assessment, not a security guarantee');
    }
  });
});
