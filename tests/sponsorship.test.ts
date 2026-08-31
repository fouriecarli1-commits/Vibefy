/**
 * Selling advertising space without selling the ratings.
 *
 * Anré's argument for this is the right one and it is also the constraint: the
 * app is quiet, and quiet is what makes a space on it worth paying for. One
 * placement on a page nobody has to scroll past nine others to reach is worth
 * more than nine placements — and it stays worth that only while the rules
 * below hold.
 *
 * The directory has been carrying this sentence since M7, written before there
 * was anything that could break it:
 *
 *     "if paid placement is ever introduced it will be labelled as advertising
 *      and kept out of this ordering"
 *
 * These tests are that promise, kept.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  FORBIDDEN_SURFACES,
  ForbiddenPlacementError,
  PERMITTED_PLACEMENTS,
  SPONSOR_EXPLANATION,
  SPONSOR_LABEL,
  assertPlaceable,
  isSelfAdjacent,
  mayPlaceOn,
  sponsorDisclosures,
} from '../packages/sponsorship/src/index.ts';
import { NO_PAID_PLACEMENT } from '../packages/directory/src/index.ts';
import { connect } from './setup/client.ts';
import { makeReviewer, seedAccount, type SeededAccount } from './setup/seed.ts';

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');
const collapse = (text: string) => text.replace(/\s+/g, ' ');

let db: Client;
let account: SeededAccount;
let admin: SeededAccount;

beforeAll(async () => {
  db = await connect();
  account = await seedAccount(db, 'sponsor');
  admin = await seedAccount(db, 'sponsor-admin');
  await makeReviewer(db, admin.userId);
  await db.query(`update public.users set platform_role = 'admin' where id = $1`, [admin.userId]);
});

afterAll(async () => {
  await db?.end();
});

/** A placement, ready to be argued with. */
async function propose(overrides: Record<string, unknown> = {}) {
  const values = {
    advertiser_name: 'Kettle Tools',
    advertiser_url: 'https://kettle.example',
    headline: 'Build faster with Kettle',
    body: 'A toolkit for people who ship on their own, from the people who wrote it.',
    placement: 'methodology',
    starts_on: '2026-09-01',
    ends_on: '2026-10-01',
    status: 'pending_review',
    price_cents: 75_000,
    ...overrides,
  };
  const columns = Object.keys(values);
  const { rows } = await db.query<{ id: string }>(
    `insert into public.sponsorships (${columns.join(', ')})
     values (${columns.map((_, index) => `$${index + 1}`).join(', ')}) returning id`,
    Object.values(values),
  );
  return rows[0]!.id;
}

describe('where an advertisement may never appear', () => {
  it('names the surfaces that show a rating, and refuses them', () => {
    // An advertisement standing beside the evidence it paid to be near is not
    // repaired by a label — the label makes it worse by proving somebody
    // thought about it.
    for (const surface of ['/a/[slug]', '/console/reports/[assessmentId]', '/verify', '/review']) {
      expect(Object.keys(FORBIDDEN_SURFACES)).toContain(surface);
      expect(mayPlaceOn(surface)).toBe(false);
      expect(() => assertPlaceable(surface)).toThrow(ForbiddenPlacementError);
    }
  });

  it('refuses anything not explicitly permitted, rather than permitting anything not forbidden', () => {
    // A page added next year is not advertising space until somebody decides
    // it is.
    expect(mayPlaceOn('/some/page/nobody/has/written/yet')).toBe(false);
    expect(PERMITTED_PLACEMENTS).toEqual(['directory', 'how_it_works', 'methodology']);
  });

  it('cannot hold a forbidden surface in the database either', async () => {
    // The enum is the first lock and the package is the second. This is the
    // first one.
    await expect(propose({ placement: 'verification_page' })).rejects.toThrow();
  });

  it('never renders on a surface it was not built for', () => {
    const slot = read('apps/web/components/sponsor-slot.tsx');
    expect(slot).toContain('assertPlaceable(placement)');
  });
});

describe('what a placement must say about itself', () => {
  it('says it in the first two words, in nobody’s softer vocabulary', () => {
    // Every gentler word is one somebody chose because it reads less like an
    // advertisement, which is the reason not to use it.
    expect(SPONSOR_LABEL).toBe('Paid placement');
    for (const softer of ['Sponsored', 'Partner', 'Featured', 'Promoted']) {
      expect(SPONSOR_LABEL).not.toContain(softer);
    }
  });

  it('says it is an advertisement and that it changes nothing', () => {
    expect(SPONSOR_EXPLANATION).toMatch(/advertisement/i);
    expect(SPONSOR_EXPLANATION).toMatch(/not a VibefyCode assessment/i);
    expect(SPONSOR_EXPLANATION).toMatch(/score/i);
  });

  it('adds the disclosure when the advertiser is also somebody we rate', () => {
    const base = {
      id: 'x',
      placement: 'methodology' as const,
      advertiserName: 'A',
      advertiserUrl: 'https://a.example',
      headline: 'h',
      body: 'b',
      sponsorIsMarketingClient: false,
    };
    expect(sponsorDisclosures({ ...base, isCustomer: false })).toHaveLength(1);
    const both = sponsorDisclosures({ ...base, isCustomer: true });
    expect(both).toHaveLength(2);
    expect(both[1]).toMatch(/no path by which a payment can change it/i);
  });

  it('carries a link search engines are not asked to count', () => {
    const slot = read('apps/web/components/sponsor-slot.tsx');
    expect(slot).toContain('nofollow noopener sponsored');
  });
});

describe('advertising beside your own rating', () => {
  it('is withheld on the directory, not moved and not re-labelled', () => {
    expect(isSelfAdjacent('directory', { listedInDirectory: true })).toBe(true);
    expect(isSelfAdjacent('directory', { listedInDirectory: false })).toBe(false);
  });

  it('does not apply where no rating is on the page', () => {
    expect(isSelfAdjacent('methodology', { listedInDirectory: true })).toBe(false);
    expect(isSelfAdjacent('how_it_works', { listedInDirectory: true })).toBe(false);
  });

  it('is decided from a boolean, so no organisation ids are published to work it out', async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'live_sponsorships'`,
    );
    const columns = rows.map((row) => row.column_name);
    expect(columns).toContain('sponsor_is_listed_in_directory');
    expect(columns).not.toContain('organisation_id');
    // Nor what it cost, nor who decided.
    expect(columns).not.toContain('price_cents');
    expect(columns).not.toContain('reviewed_by');
  });
});

describe('one at a time, decided by a person', () => {
  it('refuses a second placement overlapping the same surface', async () => {
    // Scarcity is the product. An oversold surface is a busy app, which is the
    // thing being sold against.
    const first = await propose({ placement: 'how_it_works' });
    await db.query(
      `update public.sponsorships set status = 'live', reviewed_by = $2, reviewed_at = now() where id = $1`,
      [first, admin.userId],
    );
    const second = await propose({
      placement: 'how_it_works',
      starts_on: '2026-09-15',
      ends_on: '2026-10-15',
    });
    await expect(
      db.query(`update public.sponsorships set status = 'live', reviewed_by = $2 where id = $1`, [
        second,
        admin.userId,
      ]),
    ).rejects.toThrow(/One at a time/i);
  });

  it('allows the same surface again once the first has ended', async () => {
    const later = await propose({
      placement: 'how_it_works',
      starts_on: '2026-11-01',
      ends_on: '2026-12-01',
    });
    await expect(
      db.query(`update public.sponsorships set status = 'live', reviewed_by = $2 where id = $1`, [
        later,
        admin.userId,
      ]),
    ).resolves.toBeDefined();
  });

  it('cannot go live without a recorded human review', async () => {
    // The same gate an assessment passes, and for the same reason: this is our
    // own credibility being lent out.
    const id = await propose({ placement: 'directory' });
    await expect(
      db.query(`update public.sponsorships set status = 'live' where id = $1`, [id]),
    ).rejects.toThrow(/recorded human review/i);
  });

  it('cannot be turned down without a written reason', async () => {
    const id = await propose({
      placement: 'directory',
      starts_on: '2027-01-01',
      ends_on: '2027-02-01',
    });
    await expect(
      db.query(`update public.sponsorships set status = 'rejected' where id = $1`, [id]),
    ).rejects.toThrow();
  });

  it('keeps the copy short, because the space is small on purpose', async () => {
    await expect(propose({ headline: 'x'.repeat(200) })).rejects.toThrow();
    await expect(propose({ body: 'short' })).rejects.toThrow();
  });

  it('will not take a placement that is not on https', async () => {
    await expect(propose({ advertiser_url: 'http://kettle.example' })).rejects.toThrow();
  });

  it('will not sell one for longer than a year', async () => {
    await expect(
      propose({ starts_on: '2026-09-01', ends_on: '2028-09-01', placement: 'methodology' }),
    ).rejects.toThrow();
  });
});

describe('what it cannot reach', () => {
  it('has no foreign key to an assessment, a finding or a badge', () => {
    // The same structural separation the price list has, for the same reason.
    const migration = read('supabase/migrations/20260901110000_sponsorships.sql');
    const table = migration.slice(
      migration.indexOf('create table public.sponsorships'),
      migration.indexOf('create index sponsorships_live_idx'),
    );
    for (const forbidden of ['assessments', 'findings', 'badges', 'reviews']) {
      expect(table, forbidden).not.toContain(`public.${forbidden}(`);
    }
  });

  it('cannot be imported by the scoring code', () => {
    const rubric = read('packages/rubric/package.json');
    expect(rubric).not.toContain('sponsorship');
  });

  it('does not appear in the query the directory is ordered by', () => {
    // Labelled, and kept out of the ordering. This is the second half.
    const page = read('apps/web/app/directory/page.tsx');
    const query = page.slice(
      page.indexOf('async function loadEntries'),
      page.indexOf('const SORT_LABEL'),
    );
    expect(query).not.toMatch(/sponsor/i);
  });
});

describe('the sentence the directory has been making since M7', () => {
  const promise = collapse(NO_PAID_PLACEMENT);

  it('is no longer a conditional, now that there is something that could break it', () => {
    // A promise left standing next to the thing it was about is how a reader
    // learns the words were never load-bearing.
    expect(promise).not.toMatch(/if paid placement is ever introduced/i);
  });

  it('still says the list itself is not for sale', () => {
    expect(promise).toMatch(/not for sale/i);
    expect(promise).toMatch(/ordered by the rubric alone/i);
  });

  it('says what is now true instead: labelled, outside the list, withheld if self-adjacent', () => {
    expect(promise).toMatch(/labelled as advertising/i);
    expect(promise).toMatch(/outside the list/i);
    expect(promise).toMatch(/withheld/i);
  });
});

describe('what a buyer is told before the price', () => {
  const page = collapse(read('apps/web/app/advertise/page.tsx'));

  it('states the rules before it states the rate', () => {
    // Somebody who reads them and leaves wanted something we cannot sell, and
    // this page is a better place to find that out than an email six weeks on.
    const rules = page.indexOf('What you cannot buy');
    const price = page.indexOf('what it costs');
    expect(rules).toBeGreaterThan(-1);
    expect(price).toBeGreaterThan(rules);
  });

  it('says out loud that we turn placements down', () => {
    expect(page).toMatch(/We turn things down/i);
  });

  it('lists the surfaces that will never carry one', () => {
    expect(page).toMatch(/will never carry one/i);
    expect(page).toContain('FORBIDDEN_SURFACES');
  });
});
