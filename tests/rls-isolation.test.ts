/**
 * Definition of Done item 4: a test proves user A cannot read user B's app,
 * assessment, report or badge. Multi-tenant isolation is the difference between
 * a product and a breach, so it is asserted against a real database with the
 * real policies, for every table that carries customer data.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
    ['evidence', () => aliceAssets.assessmentId],
    ['finding_evidence', () => aliceAssets.findingId],
    ['reports', () => aliceAssets.reportId],
    ['badges', () => aliceAssets.badgeId],
    ['badge_events', () => aliceAssets.badgeId],
  ])('returns nothing from %s', async (table, id) => {
    await actingAs(db, { userId: mallory.userId }, async (client) => {
      const { rows } = await client.query(`select * from public.${table}`);
      expect(rows).toHaveLength(0);
      const column =
        table === 'badge_events'
          ? 'badge_id'
          : table === 'evidence' || table === 'assessment_runs'
            ? 'assessment_id'
            : table === 'finding_evidence'
              ? 'finding_id'
              : 'id';
      const direct = await client.query(`select * from public.${table} where ${column} = $1`, [
        id(),
      ]);
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

describe('a table with policies and no grants is a table nobody can reach', () => {
  /*
   * Three tables shipped with row-level security, careful policies, and no
   * grants at all. No policy was ever consulted: Postgres refuses at the
   * privilege check first, and every page that read or wrote them would have
   * answered "permission denied for table" the first time somebody opened it.
   *
   * It survived the whole suite because these fixtures connect as the database
   * owner, who is subject to neither check. A missing grant is invisible to a
   * test that never asks as the customer — so this one asks the catalogue
   * instead, about every table at once, and will fail on the next one.
   */
  it('gives the authenticated role something to do on every table it secures', async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `select c.relname as table_name
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
          and c.relrowsecurity
          and not exists (
            select 1
              from information_schema.role_table_grants g
             where g.table_schema = 'public'
               and g.table_name = c.relname
               and g.grantee in ('authenticated', 'anon')
          )
        order by c.relname`,
    );
    const unreachable = rows.map((row) => row.table_name);
    expect(
      unreachable,
      `Tables with row-level security that no customer role may touch:\n  ${unreachable.join('\n  ')}\n` +
        'Add a grant, or say in the migration why the table is service-role only.',
    ).toEqual([]);
  });

  it('names the role every policy applies to, rather than leaving it to everybody', async () => {
    /*
     * A policy written without `to <role>` gets the catch-all `public`, which
     * includes `anon` and every role that will ever exist. Two policies on the
     * remediation tables were written that way and nothing leaked, because
     * neither table is granted to `anon` and both conditions reduce to false
     * without a session.
     *
     * The way that becomes real is ordinary and would pass review: somebody
     * adds a public view over one of those tables, grants select on the table
     * underneath to make it work, and a policy always written for signed-in
     * people starts being consulted for everybody. The grant gets looked at.
     * The policy does not, because nobody changed it.
     *
     * `anon` may be named deliberately — the published rubric is — so what this
     * refuses is the unnamed default, not a considered decision.
     */
    const { rows } = await db.query<{ tablename: string; policyname: string }>(
      `select tablename, policyname from pg_policies
        where schemaname = 'public' and 'public' = any(roles)
        order by tablename, policyname`,
    );
    const unnamed = rows.map((row) => `${row.tablename}.${row.policyname}`);
    expect(
      unnamed,
      `Policies that apply to every role, including anon:\n  ${unnamed.join('\n  ')}\n` +
        'Add `to authenticated` — or `to anon, authenticated` if it is meant to be public.',
    ).toEqual([]);
  });

  it('gives every policy on those tables something to filter', async () => {
    // The other direction, and the quieter failure: a grant with no policy on a
    // forced-RLS table means every row is hidden and nothing says why.
    const { rows } = await db.query<{ table_name: string }>(
      `select c.relname as table_name
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
          and c.relrowsecurity
          and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
        order by c.relname`,
    );
    const silent = rows.map((row) => row.table_name);
    expect(
      silent,
      `Tables with row-level security and no policy at all: ${silent.join(', ')}`,
    ).toEqual([]);
  });
});

describe('the invariants this schema rests on, asked of the catalogue', () => {
  /*
   * Three properties that are true today, that nothing enforces, and whose
   * failure would be silent. The grant bug was found by asking the catalogue a
   * question rather than by reading a migration, and these are the other
   * questions worth asking about a schema shaped like this one.
   */

  it('pins the search path on every function that runs as its definer', async () => {
    /*
     * A `security definer` function without a pinned `search_path` is the
     * textbook Postgres privilege escalation: the caller controls which schema
     * a bare name resolves to, so they choose the code the function runs. Ours
     * all pin it. Nothing made them, until now.
     */
    const { rows } = await db.query<{ proname: string }>(
      `select p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prosecdef
          and not coalesce(p.proconfig, '{}') @> array['search_path=public, pg_temp']
        order by p.proname`,
    );
    const unpinned = rows.map((row) => row.proname);
    expect(
      unpinned,
      `Definer functions with no pinned search path:\n  ${unpinned.join('\n  ')}\n` +
        'Add `set search_path = public, pg_temp`. Without it the caller chooses which schema a bare name resolves to, which means the caller chooses the code.',
    ).toEqual([]);
  });

  it('turns row-level security on for every table in public', async () => {
    // A table without it is readable by anybody the grant reaches, which for
    // `authenticated` is every customer at once.
    const { rows } = await db.query<{ relname: string }>(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
        order by c.relname`,
    );
    const open = rows.map((row) => row.relname);
    expect(open, `Tables with no row-level security: ${open.join(', ')}`).toEqual([]);
  });

  it('knows every view a stranger can read, and why it bypasses those policies', async () => {
    /*
     * A view declared `security_invoker = false` runs with its owner's rights,
     * so the policies on the tables underneath it do not apply. That is correct
     * for the handful of things we publish deliberately, and it is a data leak
     * for anything else — and the difference is a single option nobody would
     * notice in review.
     *
     * So each one is named here with the reason it is public. A new view
     * readable by `anon` fails this test until somebody writes that reason
     * down, which is the only moment anybody will think about it.
     */
    const PUBLISHED: Readonly<Record<string, string>> = {
      badge_verification:
        'The verification page. A badge nobody can check is not a badge, so this is public by design.',
      directory:
        'The public directory, which shows only applications whose owner chose to be listed.',
      listed_badges:
        'The list published in bulk, which honours the same choice the directory does.',
      builder_profile_public:
        'A builder page, published only when its owner publishes it, holding only applications they consented to one at a time.',
      trust_page_public:
        'The owner’s own words on their verification page, published only when they publish them.',
      live_sponsorships:
        'The paid placements currently running. An advertisement nobody can see is not one, and it is labelled as paid wherever it appears.',
    };

    const { rows } = await db.query<{ relname: string }>(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'v'
          and has_table_privilege('anon', c.oid, 'select')
          and coalesce(
                (select option_value from pg_options_to_table(c.reloptions)
                  where option_name = 'security_invoker'),
                'false'
              ) = 'false'
        order by c.relname`,
    );

    const found = rows.map((row) => row.relname);
    const undeclared = found.filter((name) => !(name in PUBLISHED));
    expect(
      undeclared,
      `Views a stranger can read that bypass row-level security, with no reason recorded:\n  ${undeclared.join('\n  ')}\n` +
        'Add it to PUBLISHED with why it is public, or make it security_invoker.',
    ).toEqual([]);

    // And the other direction: a name left here after its view was deleted is
    // a reason nobody is holding anybody to.
    const gone = Object.keys(PUBLISHED).filter((name) => !found.includes(name));
    expect(gone, `Declared public views that no longer exist: ${gone.join(', ')}`).toEqual([]);
  });

  it('does not excuse a public view without a reason', () => {
    // A bare name on that list would defeat the point of the list.
    const source = readFileSync(join(process.cwd(), 'tests/rls-isolation.test.ts'), 'utf8');
    const block = /const PUBLISHED: Readonly<Record<string, string>> = \{([\s\S]*?)\n    \};/.exec(
      source,
    );
    expect(block).not.toBeNull();
    for (const reason of [...block![1]!.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]!)) {
      if (reason.endsWith('_public') || !reason.includes(' ')) continue;
      expect(reason.length).toBeGreaterThan(40);
    }
  });
});
