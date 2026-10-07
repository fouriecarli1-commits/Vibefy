/**
 * "Removed. Their access ends immediately."
 *
 * That sentence is what `removeMember` returns, and it is returned whenever
 * the delete came back without an error. A delete that matches no rows is not
 * an error — not in SQL, not through PostgREST — so a membership the caller may
 * not touch produces the same silence as one that was removed, and the person
 * is told somebody's access has ended when it has not.
 *
 * The function directly above it gets this right. `changeRole` does
 * `.select('organisation_id').maybeSingle()` and answers "You are not permitted
 * to change that membership" when nothing comes back. The two were written
 * together and only one of them asks.
 *
 * Two other deletes say the same kind of thing: a policy profile is "Deleted.
 * Applications that used it are no longer measured against any profile", and an
 * application is "Removed from your page" — which is a statement about what a
 * stranger can now see, made without checking.
 *
 * The first test here is the premise, measured against the real policies rather
 * than argued from the documentation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';
import { actingAs, connect } from './setup/client.ts';
import { seedAccount, type SeededAccount } from './setup/seed.ts';

let db: Client;
let owner: SeededAccount;
let outsider: SeededAccount;
let membershipId: string;

beforeAll(async () => {
  db = await connect();
  owner = await seedAccount(db, 'delete-nothing-owner');
  outsider = await seedAccount(db, 'delete-nothing-outsider');
  const { rows } = await db.query<{ id: string }>(
    `select id from public.memberships where organisation_id = $1 and user_id = $2`,
    [owner.organisationId, owner.userId],
  );
  membershipId = rows[0]!.id;
});

afterAll(async () => {
  await db.end();
});

describe('a delete the caller is not permitted to make', () => {
  it('removes nothing and raises nothing', async () => {
    // The premise. Row-level security filters the rows the statement can see,
    // so there is nothing to refuse — the statement succeeds, having done
    // nothing, and the only thing that tells them apart is the row count.
    await actingAs(db, { userId: outsider.userId }, async (client) => {
      const result = await client.query(`delete from public.memberships where id = $1`, [
        membershipId,
      ]);
      expect(result.rowCount).toBe(0);
    });
  });

  it('leaves the membership exactly where it was', async () => {
    const { rowCount } = await db.query(`select 1 from public.memberships where id = $1`, [
      membershipId,
    ]);
    expect(rowCount).toBe(1);
  });
});

describe('every action that reports a delete', () => {
  /** The code, without the comments — which quote the defect on purpose. */
  const source = (path: string) =>
    readFileSync(join(process.cwd(), path), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^[ \t]*\/\/.*$/gm, ' ');

  const DELETES = [
    'apps/web/app/console/workspace/actions.ts',
    'apps/web/app/console/profile/actions.ts',
  ];

  for (const path of DELETES) {
    it(`${path} asks what it deleted before saying so`, () => {
      // A `.delete()` whose result is read only for `error` cannot tell a
      // refusal from a removal, and every one of these reports an outcome to
      // somebody.
      const text = source(path);
      for (const [index, statement] of [
        ...text.matchAll(/\.delete\(\)[\s\S]{0,400}?;/g),
      ].entries()) {
        expect(statement[0], `${path} delete #${index + 1}`).toMatch(/\.select\(/);
      }
    });
  }
});
