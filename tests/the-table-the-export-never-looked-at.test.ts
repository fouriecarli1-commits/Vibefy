/**
 * "Every export names the categories that were considered and left out."
 *
 * That is this file's second stated rule, written out at the top of
 * `packages/governance/src/subject-export.ts`, with the reason beside it: "an
 * export that silently omits something looks complete, and the person has no
 * way to know what to ask for next."
 *
 * `NOT_INCLUDED` is six categories, each with a reason, and the export reads
 * six tables: `users`, `memberships`, `consents`, `apps`,
 * `builder_profile_apps` and `data_requests`. Measured against the live schema
 * on 2026-10-07, **twenty-four tables carry a foreign key to `public.users`**.
 * Eighteen were neither read nor covered by anything the person is told about.
 *
 * Three of those eighteen were not judgement calls at all:
 *
 *   · `appeals.submitted_by` — their own grounds, in their own words, and the
 *     written outcome the appeals policy promises *them*. `data_requests` is
 *     exported for exactly that reason and this is the same shape.
 *   · `authorisations.granted_by` — the warranty text version and hash, the
 *     timestamp, the IP and the user agent at the moment they accepted. The
 *     same fields as a consent, exported for the same reason, and the Privacy
 *     Policy lists them as data held about this person for ten years.
 *   · `directory_listings.opted_out_by` — a decision about publication, which
 *     is the category `publicationDecisions` already exists for.
 *
 * The rest are workspace or platform records that name this person as the
 * actor, and a credential. They are now named.
 *
 * The guard is the first test below: every table with a foreign key to `users`
 * must be either read by the export or placed against a category the person is
 * shown. A table added next month is accounted for deliberately or this goes
 * red — which is the only version of this rule that cannot quietly stop being
 * true.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connect } from './setup/client.ts';
import { ACCOUNTED_FOR, EXPORTED_TABLES, NOT_INCLUDED } from '../packages/governance/src/index.ts';

let db: Client;
let referencing: string[];

beforeAll(async () => {
  db = await connect();
  const { rows } = await db.query<{ relname: string }>(
    `select distinct c.relname
       from pg_constraint con
       join pg_class c on c.oid = con.conrelid
       join pg_class f on f.oid = con.confrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and con.contype = 'f' and f.relname = 'users'
      order by c.relname`,
  );
  referencing = rows.map((row) => row.relname);
});

afterAll(async () => {
  await db?.end();
});

describe('every table that holds a reference to this person', () => {
  it('is found, so this file is testing something', () => {
    // Twenty-four when this was written. The number is not the rule; finding
    // some is.
    expect(referencing.length).toBeGreaterThan(15);
    expect(referencing).toContain('consents');
    expect(referencing).toContain('appeals');
  });

  it('is either read by the export or placed against a named category', () => {
    const unaccounted = referencing.filter((table) => ACCOUNTED_FOR[table] === undefined);
    // Anything listed here is a table holding something about this person that
    // the export neither includes nor mentions. Decide which it is and say so
    // in ACCOUNTED_FOR — the point is that it cannot be neither.
    expect(unaccounted).toEqual([]);
  });

  it('is placed against a category the person is actually shown', () => {
    const categories = new Set(NOT_INCLUDED.map((entry) => entry.category));
    for (const [table, placement] of Object.entries(ACCOUNTED_FOR)) {
      if (placement === 'exported') continue;
      expect(categories, `${table} names a category that is not in NOT_INCLUDED`).toContain(
        placement,
      );
    }
  });

  it('accounts for nothing that does not exist', () => {
    // The direction this guard fails in: a map padded with table names until it
    // covers everything, including tables that were renamed away.
    const live = new Set(referencing);
    const stale = Object.keys(ACCOUNTED_FOR).filter((table) => !live.has(table));
    expect(stale).toEqual([]);
  });
});

describe('the three that are exported now and were not', () => {
  it('names appeals as exported, not as withheld', () => {
    expect(ACCOUNTED_FOR.appeals).toBe('exported');
  });

  it('names the authorisation acceptance record as exported', () => {
    // The same fields as a consent, and the consents comment gives the reason:
    // "the IP and user agent are in the row because they are evidence of the
    // acceptance, and they are about this person, so they are theirs to
    // receive."
    expect(ACCOUNTED_FOR.authorisations).toBe('exported');
  });

  it('names a directory opt-out as exported', () => {
    expect(ACCOUNTED_FOR.directory_listings).toBe('exported');
  });

  it('agrees with the tables the export actually reads', () => {
    const claimed = Object.entries(ACCOUNTED_FOR)
      .filter(([, placement]) => placement === 'exported')
      .map(([table]) => table)
      .sort();
    expect(claimed).toEqual([...EXPORTED_TABLES].sort());
  });
});

describe('what has to keep holding', () => {
  it('every named category still carries a reason written for a person', () => {
    for (const entry of NOT_INCLUDED) {
      expect(entry.reason.length).toBeGreaterThan(40);
    }
  });

  it('does not withhold a consent, which is the one the promise turns on', () => {
    expect(ACCOUNTED_FOR.consents).toBe('exported');
  });
});
