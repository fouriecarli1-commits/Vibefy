/**
 * "Removed. Their access ends immediately."
 *
 * That sentence is what `removeMember` returns, and it was returned whenever
 * the delete came back without an error. A write that matches no rows is not an
 * error — not in SQL, not through PostgREST — because row-level security
 * filters the rows a statement can see rather than refusing the statement. So a
 * membership the caller may not touch produced the same silence as one that was
 * removed, and the person was told somebody's access had ended when it had not.
 *
 * The function directly above it gets this right. `changeRole` does
 * `.select('organisation_id').maybeSingle()` and answers "You are not permitted
 * to change that membership" when nothing comes back. The two were written
 * together and only one of them asked.
 *
 * It is not one function. Fourteen writes across seven action files reported an
 * outcome without checking there was one, and three of them are the badge
 * actions: "Revoked. Because we serve the image, every embedded instance stops
 * reading as verified within minutes" is the most consequential sentence this
 * product can say to a reviewer, and it was said about a badge that may not
 * have been touched — leaving a live mark on somebody's website and a reviewer
 * who believes it is gone.
 *
 * The first two tests are the premise, measured against the real policies
 * rather than argued from the documentation. The rest hold the rule over every
 * write in those files, so the fifteenth is caught rather than found.
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

describe('every action that reports a write', () => {
  /** The code, without the comments — which quote the defect on purpose. */
  const source = (path: string) =>
    readFileSync(join(process.cwd(), path), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^[ \t]*\/\/.*$/gm, ' ');

  /*
   * Every action file that writes through PostgREST and then reports what it
   * did. Named rather than globbed: a file belongs here because somebody
   * decided its writes report an outcome, and a glob would quietly start
   * covering a file nobody looked at.
   */
  const REPORTERS = [
    'apps/web/app/admin/accounts/actions.ts',
    'apps/web/app/console/alerts/actions.ts',
    'apps/web/app/console/privacy/actions.ts',
    'apps/web/app/admin/sponsorships/actions.ts',
    'apps/web/app/console/apps/[id]/trust/actions.ts',
    'apps/web/app/console/profile/actions.ts',
    'apps/web/app/console/workspace/actions.ts',
    'apps/web/app/review/actions.ts',
    'apps/web/app/review/badge-actions.ts',
  ];

  /** `.update(` and `.delete()` on a Supabase builder, not on a hash. */
  const writes = (text: string) => [
    ...text.matchAll(/\.from\('[^']+'\)\s*\.(?:update\(|delete\(\))[\s\S]{0,500}?;/g),
  ];

  for (const path of REPORTERS) {
    it(`${path} asks what it changed before saying so`, () => {
      // A write whose result is read only for `error` cannot tell a refusal
      // from a change: row-level security filters the rows the statement can
      // see rather than refusing it, so nothing happened and nothing was said.
      /*
       * A write may say for itself that changing nothing is the right answer.
       *
       * `markAllAlertsRead` is the case: nothing unread is exactly what "All
       * caught up." describes, and forcing it to check would be inventing a
       * refusal out of success. The marker goes on the line above the write,
       * in the same shape as this repo's other two opt-outs, and it has to
       * carry a reason — a bare switch is one somebody adds to make a test go
       * quiet.
       */
      const withComments = readFileSync(join(process.cwd(), path), 'utf8');
      const lines = withComments.split('\n');
      /*
       * The marker has to be in the comment block directly above the write it
       * exempts.
       *
       * A first version looked back four hundred characters, which let the
       * marker on `markAlertRead` exempt `markAllAlertsRead` fifteen lines
       * later — one opt-out quietly covering a write nobody wrote it for,
       * which is the class of defect this whole file is about, committed in
       * the test. Caught by mutating the marker and watching nothing fail.
       *
       * A second counted three lines, which is a different arbitrary number
       * and missed a three-line comment. The walk goes up to the blank line
       * instead, which is where one of these statements and its explanation
       * actually begin.
       */
      const exempt = (statement: string) => {
        const before = withComments.slice(0, withComments.indexOf(statement));
        let line = before.split('\n').length - 1;
        /*
         * Upwards to the blank line above the statement, collecting whatever is
         * there. A blank line or a finished statement ends the walk, so a
         * marker cannot reach past the write it was written for — and the walk
         * starts inside the chain, because the match begins at `.from(` rather
         * than at the `const`.
         */
        const block: string[] = [];
        while (line > 0) {
          const text = lines[line - 1] ?? '';
          if (text.trim() === '' || /[;}]\s*$/.test(text)) break;
          block.push(text);
          line -= 1;
        }
        return block.some((text) => /\/\/\s*no-op-is-fine:\s*\S+/.test(text));
      };

      const found = writes(source(path));
      expect(found.length, `${path} has no writes to check`).toBeGreaterThan(0);
      for (const [index, statement] of found.entries()) {
        if (exempt(statement[0])) continue;
        expect(statement[0], `${path} write #${index + 1}`).toMatch(/\.select\(/);
      }
    });
  }
});
