/**
 * One customer reading another customer's rows — the tables nothing checked.
 *
 * `rls-isolation.test.ts` covers eleven tables and is the reason this product
 * can claim separation at all. A mutation run — every read policy in the schema
 * opened to `using (true)` at once, then the whole suite — showed which of the
 * forty-four read-scoping policies anything actually notices. Twenty-eight are
 * covered somewhere. These sixteen were not, and among them:
 *
 *   · `authorisations` holds the warranty text a customer accepted, the hash of
 *     the exact words, and the scope they granted. It is the record that makes
 *     our testing lawful, and reading somebody else's tells you which domains
 *     they own and what they agreed to.
 *   · `audit_log` is every action taken in a workspace, with who took it.
 *   · `invoices` and `billing_events` are what somebody paid and when.
 *   · `reviews` is a reviewer's written reasoning about an application, which
 *     is not the customer's to read about anybody else.
 *   · `drift_reports` names what got worse on a competitor's application.
 *   · `device_tokens` addresses a phone.
 *   · `sso_connections` carries a domain challenge.
 *
 * Table-driven on purpose. Sixteen near-identical assertions written out long
 * would drift, and the one that drifted would be the one nobody re-read. Each
 * row seeds a record owned by one workspace on the owning connection — so it
 * outlives the transaction the reader runs in — asserts the owner can see it,
 * and then asserts a signed-in member of another workspace sees nothing.
 *
 * The owner's read is not decoration. Without it a seed that quietly failed, or
 * a `where` clause that matches nothing, passes the isolation assertion while
 * proving nothing at all — which is exactly what two of my own tests were doing
 * until this run found them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { actingAs, connect } from './setup/client.ts';
import {
  makeReviewer,
  seedAccount,
  seedApp,
  seedAssessment,
  type SeededAccount,
} from './setup/seed.ts';

let db: Client;
let owner: SeededAccount;
let stranger: SeededAccount;
let reviewer: SeededAccount;
let appId: string;
let assessmentId: string;

/** A table, a row belonging to `owner`, and the query that would find it. */
interface Case {
  readonly table: string;
  readonly seed: () => Promise<void>;
  readonly find: string;
  readonly params: () => unknown[];
}

beforeAll(async () => {
  db = await connect();
  owner = await seedAccount(db, 'sweep-owner');
  stranger = await seedAccount(db, 'sweep-stranger');
  reviewer = await seedAccount(db, 'sweep-reviewer');
  await makeReviewer(db, reviewer.userId);
  appId = await seedApp(db, owner);
  assessmentId = (await seedAssessment(db, owner, { appId })).assessmentId;
});

afterAll(async () => {
  await db?.end();
});

const q = (sql: string, params: unknown[] = []) => db.query(sql, params);

const cases: Case[] = [
  {
    table: 'alerts',
    seed: () =>
      q(
        `insert into public.alerts (organisation_id, app_id, kind, title, body, dedupe_key)
         values ($1, $2, 'badge_expiring', 'Your badge expires soon',
          'Your badge expires in fourteen days. Renew the subscription to keep it live.', $3)`,
        [owner.organisationId, appId, `sweep-${randomUUID()}`],
      ).then(() => undefined),
    find: `select id from public.alerts where organisation_id = $1`,
    params: () => [owner.organisationId],
  },
  {
    table: 'audit_log',
    seed: () =>
      q(
        `insert into public.audit_log (organisation_id, actor_id, action, entity_type)
         values ($1, $2, 'sweep.probe', 'app')`,
        [owner.organisationId, owner.userId],
      ).then(() => undefined),
    find: `select id from public.audit_log where organisation_id = $1`,
    params: () => [owner.organisationId],
  },
  {
    table: 'authorisations',
    seed: () =>
      q(
        `insert into public.authorisations
           (app_id, organisation_id, method, warranty_text_version, warranty_text_sha256, granted_by, scope_domains)
         values ($1, $2, 'dns_txt', '1.0.0', $3, $4, array['sweep.example'])`,
        [appId, owner.organisationId, 'd'.repeat(64), owner.userId],
      ).then(() => undefined),
    find: `select id from public.authorisations where organisation_id = $1`,
    params: () => [owner.organisationId],
  },
  {
    table: 'invoices',
    seed: () =>
      q(
        `insert into public.invoices (organisation_id, amount_due_cents, currency)
         values ($1, 49900, 'USD')`,
        [owner.organisationId],
      ).then(() => undefined),
    find: `select id from public.invoices where organisation_id = $1`,
    params: () => [owner.organisationId],
  },
  {
    table: 'policy_profiles',
    seed: () =>
      q(`insert into public.policy_profiles (organisation_id, name) values ($1, 'Sweep bar')`, [
        owner.organisationId,
      ]).then(() => undefined),
    find: `select id from public.policy_profiles where organisation_id = $1`,
    params: () => [owner.organisationId],
  },
  {
    table: 'workspace_branding',
    seed: () =>
      q(
        `insert into public.workspace_branding (organisation_id, display_name)
         values ($1, 'Sweep Agency')`,
        [owner.organisationId],
      ).then(() => undefined),
    find: `select organisation_id from public.workspace_branding where organisation_id = $1`,
    params: () => [owner.organisationId],
  },
  {
    table: 'trust_pages',
    seed: () =>
      q(
        `insert into public.trust_pages (app_id, organisation_id, contact_email)
         values ($1, $2, 'hello@sweep.example')`,
        [appId, owner.organisationId],
      ).then(() => undefined),
    find: `select app_id from public.trust_pages where organisation_id = $1`,
    params: () => [owner.organisationId],
  },
  {
    table: 'reviews',
    seed: () =>
      q(
        `insert into public.reviews (assessment_id, organisation_id, reviewer_id, action, reason)
         values ($1, $2, $3, 'approved', 'Findings and evidence checked against the rubric.')`,
        [assessmentId, owner.organisationId, reviewer.userId],
      ).then(() => undefined),
    find: `select id from public.reviews where organisation_id = $1`,
    params: () => [owner.organisationId],
  },
  {
    table: 'device_tokens',
    seed: () =>
      q(
        `insert into public.device_tokens (user_id, token, platform)
         values ($1, 'ExponentPushToken[sweep' || $2 || ']', 'ios')`,
        [owner.userId, Date.now().toString()],
      ).then(() => undefined),
    find: `select id from public.device_tokens where user_id = $1`,
    params: () => [owner.userId],
  },
  {
    table: 'sso_connections',
    seed: () =>
      q(
        `insert into public.sso_connections (organisation_id, email_domain, domain_challenge)
         values ($1, $2, $3)`,
        [owner.organisationId, `sweep-${Date.now()}.example`, `challenge-${randomUUID()}`],
      ).then(() => undefined),
    find: `select id from public.sso_connections where organisation_id = $1`,
    params: () => [owner.organisationId],
  },
  {
    table: 'drift_reports',
    seed: async () => {
      // Two assessments, because a drift report is a comparison. The second is
      // the one that got worse, which is the whole reason this row is sensitive:
      // it names what broke on somebody's application.
      const later = await seedAssessment(db, owner, { appId });
      await q(
        `insert into public.drift_reports
           (app_id, organisation_id, assessment_id, previous_assessment_id,
            score_before, score_after, score_delta)
         values ($1, $2, $3, $4, 82.00, 61.50, -20.50)`,
        [appId, owner.organisationId, later.assessmentId, assessmentId],
      );
    },
    find: `select id from public.drift_reports where organisation_id = $1`,
    params: () => [owner.organisationId],
  },
  {
    table: 'billing_events',
    seed: () =>
      q(
        `insert into public.billing_events
           (organisation_id, provider, provider_event_id, event_type, occurred_at, payload)
         values ($1, 'stripe', $2, 'invoice.paid', now(), '{}'::jsonb)`,
        [owner.organisationId, `evt_${randomUUID()}`],
      ).then(() => undefined),
    find: `select id from public.billing_events where organisation_id = $1`,
    params: () => [owner.organisationId],
  },
  {
    table: 'directory_listings and listing_events',
    seed: () =>
      q(
        `with listing as (
           insert into public.directory_listings (app_id, organisation_id, state, tagline)
           values ($1, $2, 'listed', 'A sweep fixture')
           returning app_id, organisation_id
         )
         insert into public.listing_events (app_id, organisation_id, state)
         select app_id, organisation_id, 'listed' from listing`,
        [appId, owner.organisationId],
      ).then(() => undefined),
    find: `select app_id from public.listing_events where organisation_id = $1`,
    params: () => [owner.organisationId],
  },
  {
    table: 'builder_profile_apps',
    seed: async () => {
      // A builder profile is the consented, published account of somebody's
      // work. Which applications they put on it is a decision they made, and a
      // row here names an application by id whether or not the profile is
      // published yet.
      await q(
        `insert into public.builder_profiles (organisation_id, handle, display_name)
         values ($1, $2, 'Sweep Builder')
         on conflict (organisation_id) do nothing`,
        [owner.organisationId, `sweep-${randomUUID().slice(0, 8)}`],
      );
      await q(
        `insert into public.builder_profile_apps (organisation_id, app_id, consented_by)
         values ($1, $2, $3) on conflict do nothing`,
        [owner.organisationId, appId, owner.userId],
      );
    },
    find: `select app_id from public.builder_profile_apps where organisation_id = $1`,
    params: () => [owner.organisationId],
  },
];

describe('a signed-in stranger reading another workspace', () => {
  it.each(cases.map((entry) => [entry.table, entry] as const))(
    'sees nothing of %s',
    async (_table, entry) => {
      await entry.seed();

      // First that the row is there and its owner can read it. An isolation
      // assertion over an empty table is the vacuous pass this file exists to
      // stop being possible.
      const mine = await actingAs(db, { userId: owner.userId, aal: 'aal2' }, async (client) => {
        const { rows } = await client.query(entry.find, entry.params());
        return rows.length;
      });
      expect(mine, `the owner cannot read their own ${entry.table}`).toBeGreaterThan(0);

      const theirs = await actingAs(
        db,
        { userId: stranger.userId, aal: 'aal2' },
        async (client) => {
          const { rows } = await client.query(entry.find, entry.params());
          return rows.length;
        },
      );
      expect(theirs).toBe(0);
    },
  );
});

describe('the tables keyed to a person rather than a workspace', () => {
  it('shows a colleague in the same workspace nobody else’s profile row', async () => {
    /*
     * `users_select_self_or_colleague` is deliberately wider than the rest: a
     * workspace has to be able to show who is in it. So the assertion is not
     * "sees nothing" but "sees the colleagues and no further" — a member of one
     * workspace must not be able to read a user in another.
     */
    const outsider = await actingAs(
      db,
      { userId: stranger.userId, aal: 'aal2' },
      async (client) => {
        const { rows } = await client.query(`select id from public.users where id = $1`, [
          owner.userId,
        ]);
        return rows.length;
      },
    );
    expect(outsider).toBe(0);

    const self = await actingAs(db, { userId: owner.userId, aal: 'aal2' }, async (client) => {
      const { rows } = await client.query(`select id from public.users where id = $1`, [
        owner.userId,
      ]);
      return rows.length;
    });
    expect(self).toBe(1);
  });
});
