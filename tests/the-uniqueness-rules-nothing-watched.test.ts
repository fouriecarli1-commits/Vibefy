/**
 * Four uniqueness rules whose loss nothing noticed.
 *
 * A seventh mutation class. The six before it measured things that run — a
 * policy consulted, a trigger fired, a definer called — and `checks`, the layer
 * with no code in it that refuses a row for what its own columns say. A unique
 * index is the other half of that layer: it refuses a row because of a row that
 * is already there, which is how this schema says *only one of these may be
 * live*.
 *
 * Twenty-six, primary keys excluded. Dropping all of them failed eighty-four
 * tests, so the layer is heavily watched — the second class to come back looking
 * healthy. Narrowed in three runs rather than twenty-six:
 *
 *   · nine that no test names by name       → 57 failures, mostly cascading from
 *                                             `assessment_runs_…_attempt_key`
 *   · the same nine minus that one          → 32, cascading from the alert
 *                                             delivery and report ones
 *   · the five nothing had appeared to       → 1 real failure, plus the three
 *     notice                                  schema-gate ones that always fail
 *
 * That last failure is `billing.test.ts > activates and then cancels a
 * subscription`, which watches `subscriptions_provider_subscription_idx`. The
 * four below it noticed nothing at all, and each one is a rule with a
 * consequence:
 *
 *   · **`authorisations_supersedes_once`** — the chain of authorisations is how
 *     we prove we were permitted to test somebody's application. Two rows
 *     superseding the same one forks it, and "which authorisation permitted
 *     this assessment" stops having an answer.
 *   · **`invitations_token_sha256_key`** — `accept_invitation` finds the row by
 *     `where token_sha256 = …`. Two live invitations sharing a hash means one
 *     token admits somebody to either of two workspaces, whichever the planner
 *     returns.
 *   · **`device_tokens_token_key`** — one push token belonging to two accounts
 *     means alerts about one workspace delivered to a device signed into
 *     another. That is somebody else's data on a stranger's lock screen.
 *   · **`policy_profiles_one_default`** — two defaults for one organisation
 *     makes which policy applies depend on row order.
 *
 * Each test inserts the row the index exists to refuse, and asserts the refusal.
 * All four were watched failing against a schema with the four dropped, before
 * the schema was restored.
 */
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connect } from './setup/client.ts';
import { seedAccount, seedApp, seedAuthorisation, type SeededAccount } from './setup/seed.ts';

let db: Client;
let account: SeededAccount;
let appId: string;

/**
 * A workspace with room to invite somebody.
 *
 * A personal workspace has one seat and its owner is in it, so *any* invitation
 * trips the seat rule — which is a different rule with its own test, and the
 * first two versions of the control below tripped it and read as this index
 * refusing something it does not.
 */
async function workspaceWithSeats(seats: number): Promise<string> {
  const slug = `uniqueness-${randomUUID().slice(0, 8)}`;
  const { rows } = await db.query<{ id: string }>(
    `insert into public.organisations (name, slug, account_type, is_personal, created_by)
     values ('Uniqueness', $1, 'agency', false, $2) returning id`,
    [slug, account.userId],
  );
  const id = rows[0]!.id;
  await db.query(
    `insert into public.subscriptions
       (organisation_id, plan, status, seats, current_period_start, current_period_end)
     values ($1, 'agency', 'active', $2, now(), now() + interval '30 days')`,
    [id, seats],
  );
  await db.query(
    `insert into public.memberships (organisation_id, user_id, role) values ($1, $2, 'owner')`,
    [id, account.userId],
  );
  return id;
}

beforeAll(async () => {
  db = await connect();
  account = await seedAccount(db, 'uniqueness');
  appId = await seedApp(db, account, 'Kettle');
});

afterAll(async () => {
  await db?.end();
});

describe('the chain of authorisations', () => {
  it('cannot fork: two rows may not supersede the same one', async () => {
    const first = await seedAuthorisation(db, account, appId, { status: 'pending' });
    // `authorisations` is append-only, so superseding is the only way the chain
    // moves and a fork cannot be undone by an edit.
    const supersede = () =>
      db.query(
        `insert into public.authorisations (
           app_id, organisation_id, status, method, verification_target, verified_at,
           scope_domains, warranty_text_version, warranty_text_sha256, granted_by,
           supersedes_id
         ) values ($1, $2, 'verified', 'dns_txt', 'example.test', now(),
           array['example.test'], '1.0.0', repeat('a', 64), $3, $4)`,
        [appId, account.organisationId, account.userId, first],
      );

    await supersede();
    await expect(supersede()).rejects.toThrow(/authorisations_supersedes_once|duplicate key/i);
  });

  it('still lets a different row be superseded, so a chain can move at all', async () => {
    // The direction this guard fails in: refusing every supersede, which freezes
    // every authorisation at its first state.
    const other = await seedAuthorisation(db, account, appId, { status: 'pending' });
    await expect(
      db.query(
        `insert into public.authorisations (
           app_id, organisation_id, status, method, verification_target, verified_at,
           scope_domains, warranty_text_version, warranty_text_sha256, granted_by,
           supersedes_id
         ) values ($1, $2, 'verified', 'dns_txt', 'example.test', now(),
           array['example.test'], '1.0.0', repeat('a', 64), $3, $4)`,
        [appId, account.organisationId, account.userId, other],
      ),
    ).resolves.toBeDefined();
  });
});

/**
 * A hash nothing else in the suite can be holding.
 *
 * The first version used `'b'.repeat(64)` and friends. Those passed when this
 * file ran alone and failed in the full suite, because the test database is
 * shared and `fileParallelism` is off — so a fixed fixture value is an
 * order-dependent input. A collision with another file's invitation read as
 * this index refusing something it does not, which is the fourth time tonight a
 * fixture has impersonated the rule under test.
 */
const freshHash = () => createHash('sha256').update(randomUUID()).digest('hex');

describe('an invitation token', () => {
  // `expires_at` is not null and has no default: the table refuses an
  // invitation with no end, which is a rule of its own and not this one.
  const invite = (organisationId: string, email: string, hash: string) =>
    db.query(
      `insert into public.invitations
         (organisation_id, email, role, token_sha256, invited_by, expires_at)
       values ($1, $2, 'member', $3, $4, now() + interval '7 days')`,
      [organisationId, email, hash, account.userId],
    );

  it('admits somebody to one workspace, because no two invitations may share it', async () => {
    const one = await workspaceWithSeats(4);
    const two = await workspaceWithSeats(4);
    const hash = freshHash();

    await invite(one, `a-${randomUUID().slice(0, 8)}@example.test`, hash);
    // `accept_invitation` finds its row by `where token_sha256 = …`. Two rows
    // means the token admits somebody to whichever one the planner returns.
    await expect(invite(two, `b-${randomUUID().slice(0, 8)}@example.test`, hash)).rejects.toThrow(
      /invitations_token_sha256_key|duplicate key/i,
    );
  });

  it('still allows two invitations with different tokens', async () => {
    const room = await workspaceWithSeats(4);

    await invite(room, `d-${randomUUID().slice(0, 8)}@example.test`, freshHash());
    await expect(
      invite(room, `e-${randomUUID().slice(0, 8)}@example.test`, freshHash()),
    ).resolves.toBeDefined();
  });
});

describe('a push token', () => {
  // The shape the table insists on: `device_tokens_token_check` requires an
  // Expo push token, which is a different rule and has its own test.
  const expoToken = () => `ExponentPushToken[${randomUUID().replace(/-/g, '')}]`;
  const register = (userId: string, token: string) =>
    db.query(`insert into public.device_tokens (user_id, token, platform) values ($1, $2, 'ios')`, [
      userId,
      token,
    ]);

  it('belongs to one account, so alerts cannot reach a stranger’s lock screen', async () => {
    const other = await seedAccount(db, `uniqueness-device-${randomUUID().slice(0, 8)}`);
    const token = expoToken();

    await register(account.userId, token);
    await expect(register(other.userId, token)).rejects.toThrow(
      /device_tokens_token_key|duplicate key/i,
    );
  });

  it('still lets one account register two devices', async () => {
    await expect(register(account.userId, expoToken())).resolves.toBeDefined();
  });
});

describe('an organisation’s default policy profile', () => {
  const profile = (organisationId: string, name: string, isDefault: boolean) =>
    db.query(
      `insert into public.policy_profiles (organisation_id, name, is_default, created_by)
       values ($1, $2, $3, $4)`,
      [organisationId, name, isDefault, account.userId],
    );

  it('is one, not two, so which policy applies does not depend on row order', async () => {
    const workspace = await seedAccount(db, `uniqueness-policy-${randomUUID().slice(0, 8)}`);

    await profile(workspace.organisationId, 'House standard', true);
    await expect(profile(workspace.organisationId, 'Also house standard', true)).rejects.toThrow(
      /policy_profiles_one_default|duplicate key/i,
    );
  });

  it('still allows any number that are not the default', async () => {
    const workspace = await seedAccount(db, `uniqueness-policy-2-${randomUUID().slice(0, 8)}`);
    await profile(workspace.organisationId, 'Strict', false);
    await expect(profile(workspace.organisationId, 'Stricter', false)).resolves.toBeDefined();
  });
});
