/**
 * Definition of Done item 4: a test proves user A cannot read user B's app,
 * assessment, report or badge. Multi-tenant isolation is the difference between
 * a product and a breach, so it is asserted against a real database with the
 * real policies, for every table that carries customer data.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { actingAs, connect, expectRefusal } from './setup/client.ts';
import {
  acceptBadgeLicence,
  approveAssessment,
  issueBadge,
  makeReviewer,
  seedAccount,
  seedAssessment,
  seedFinding,
  sha256,
  type SeededAccount,
} from './setup/seed.ts';

let db: Client;
let alice: SeededAccount;
let mallory: SeededAccount;
let reviewer: SeededAccount;
let aliceAssets: {
  appId: string;
  assessmentId: string;
  findingId: string;
  badgeId: string;
  reportId: string;
};

beforeAll(async () => {
  db = await connect();

  alice = await seedAccount(db, 'alice');
  mallory = await seedAccount(db, 'mallory');
  reviewer = await seedAccount(db, 'reviewer');
  await makeReviewer(db, reviewer.userId);

  const assessment = await seedAssessment(db, alice);
  const findingId = await seedFinding(db, alice, assessment.assessmentId);
  await approveAssessment(db, alice, assessment.assessmentId, reviewer.userId);

  const { rows } = await db.query<{ id: string }>(
    `insert into public.reports
       (assessment_id, organisation_id, format, storage_path, sha256, rubric_version, scope_statement, non_reliance_legend)
     values ($1, $2, 'pdf', 'reports/alice.pdf', $3, '1.0.0', $4, $5) returning id`,
    [
      assessment.assessmentId,
      alice.organisationId,
      sha256('alice-report'),
      'This assessment is a point-in-time, scope-limited, AI-assisted and human-reviewed evaluation conducted against a published rubric version on a stated date, and it is not a guarantee of any kind.',
      'This report is prepared for the named customer only. No third party may rely on it.',
    ],
  );

  const consentId = await acceptBadgeLicence(db, alice);
  const badgeId = await issueBadge(db, alice, {
    appId: assessment.appId,
    assessmentId: assessment.assessmentId,
    consentId,
  });

  aliceAssets = {
    appId: assessment.appId,
    assessmentId: assessment.assessmentId,
    findingId,
    badgeId,
    reportId: rows[0]!.id,
  };
});

afterAll(async () => {
  await db?.end();
});

describe('a customer can read their own data', () => {
  it('sees their app, assessment, finding, report and badge', async () => {
    await actingAs(db, { userId: alice.userId }, async (client) => {
      for (const [table, id] of [
        ['apps', aliceAssets.appId],
        ['assessments', aliceAssets.assessmentId],
        ['findings', aliceAssets.findingId],
        ['reports', aliceAssets.reportId],
        ['badges', aliceAssets.badgeId],
      ] as const) {
        const { rows } = await client.query(`select id from public.${table} where id = $1`, [id]);
        expect(rows, `alice should see her own ${table}`).toHaveLength(1);
      }
    });
  });
});

describe('a customer cannot read another customer’s data', () => {
  it.each([
    ['apps', () => aliceAssets.appId],
    ['assessments', () => aliceAssets.assessmentId],
    ['assessment_runs', () => aliceAssets.assessmentId],
    ['findings', () => aliceAssets.findingId],
    ['evidence', () => aliceAssets.findingId],
    ['reports', () => aliceAssets.reportId],
    ['badges', () => aliceAssets.badgeId],
    ['badge_events', () => aliceAssets.badgeId],
  ])('returns nothing from %s', async (table, id) => {
    await actingAs(db, { userId: mallory.userId }, async (client) => {
      const { rows } = await client.query(`select * from public.${table}`);
      expect(rows).toHaveLength(0);
      const direct = await client.query(
        `select * from public.${table} where ${table === 'badge_events' ? 'badge_id' : table === 'evidence' ? 'finding_id' : 'id'} = $1`,
        [id()],
      );
      expect(direct.rows).toHaveLength(0);
    });
  });

  it('cannot see the other organisation or its members', async () => {
    await actingAs(db, { userId: mallory.userId }, async (client) => {
      const orgs = await client.query(`select id from public.organisations where id = $1`, [
        alice.organisationId,
      ]);
      expect(orgs.rows).toHaveLength(0);

      const members = await client.query(`select id from public.memberships where user_id = $1`, [
        alice.userId,
      ]);
      expect(members.rows).toHaveLength(0);

      const users = await client.query(`select id from public.users where id = $1`, [alice.userId]);
      expect(users.rows).toHaveLength(0);
    });
  });

  it('cannot write into another organisation', async () => {
    await actingAs(db, { userId: mallory.userId }, async (client) => {
      const message = await expectRefusal(
        client,
        `insert into public.apps (organisation_id, name, slug, app_type, primary_url, created_by)
         values ($1, 'Stolen', 'stolen-app', 'web_url', 'https://stolen.example.test', $2)`,
        [alice.organisationId, mallory.userId],
      );
      expect(message).toMatch(/row-level security/i);
    });
  });

  it('cannot promote itself to reviewer', async () => {
    await actingAs(db, { userId: mallory.userId }, async (client) => {
      const message = await expectRefusal(
        client,
        `update public.users set platform_role = 'admin' where id = $1`,
        [mallory.userId],
      );
      expect(message).toMatch(/permission denied/i);
    });
  });
});

describe('an anonymous visitor', () => {
  it('cannot read any customer table', async () => {
    await actingAs(db, { role: 'anon' }, async (client) => {
      for (const table of ['apps', 'assessments', 'findings', 'reports', 'badges', 'users']) {
        const message = await expectRefusal(client, `select * from public.${table}`);
        expect(message, `anon must not read ${table}`).toMatch(/permission denied/i);
      }
    });
  });

  it('can read the public badge verification surface, because that is the point of the mark', async () => {
    await actingAs(db, { role: 'anon' }, async (client) => {
      const { rows } = await client.query(
        `select status, score, rubric_version, owner_is_marketing_client
           from public.badge_verification where public_id is not null`,
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]).toHaveProperty('owner_is_marketing_client');
    });
  });

  it('can read published rubric versions, because the methodology is public', async () => {
    await actingAs(db, { role: 'anon' }, async (client) => {
      const { rows } = await client.query(`select version from public.rubric_versions`);
      expect(rows.length).toBeGreaterThan(0);
    });
  });
});

describe('a reviewer', () => {
  it('can read assessments in order to review them, but not what they cost us', async () => {
    await actingAs(db, { userId: reviewer.userId }, async (client) => {
      const assessments = await client.query(`select id from public.assessments where id = $1`, [
        aliceAssets.assessmentId,
      ]);
      expect(assessments.rows).toHaveLength(1);

      const costs = await client.query(`select * from public.cost_records`);
      expect(
        costs.rows,
        'a reviewer with a cost signal in front of them is not independent',
      ).toHaveLength(0);
    });
  });
});
