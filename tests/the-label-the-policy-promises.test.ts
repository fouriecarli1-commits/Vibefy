/**
 * "Labelled as such wherever their rating appears."
 *
 * Section 5 of `legal/rating-methodology-and-independence.md`. The verification
 * page renders the label and the directory renders it — those are the two the
 * sentence names out loud. The two machine-readable surfaces carried no
 * disclosure at all: `/api/badge/<id>/status` and `/api/badges/live`, each
 * built because the signed payload is awkward to use, each documented as what a
 * marketplace actually wants, and each the thing an integrator will render
 * verbatim. So our mark could appear beside a paying marketing client's listing
 * with nothing anywhere in what the integrator received to say so.
 *
 * The signed payload had it the whole time, as `ownerIsMarketingClient`, which
 * is the detail that makes this a gap rather than an omission: the fact was
 * carried through signing and dropped by the convenience endpoints built on top
 * of it.
 *
 * Nothing tested the promise on any surface. The page and the directory keep it
 * by having been written carefully, which is how the two beside them did not.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PAID_RELATIONSHIP_DISCLOSURE,
  badgeStatus,
  liveBadgeList,
  type BadgeRow,
} from '../packages/badge/src/index.ts';
import { SIGNED_KEYS } from '../packages/badge/src/payload.ts';
import { withoutComments } from './setup/source.ts';

const POLICY = readFileSync('legal/rating-methodology-and-independence.md', 'utf8');

const row: BadgeRow = {
  public_id: 'pub-1',
  slug: 'an-app',
  status: 'active',
  app_name: 'An App',
  certified_origin: 'https://customer.example',
  rubric_version: '1.1.0',
  assessed_at: '2026-10-01T00:00:00.000Z',
  expires_at: null,
};

describe('the promise itself', () => {
  it('is still the sentence this test is about', () => {
    // The positive control. If the policy stops promising a label wherever the
    // rating appears, every assertion below is answering a question nobody
    // asked any more, and that should be read rather than assumed.
    // Line breaks in the markdown fall inside the phrase, so the whitespace
    // is matched rather than assumed — the first version of this assertion
    // failed on the document's wrapping and not on its meaning.
    const flowed = POLICY.replace(/\s+/g, ' ');
    expect(flowed).toContain('**labelled as such wherever their rating appears**');
    expect(flowed).toContain('including on the verification page');
  });
});

describe('the two machine-readable surfaces', () => {
  it('discloses a paid relationship on the one-badge answer', () => {
    const status = badgeStatus({ ...row, owner_is_marketing_client: true }, 'https://v.example');
    expect(status.paidRelationship).toBe(PAID_RELATIONSHIP_DISCLOSURE);
  });

  it('says nothing where there is nothing to say', () => {
    // The over-correction worth a test: a disclosure on every badge would make
    // the label meaningless, which is the same as not having one.
    expect(
      badgeStatus({ ...row, owner_is_marketing_client: false }, 'https://v.example')
        .paidRelationship,
    ).toBeNull();
  });

  it('treats an absent column as nothing known rather than nothing to disclose', () => {
    /*
     * A caller selecting fewer columns gets `undefined`, and `undefined` must
     * not read as "no relationship" in a way that looks identical to a checked
     * false. It renders as null either way — there is nothing truthful to put
     * in the field — and the thing that keeps it honest is the test below,
     * which insists both routes select the column.
     */
    expect(badgeStatus(row, 'https://v.example').paidRelationship).toBeNull();
  });

  it('discloses it per entry in the whole-list document', () => {
    const list = liveBadgeList(
      [
        { ...row, owner_is_marketing_client: true },
        { ...row, public_id: 'pub-2', slug: 'another', owner_is_marketing_client: false },
      ],
      'https://v.example',
    );
    expect(list.badges[0]?.paidRelationship).toBe(PAID_RELATIONSHIP_DISCLOSURE);
    expect(list.badges[1]?.paidRelationship).toBeNull();
  });

  it('is a sentence an integrator can render, not a bare flag', () => {
    // Whoever renders this should not have to invent the wording of somebody
    // else's disclosure, and most will render what we hand them.
    expect(PAID_RELATIONSHIP_DISCLOSURE).toMatch(/purchased marketing services/i);
    expect(PAID_RELATIONSHIP_DISCLOSURE).toMatch(/no plan, price or commercial relationship/i);
    expect(PAID_RELATIONSHIP_DISCLOSURE.length).toBeGreaterThan(120);
  });
});

describe('every public badge route reads it', () => {
  /*
   * The sweep, so a sixth surface cannot be added quietly.
   *
   * Enumerated from the filesystem rather than listed here: the gap being
   * fixed existed because two endpoints were built after the promise was
   * written and nobody went back to the promise.
   */
  const routes = (() => {
    const found: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory)) {
        const path = join(directory, entry);
        if (entry === 'route.ts') found.push(path);
        else if (!entry.includes('.')) walk(path);
      }
    };
    walk('apps/web/app/api/badge');
    walk('apps/web/app/api/badges');
    return found;
  })();

  it('found the routes, or this proves nothing', () => {
    expect(routes.length).toBeGreaterThanOrEqual(3);
  });

  it('selects the disclosure column wherever it reads a badge row', () => {
    for (const path of routes) {
      const source = withoutComments(readFileSync(path, 'utf8'));
      // The signed-payload route selects the payload itself, which carries
      // `ownerIsMarketingClient` as a signed key — so it discloses by
      // construction and selecting the column again would be noise.
      const readsThePayload = /select[^`]*payload/s.test(source);
      if (readsThePayload) {
        expect(SIGNED_KEYS, `${path} relies on the payload carrying it`).toContain(
          'ownerIsMarketingClient',
        );
        continue;
      }
      expect(source, `${path} answers about a badge without the paid-relationship label`).toMatch(
        /owner_is_marketing_client/,
      );
    }
  });
});

describe('the surfaces the policy names out loud', () => {
  it('labels it on the verification page', () => {
    const page = withoutComments(readFileSync('apps/web/app/a/[slug]/page.tsx', 'utf8'));
    expect(page).toMatch(/owner_is_marketing_client/);
  });

  it('labels it on the directory listing', () => {
    const page = withoutComments(readFileSync('apps/web/app/directory/page.tsx', 'utf8'));
    expect(page).toMatch(/ownerIsMarketingClient/);
  });
});
