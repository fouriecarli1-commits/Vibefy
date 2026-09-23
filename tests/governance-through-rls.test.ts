/**
 * Filing a data-subject request and an appeal, as the person entitled to.
 *
 * `governance.test.ts` covers both thoroughly — the statutory deadline the
 * database sets, the refusal that needs a written basis, the immutability. All
 * of it on the owning connection, which bypasses row-level security. That is
 * the right shape for testing a trigger, and it means none of it can tell us
 * whether a customer arriving through PostgREST can file anything at all.
 *
 * The same gap as the review queue, and it matters more here. A data-subject
 * request is not a feature: it is the route by which somebody exercises a right
 * they hold whether or not we built a form. If row-level security refuses it,
 * the console shows an error nobody can act on and the request is never
 * recorded — so the thirty-day clock the schema is careful to start never
 * starts, and the first anybody hears of it is a complaint to a regulator.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { actingAs, connect } from './setup/client.ts';
import { seedAccount, seedAssessment, type SeededAccount } from './setup/seed.ts';

let db: Client;
let owner: SeededAccount;
let stranger: SeededAccount;
let assessmentId: string;
let decidableAssessmentId: string;

beforeAll(async () => {
  db = await connect();
  owner = await seedAccount(db, 'gov-rls-owner');
  stranger = await seedAccount(db, 'gov-rls-stranger');
  assessmentId = (await seedAssessment(db, owner)).assessmentId;

  // Persisted on the owning connection, because the update test below needs a
  // row that outlives a rolled-back `actingAs`. Without it that test passes
  // because there is nothing to update, which is the vacuous pass this file
  // warns about two paragraphs later — I wrote it and then caught it.
  const persisted = await seedAssessment(db, owner);
  decidableAssessmentId = persisted.assessmentId;
  await db.query(
    `insert into public.appeals (assessment_id, organisation_id, submitted_by, grounds)
     values ($1, $2, $3, $4)`,
    [
      decidableAssessmentId,
      owner.organisationId,
      owner.userId,
      'The finding describes a route that requires authentication we provide.',
    ],
  );
});

afterAll(async () => {
  await db?.end();
});

describe('a data-subject request, filed by the data subject', () => {
  it.each(['access', 'correction', 'deletion', 'portability', 'objection'])(
    'can be filed and read back: %s',
    async (kind) => {
      /*
       * Filed and read back inside one transaction on purpose. Two `actingAs`
       * calls would roll the first one back and the read would find nothing —
       * which looks exactly like a policy refusing it. I made that mistake
       * while probing this, and a test that can make it is a test that will
       * eventually report it as a defect.
       */
      const seen = await actingAs(db, { userId: owner.userId, aal: 'aal2' }, async (client) => {
        await client.query(
          `insert into public.data_requests (user_id, organisation_id, request_type)
           values ($1, $2, $3::public.data_request_type)`,
          [owner.userId, owner.organisationId, kind],
        );
        const { rows } = await client.query<{ status: string; due_at: string }>(
          `select status::text, due_at from public.data_requests
            where user_id = $1 and request_type = $2::public.data_request_type`,
          [owner.userId, kind],
        );
        return rows[0] ?? null;
      });
      expect(seen).not.toBeNull();
      expect(seen!.status).toBe('received');
      // The clock the schema starts is the whole point of the row existing.
      expect(new Date(seen!.due_at).getTime()).toBeGreaterThan(Date.now());
    },
  );

  it('cannot be filed in somebody else’s name', async () => {
    // `data_requests_insert_own` asks `user_id = auth.uid()`. A request filed
    // for a stranger would start a clock they never asked for, against records
    // that are theirs.
    const outcome = await actingAs(db, { userId: owner.userId, aal: 'aal2' }, async (client) => {
      try {
        await client.query(
          `insert into public.data_requests (user_id, organisation_id, request_type)
           values ($1, $2, 'deletion')`,
          [stranger.userId, stranger.organisationId],
        );
        return 'allowed';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    expect(outcome).toMatch(/row-level security/i);
  });

  it('is invisible to anybody but the person who filed it', async () => {
    const visible = await actingAs(db, { userId: stranger.userId, aal: 'aal2' }, async (client) => {
      const { rows } = await client.query(
        `select id from public.data_requests where user_id = $1`,
        [owner.userId],
      );
      return rows.length;
    });
    expect(visible).toBe(0);
  });
});

describe('an appeal, filed by the customer whose finding it is', () => {
  it('can be filed and read back', async () => {
    const appeal = await actingAs(db, { userId: owner.userId, aal: 'aal2' }, async (client) => {
      await client.query(
        `insert into public.appeals (assessment_id, organisation_id, submitted_by, grounds)
         values ($1, $2, $3, $4)`,
        [
          assessmentId,
          owner.organisationId,
          owner.userId,
          'The finding describes a route that requires authentication we provide.',
        ],
      );
      const { rows } = await client.query<{ status: string }>(
        `select status::text from public.appeals where assessment_id = $1`,
        [assessmentId],
      );
      return rows[0] ?? null;
    });
    expect(appeal).not.toBeNull();
  });

  it('cannot be filed in a colleague’s name', async () => {
    // `appeals_insert_members` asks `submitted_by = auth.uid()` as well as
    // membership. An appeal is a statement somebody made about their own
    // assessment, and a statement anybody can sign is not one.
    const outcome = await actingAs(db, { userId: owner.userId, aal: 'aal2' }, async (client) => {
      try {
        await client.query(
          `insert into public.appeals (assessment_id, organisation_id, submitted_by, grounds)
           values ($1, $2, $3, $4)`,
          [assessmentId, owner.organisationId, stranger.userId, 'y'.repeat(60)],
        );
        return 'allowed';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    expect(outcome).toMatch(/row-level security/i);
  });

  it('cannot be filed against somebody else’s assessment', async () => {
    const outcome = await actingAs(db, { userId: stranger.userId, aal: 'aal2' }, async (client) => {
      try {
        await client.query(
          `insert into public.appeals (assessment_id, organisation_id, submitted_by, grounds)
           values ($1, $2, $3, $4)`,
          [assessmentId, owner.organisationId, stranger.userId, 'z'.repeat(60)],
        );
        return 'allowed';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    expect(outcome).toMatch(/row-level security/i);
  });

  it('cannot be decided by the customer who filed it', async () => {
    // `appeals_update_reviewers` is the only update policy. A customer who
    // could mark their own appeal upheld would be scoring their own assessment
    // by another route.
    //
    // Against a row that really exists: the appeal is seeded on the owning
    // connection above, and this asserts first that the customer can see it.
    // An update matching nothing because there is nothing there would pass
    // this test while proving the opposite of what it claims.
    const before = await actingAs(db, { userId: owner.userId, aal: 'aal2' }, async (client) => {
      const { rows } = await client.query<{ status: string }>(
        `select status::text from public.appeals where assessment_id = $1`,
        [decidableAssessmentId],
      );
      return rows[0]?.status ?? null;
    });
    // `open`, which is the appeals table's own default — the data-request
    // table's is `received`, and assuming they matched is the kind of thing a
    // test acting on a real row corrects immediately.
    expect(before).toBe('open');

    const changed = await actingAs(db, { userId: owner.userId, aal: 'aal2' }, async (client) => {
      const { rowCount } = await client.query(
        `update public.appeals set status = 'upheld' where assessment_id = $1`,
        [decidableAssessmentId],
      );
      return rowCount;
    });
    expect(changed).toBe(0);

    const after = await db.query<{ status: string }>(
      `select status::text from public.appeals where assessment_id = $1`,
      [decidableAssessmentId],
    );
    expect(after.rows[0]!.status).toBe('open');
  });
});

describe('a consent record, written by the person who consented', () => {
  /*
   * Found by an accident worth admitting: while watching the data-request
   * guard fail I weakened the wrong policy by one occurrence of an identical
   * line, and nothing broke. That told me more than the intended experiment
   * did — `consents_insert_own` had no test at all.
   *
   * It is the policy that stops one person recording an acceptance in another
   * person's name, on the table this product treats as evidence rather than as
   * a checkbox. A record anybody can write for anybody is not evidence of
   * anything. `personal-data.test.ts` covers the table's immutability and its
   * versioning thoroughly, all of it on the owning connection.
   */
  it('can be written for yourself', async () => {
    const written = await actingAs(db, { userId: owner.userId, aal: 'aal2' }, async (client) => {
      await client.query(
        `insert into public.consents
           (user_id, organisation_id, document_type, document_version, document_sha256)
         values ($1, $2, 'terms_of_service', '9.9.9', $3)`,
        [owner.userId, owner.organisationId, 'a'.repeat(64)],
      );
      const { rows } = await client.query(
        `select id from public.consents where user_id = $1 and document_version = '9.9.9'`,
        [owner.userId],
      );
      return rows.length;
    });
    expect(written).toBe(1);
  });

  it('cannot be written in somebody else’s name', async () => {
    // The OAuth sign-up path writes a consent as the signed-in user from the
    // callback. If this policy were wrong, that route would let anybody record
    // anybody's acceptance of our Terms.
    const outcome = await actingAs(db, { userId: owner.userId, aal: 'aal2' }, async (client) => {
      try {
        await client.query(
          `insert into public.consents
             (user_id, organisation_id, document_type, document_version, document_sha256)
           values ($1, $2, 'terms_of_service', '9.9.9', $3)`,
          [stranger.userId, stranger.organisationId, 'b'.repeat(64)],
        );
        return 'allowed';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    expect(outcome).toMatch(/row-level security/i);
  });

  it('is invisible to anybody else', async () => {
    const visible = await actingAs(db, { userId: stranger.userId, aal: 'aal2' }, async (client) => {
      const { rows } = await client.query(`select id from public.consents where user_id = $1`, [
        owner.userId,
      ]);
      return rows.length;
    });
    expect(visible).toBe(0);
  });
});
