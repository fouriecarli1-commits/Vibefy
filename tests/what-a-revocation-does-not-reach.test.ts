/**
 * What a revocation reaches, and the one thing it does not.
 *
 * Three places said the same sentence: the reviewer's notice after revoking,
 * the header of `/review/badges`, and the runbook. All three said a revocation
 * "stops every embedded instance reading as verified within minutes", and that
 * is true of the picture — we serve it, it is cached for five minutes, and the
 * struck artwork replaces the seal everywhere at once.
 *
 * It is not true of the page around it. The `alt` text in the snippet a
 * customer pasted is fixed in their HTML at the moment they copied it, so a
 * screen reader on their site goes on hearing the sentence for a live badge
 * after we have revoked it. Our own two pages name the badge from its status;
 * somebody else's page is theirs, and the licence is what obliges them to take
 * the mark down.
 *
 * Which makes this the sentence a reviewer decides from — whether revoking is
 * the end of it or whether they also have to write to the customer — so it has
 * to be the one that is true. `docs/OPEN_ITEMS.md` carries the underlying gap:
 * an alt text that cannot follow a status change is a question about the
 * published badge usage rules, not a defect to patch.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');
const sources: Record<string, string> = {
  "the reviewer's notice": read('apps/web/app/review/badge-actions.ts'),
  'the badges page': read('apps/web/app/review/badges/page.tsx'),
  'the runbook': read('docs/RUNBOOK.md'),
};

describe('the claim about an embedded badge', () => {
  for (const [where, source] of Object.entries(sources)) {
    it(`still makes it, on ${where}`, () => {
      // The positive control: each of these says what a revocation does reach,
      // and the assertion below is about the qualification beside it.
      expect(source).toMatch(/every embedded instance/);
    });

    it(`says the picture stops showing, not that the page stops saying, on ${where}`, () => {
      expect(source).not.toMatch(/every embedded instance\s+reading as verified/);
      expect(source).toMatch(
        /embedded instance\s+showing as verified|instance stops showing as verified/,
      );
    });

    it(`names the alt text as the thing it does not reach, on ${where}`, () => {
      expect(source.replace(/\s+/g, ' ')).toMatch(/alt.{0,6}text/i);
      expect(source.replace(/\s+/g, ' ')).toMatch(/licence obliges them|obliges them to do/i);
    });
  }
});
