/**
 * Turning push notifications off on one handset, with two on the account.
 *
 * `removeDeviceTokens` deleted every token for the signed-in user, and the
 * screen that calls it says "This device will no longer receive alerts". The
 * function's own comments reason about "this phone" throughout — "a token left
 * behind pushes somebody else's alerts to this phone" — and the delete was
 * about all of them.
 *
 * So a customer with a phone and a tablet who turned the switch off on the
 * tablet stopped being pushed to on the phone. What stops arriving is the set
 * the mobile app names: a material change, an application that stopped
 * answering, a badge about to expire. The first of those is the notice the
 * Badge Licence obliges us to give, and `setAlertEmailLevel` deliberately has
 * no "none" for exactly that reason — "a notice a customer can switch off is
 * not one". This was that switch, operated from a different device, with a
 * sentence on screen saying it had done something else.
 *
 * The other half of the same confusion: the account screen asked whether the
 * account had any enabled token and drew the switch from that, so on a second
 * handset it read on before that handset had ever registered.
 *
 * Measured against the real table, because the claim is about what rows
 * survive. `removeDeviceTokens` takes the handset's own token when the app can
 * read it from the OS, and clears the account only when it cannot — saying so
 * in that case, since the one property this function exists for is that a
 * signed-out handset must not go on receiving the previous account's alerts.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { removeDeviceTokens, type DeviceTokenStore } from '../packages/api/src/push.ts';
import { connect } from './setup/client.ts';
import { seedAccount, type SeededAccount } from './setup/seed.ts';

const PHONE = 'ExponentPushToken[phone-one]';
const TABLET = 'ExponentPushToken[tablet-one]';

let db: Client;
let owner: SeededAccount;

/**
 * The real client's shape over a direct connection, so the delete this test
 * asserts about is the delete that runs.
 */
const store = (userId: string): DeviceTokenStore => ({
  auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
  from: () => {
    const conditions: [string, string][] = [];
    const run = async () => {
      const where = conditions.map(([column], i) => `${column} = $${i + 1}`).join(' and ');
      try {
        await db.query(
          `delete from public.device_tokens where ${where}`,
          conditions.map(([, value]) => value),
        );
        return { error: null };
      } catch (error) {
        return { error: { message: error instanceof Error ? error.message : String(error) } };
      }
    };
    const self = {
      eq: (column: 'user_id' | 'token', value: string) => {
        conditions.push([column, value]);
        return self;
      },
      then: <R1, R2 = never>(
        onfulfilled?:
          | ((value: { error: { message: string } | null }) => R1 | PromiseLike<R1>)
          | null,
        onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
      ) => run().then(onfulfilled, onrejected),
    };
    return { delete: () => self };
  },
});

const tokensLeft = async () => {
  const { rows } = await db.query<{ token: string }>(
    `select token from public.device_tokens where user_id = $1 order by token`,
    [owner.userId],
  );
  return rows.map((row) => row.token);
};

const bothRegistered = async () => {
  await db.query(`delete from public.device_tokens where user_id = $1`, [owner.userId]);
  await db.query(
    `insert into public.device_tokens (user_id, token, platform) values ($1, $2, 'ios'), ($1, $3, 'android')`,
    [owner.userId, PHONE, TABLET],
  );
};

beforeAll(async () => {
  db = await connect();
  owner = await seedAccount(db, 'two-handsets');
});

afterAll(async () => {
  await db?.end();
});

describe('two handsets on one account', () => {
  it('starts with both of them listening, which is the whole premise', async () => {
    await bothRegistered();
    expect(await tokensLeft()).toEqual([PHONE, TABLET].sort());
  });

  it('loses only the one that was switched off', async () => {
    await bothRegistered();
    const result = await removeDeviceTokens(store(owner.userId), { token: TABLET });
    expect(result.removed).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(await tokensLeft()).toEqual([PHONE]);
  });

  it('clears the account when the handset cannot name itself, and says so', async () => {
    // A revoked OS permission, no network, an Expo outage. The handset in hand
    // must stop being pushed to; the rest is collateral and is not pretended
    // away — the notice a customer reads says what happened.
    await bothRegistered();
    const result = await removeDeviceTokens(store(owner.userId));
    expect(result.removed).toBe(true);
    expect(result.reason).toMatch(/every device/i);
    expect(await tokensLeft()).toEqual([]);
  });
});

/*
 * `apps/mobile` cannot be imported here — `expo-device` pulls in
 * `react-native`, which is written in Flow and will not parse — so the two
 * cases below read the wiring instead.
 */
const push = readFileSync('apps/mobile/lib/push.ts', 'utf8');
const account = readFileSync('apps/mobile/app/(tabs)/account.tsx', 'utf8');

describe('the switch on the account screen', () => {
  it('asks about this handset rather than the account', () => {
    expect(push).toContain("eq('token', token)");
    expect(account).toContain('void pushIsOnForThisDevice().then(setPushOn);');
    // And the switch is still there to be set, which is what the above is about.
    expect(account).toContain('accessibilityLabel="Push notifications"');
  });

  it('reads off when the operating system has taken the permission away', () => {
    // `thisDeviceToken` returns null unless permission is granted, and the
    // switch is drawn from it: no permission means no push arrives, whatever
    // row is in the table.
    expect(push).toMatch(/if \(status !== 'granted'\) return null;/);
    expect(push).toMatch(/if \(token === null\) return false;/);
  });
});
