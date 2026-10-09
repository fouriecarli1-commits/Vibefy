/**
 * Sign out, and the phone keeps getting the previous account's alerts.
 *
 * `apps/mobile/lib/push.ts` carried this docstring on `unregisterPush`: "Called
 * on sign-out. A token left behind pushes somebody else's alerts to this
 * phone." The function then did `await supabase.from('device_tokens').delete()`
 * and discarded the `error`, returning `void`. The one failure its own comment
 * names was the one nothing looked at.
 *
 * Two consequences, and the second is the sharper of them:
 *
 *   · On sign-out the session is gone a line later, so a failed delete cannot
 *     be retried. The row keeps the previous user on it and the push sweep
 *     joins device tokens through membership, so the handset receives that
 *     organisation's alerts — app names, finding titles, badge suspensions. On
 *     a shared or resold phone that is a disclosure.
 *   · On the push toggle the screen said "This device will no longer receive
 *     alerts" whatever happened. A sentence about something that did not
 *     occur, told to the one person who could have fixed it.
 *
 * And a third the old code could not distinguish at all: no session, which
 * returned early as though it had succeeded while leaving the row exactly where
 * it was.
 *
 * Measured against the real sweep, not a mock of it: a token left behind is
 * handed to `findPendingPushes` for the organisation the signed-out user
 * belonged to.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { removeDeviceTokens, type DeviceTokenStore } from '../packages/api/src/push.ts';
import { findPendingPushes } from '../apps/worker/src/push.ts';
import { connect } from './setup/client.ts';
import { seedAccount, seedApp, type SeededAccount } from './setup/seed.ts';

let db: Client;
let pool: Pool;
let owner: SeededAccount;

beforeAll(async () => {
  db = await connect();
  const dsn = new URL(process.env.VIBEFYCODE_TEST_DSN!);
  pool = new Pool({
    host: dsn.searchParams.get('host')!,
    database: dsn.pathname.slice(1),
    user: 'postgres',
  });
  owner = await seedAccount(db, 'handset');
});

afterAll(async () => {
  await pool?.end();
  await db?.end();
});

/** A client that answers for a signed-in user and lets the delete through. */
function willing(userId: string, deleted: string[]): DeviceTokenStore {
  return {
    auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
    from: () => ({
      delete: () => ({
        eq: async (_column: 'user_id', value: string) => {
          deleted.push(value);
          return { error: null };
        },
      }),
    }),
  };
}

/** The same, but the store refuses. */
function refusing(
  userId: string,
  message = 'permission denied for table device_tokens',
): DeviceTokenStore {
  return {
    auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
    from: () => ({
      delete: () => ({ eq: async () => ({ error: { message } }) }),
    }),
  };
}

/** And one whose session has already gone. */
const sessionless: DeviceTokenStore = {
  auth: { getUser: async () => ({ data: { user: null } }) },
  from: () => ({
    delete: () => ({
      eq: async () => {
        throw new Error('nothing should reach the table without a user');
      },
    }),
  }),
};

describe('taking the handset off the list', () => {
  it('says it is done when the row went', async () => {
    const deleted: string[] = [];
    const result = await removeDeviceTokens(willing(owner.userId, deleted));
    expect(result.removed).toBe(true);
    expect(result.reason).toBeUndefined();
    // Scoped to this user, which is also what the RLS policy allows: a device
    // token belongs to exactly one person.
    expect(deleted).toEqual([owner.userId]);
  });

  it('says it is not done when the store refuses, and why', async () => {
    const result = await removeDeviceTokens(refusing(owner.userId));
    expect(result.removed).toBe(false);
    expect(result.reason).toMatch(/may still receive alerts/i);
    expect(result.reason).toMatch(/permission denied/);
  });

  it('says it is not done when there is no session left', async () => {
    // The old code returned here as though it had succeeded, which is how a row
    // with the previous user on it survived a sign-out in silence.
    const result = await removeDeviceTokens(sessionless);
    expect(result.removed).toBe(false);
    expect(result.reason).toMatch(/no longer a session/i);
    expect(result.reason).toMatch(/turn push notifications off, or remove the app/i);
  });
});

describe('what a token left behind actually does', () => {
  it('is handed to the push sweep for the account that signed out', async () => {
    // The premise, measured against the real query rather than asserted. This
    // is what the docstring on `unregisterPush` means by "somebody else's
    // alerts to this phone".
    const appId = await seedApp(db, owner);
    await db.query(
      `insert into public.device_tokens (user_id, platform, token)
       values ($1, 'ios', $2)`,
      [owner.userId, 'ExponentPushToken[left-behind-after-sign-out]'],
    );
    const { rows } = await db.query<{ id: string }>(
      `insert into public.alerts (organisation_id, app_id, kind, severity, title, body, dedupe_key)
       values ($1, $2, 'badge_suspended', 'critical', 'Kettle: the badge has been suspended',
               'The badge for Kettle has been suspended and must be removed from the site within seven days.',
               'handset-left-behind')
       returning id`,
      [owner.organisationId, appId],
    );

    const client = await pool.connect();
    try {
      const pending = await findPendingPushes(client);
      expect(pending.map((row) => row.alert_id)).toContain(rows[0]!.id);
      expect(
        pending.some((row) => row.token === 'ExponentPushToken[left-behind-after-sign-out]'),
      ).toBe(true);
    } finally {
      client.release();
    }
  }, 60_000);
});
