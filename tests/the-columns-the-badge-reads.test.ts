/**
 * The columns the badge reads, against the view that publishes them.
 *
 * `lookUpBadgeVerification` names seventeen columns in one list and uses it
 * twice — in the direct `select` and in the Supabase API fallback's
 * `.select()`. Nothing compared that list to the view.
 *
 * Both directions matter, and the first one is severe:
 *
 *   · A name in the list that the view does not have makes the direct query
 *     fail with `column does not exist`. That sends every badge down the
 *     fallback — which selects the same list, so it fails too, and every badge
 *     on every customer's site goes grey at once. Migration
 *     `20260923100000_owner_name_is_not_public` removed `owner_name` from this
 *     view; had the list not been edited with it, that is what would have
 *     happened, and nothing in the suite would have said so first.
 *   · A column the view has that the list omits is something published to
 *     `anon` that nothing reads — either a leak or dead weight. A public view
 *     is the one place where an unused column is not free.
 *
 * `tests/the-route-that-is-still-up.test.ts` asserts the identifier appears
 * three times in the source, which is the right question about the wiring and
 * says nothing about whether the names are real.
 */
import { describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connect } from './setup/client.ts';
import { BADGE_VERIFICATION_COLUMNS } from '../apps/web/lib/badge-verification.ts';
import { afterAll, beforeAll } from 'vitest';

let db: Client;

beforeAll(async () => {
  db = await connect();
});

afterAll(async () => {
  await db?.end();
});

/** A column the view publishes that the badge deliberately does not read. */
const NOT_READ: Readonly<Record<string, string>> = {};

describe('the list and the view', () => {
  it('names a plausible number of columns, or the comparisons below are empty', () => {
    expect(BADGE_VERIFICATION_COLUMNS.length).toBeGreaterThan(10);
    expect(BADGE_VERIFICATION_COLUMNS).toContain('public_id');
    expect(BADGE_VERIFICATION_COLUMNS).toContain('signature');
  });

  it('asks about a view that exists, which is what makes an empty answer mean something', async () => {
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from information_schema.columns
        where table_schema = 'public' and table_name = 'badge_verification'`,
    );
    expect(Number(rows[0]!.n), 'public.badge_verification has no columns').toBeGreaterThan(10);
  });

  it('names no column the view does not have', async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'badge_verification'`,
    );
    const published = new Set(rows.map((row) => row.column_name));
    const missing = BADGE_VERIFICATION_COLUMNS.filter((name) => !published.has(name));
    expect(
      missing,
      `The badge selects columns public.badge_verification does not publish:\n  ${missing.join('\n  ')}\n` +
        'The direct read fails with "column does not exist", the fallback selects the same list and ' +
        'fails too, and every badge on every site goes grey at once.',
    ).toEqual([]);
  });

  it('reads every column the view publishes, or says which it leaves', async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'badge_verification'`,
    );
    const read = new Set<string>(BADGE_VERIFICATION_COLUMNS);
    const unread = rows
      .map((row) => row.column_name)
      .filter((name) => !read.has(name) && !(name in NOT_READ));
    expect(
      unread,
      `public.badge_verification publishes columns the badge does not read:\n  ${unread.join('\n  ')}\n` +
        'A public view is readable by anon, so an unused column there is either a leak or dead ' +
        'weight. Read it, drop it from the view, or name it in NOT_READ with which.',
    ).toEqual([]);
  });

  it('does not excuse a column without a reason, or one that is read after all', () => {
    for (const [name, reason] of Object.entries(NOT_READ)) {
      expect(reason.length, name).toBeGreaterThan(40);
      expect(BADGE_VERIFICATION_COLUMNS, `${name} is excused and also read`).not.toContain(name);
    }
  });
});
