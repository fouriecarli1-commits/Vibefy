/**
 * Every policy that says a row must be written in the writer's own name.
 *
 * Twelve `with check` clauses in this schema compare a column to `auth.uid()`.
 * Five were covered. The other seven were weakened all at once — so that
 * anybody could write a row attributed to anybody — and the whole suite passed
 * except the check that noticed the migration files had changed. Not one
 * behavioural test noticed that an authorisation to test somebody's
 * application could be recorded under a colleague's name.
 *
 * That is the shape these clauses have in common and why they belong in one
 * file. Each of them is the difference between a row and a record of who did
 * something:
 *
 *   · `authorisations.granted_by` is the evidence that our testing was lawful.
 *     The brief is blunt about it — nothing runs against a target without a
 *     verified authorisation record — and a record naming somebody who did not
 *     grant it is worse than none, because it would be produced in a dispute.
 *   · `audit_log.actor_id` is the trail. An admin who can write an entry as a
 *     different admin can put their own actions under somebody else's name.
 *   · `device_tokens.user_id` decides whose phone gets a customer's alerts.
 *   · `users.id` is the profile row itself.
 *   · `apps.created_by` and `assessment_requests.requested_by` are the smaller
 *     two, and are here because the rule is the rule.
 *
 * Found by an accident: while watching an unrelated guard fail I weakened one
 * of two identical lines and hit the consents policy instead, and nothing
 * broke. The right response to that was not to fix the one policy I had
 * stumbled into but to ask the catalogue for every policy of that shape.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { actingAs, connect } from './setup/client.ts';
import { seedAccount, seedApp, type SeededAccount } from './setup/seed.ts';

let db: Client;
let owner: SeededAccount;
let colleague: SeededAccount;
let admin: SeededAccount;
let appId: string;

beforeAll(async () => {
  db = await connect();
  owner = await seedAccount(db, 'own-name-owner');
  colleague = await seedAccount(db, 'own-name-colleague');
  admin = await seedAccount(db, 'own-name-admin');
  await db.query(`update public.users set platform_role = 'admin' where id = $1`, [admin.userId]);
  // Seats, because the membership below needs one. A workspace with no
  // subscription has exactly one, which is the schema saying a workspace with
  // nobody paying is one person's workspace.
  await db.query(
    `insert into public.subscriptions (organisation_id, plan, status, seats, current_period_start, current_period_end)
     values ($1, 'agency', 'active', 5, now(), now() + interval '30 days')`,
    [owner.organisationId],
  );
  // A colleague in the same workspace, so every refusal below is about the name
  // on the row rather than about the workspace. A test where the writer has no
  // business being there at all would pass whatever these clauses said.
  await db.query(
    `insert into public.memberships (organisation_id, user_id, role) values ($1, $2, 'admin')`,
    [owner.organisationId, colleague.userId],
  );
  appId = await seedApp(db, owner);
});

afterAll(async () => {
  await db?.end();
});

/** Attempts a write as `userId` and returns either 'allowed' or the refusal. */
const attempt = (userId: string, sql: string, params: unknown[]) =>
  actingAs(db, { userId, aal: 'aal2' }, async (client) => {
    try {
      await client.query(sql, params);
      return 'allowed';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });

describe('an authorisation to test somebody’s application', () => {
  const grant = `insert into public.authorisations
      (app_id, organisation_id, method, warranty_text_version, warranty_text_sha256, granted_by, scope_domains)
    values ($1, $2, 'dns_txt', '1.0.0', $3, $4, array['own-name.example'])`;

  it('can be granted by an admin in their own name', async () => {
    expect(
      await attempt(colleague.userId, grant, [
        appId,
        owner.organisationId,
        'a'.repeat(64),
        colleague.userId,
      ]),
    ).toBe('allowed');
  });

  it('cannot be granted in a colleague’s name', async () => {
    /*
     * The one that matters most in this file. This row is the evidence that our
     * testing of somebody's application was lawful, and it is the row we would
     * produce if anybody ever asked. A `granted_by` naming a person who did not
     * grant it is worse than no record at all.
     */
    expect(
      await attempt(colleague.userId, grant, [
        appId,
        owner.organisationId,
        'b'.repeat(64),
        owner.userId,
      ]),
    ).toMatch(/row-level security/i);
  });
});

describe('the audit trail', () => {
  const entry = `insert into public.audit_log (organisation_id, actor_id, action, entity_type)
                 values ($1, $2, 'own_name.probe', 'app')`;

  it('an admin may write an entry as themselves', async () => {
    expect(await attempt(admin.userId, entry, [owner.organisationId, admin.userId])).toBe(
      'allowed',
    );
  });

  it('an admin may not write one as another admin', async () => {
    // An actor id somebody else can set is a trail that can be pointed at
    // whoever is convenient.
    const second = await seedAccount(db, 'own-name-admin-2');
    await db.query(`update public.users set platform_role = 'admin' where id = $1`, [
      second.userId,
    ]);
    expect(await attempt(admin.userId, entry, [owner.organisationId, second.userId])).toMatch(
      /row-level security/i,
    );
  });
});

describe('whose phone gets the alerts', () => {
  // Expo's own token shape, which the column's check insists on. A fixture
  // that cannot satisfy the constraint tests the constraint, not the policy.
  const register = `insert into public.device_tokens (user_id, token, platform)
                    values ($1, 'ExponentPushToken[' || $2 || ']', 'ios')`;

  it('a person may register their own device', async () => {
    expect(await attempt(owner.userId, register, [owner.userId, `a${Date.now()}`])).toBe('allowed');
  });

  it('a person may not register a device against somebody else', async () => {
    // A token registered against another account sends that customer's alerts
    // — which name their applications and what was found — to a stranger's
    // phone.
    expect(await attempt(owner.userId, register, [colleague.userId, `b${Date.now()}`])).toMatch(
      /row-level security/i,
    );
  });
});

describe('a profile row', () => {
  it('cannot be created for somebody else', async () => {
    /*
     * A fresh id rather than the colleague's.
     *
     * Pointing this at an account that already exists lets a unique-key
     * violation stand in for the refusal, so the assertion passes whatever the
     * policy says — which is what happened the first time I weakened the policy
     * to watch this fail. It was the one guard of seven that did not notice. An
     * id nothing else owns leaves only one thing that can refuse it.
     */
    const nobody = randomUUID();
    expect(
      await attempt(owner.userId, `insert into public.users (id, email) values ($1, $2)`, [
        nobody,
        `not-yours-${nobody.slice(0, 8)}@example.test`,
      ]),
    ).toMatch(/row-level security/i);
  });

  it('cannot be edited for somebody else', async () => {
    const changed = await actingAs(db, { userId: owner.userId, aal: 'aal2' }, async (client) => {
      const { rowCount } = await client.query(
        `update public.users set full_name = 'Renamed by somebody else' where id = $1`,
        [colleague.userId],
      );
      return rowCount;
    });
    expect(changed).toBe(0);
  });

  it('can be edited by its owner, so the refusal above is about the name', async () => {
    const changed = await actingAs(db, { userId: owner.userId, aal: 'aal2' }, async (client) => {
      const { rowCount } = await client.query(
        `update public.users set full_name = 'Renamed by its owner' where id = $1`,
        [owner.userId],
      );
      return rowCount;
    });
    expect(changed).toBe(1);
  });
});

describe('the smaller two, because the rule is the rule', () => {
  it('an application is created in the creator’s name', async () => {
    expect(
      await attempt(
        colleague.userId,
        `insert into public.apps (organisation_id, name, slug, app_type, primary_url, created_by)
         values ($1, 'Named Wrong', $2, 'web_url', 'https://own-name.example', $3)`,
        [owner.organisationId, `own-name-${Date.now()}`, owner.userId],
      ),
    ).toMatch(/row-level security/i);
  });

  it('an assessment is requested in the requester’s name', async () => {
    expect(
      await attempt(
        colleague.userId,
        `insert into public.assessment_requests
           (app_id, organisation_id, depth, plan_at_request, max_run_cost_usd, requested_by)
         values ($1, $2, 'limited', 'free', 1.00, $3)`,
        [appId, owner.organisationId, owner.userId],
      ),
    ).toMatch(/row-level security/i);
  });
});
