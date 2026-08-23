/**
 * Push notifications.
 *
 * A notification is the most intrusive thing this product does to somebody's
 * day, so what is tested here is mostly restraint: only alerts that need action
 * are pushed, never the same one twice, never to a device that is not the
 * owner's, and a dead token stops being used rather than being retried for ever.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import {
  batch,
  buildMessage,
  interpretTicket,
  isPushable,
  type ExpoMessage,
  type PushTicket,
} from '../packages/api/src/index.ts';
import { findPendingPushes, sweepAlertPush } from '../apps/worker/src/push.ts';
import { connect } from './setup/client.ts';
import { seedAccount, seedApp, type SeededAccount } from './setup/seed.ts';

let db: Client;
let pool: Pool;

const token = (suffix: string) => `ExponentPushToken[${suffix}]`;

async function registerDevice(account: SeededAccount, suffix: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.device_tokens (user_id, token, platform) values ($1, $2, 'ios') returning id`,
    [account.userId, token(suffix)],
  );
  return rows[0]!.id;
}

async function raise(
  account: SeededAccount,
  appId: string | null,
  severity: 'info' | 'warning' | 'critical',
  key: string,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.alerts (organisation_id, app_id, kind, severity, title, body, dedupe_key)
     values ($1, $2, 'drift_detected', $3::text::public.alert_severity, $4, $5, $6) returning id`,
    [
      account.organisationId,
      appId,
      severity,
      `Kettle: something changed (${key})`,
      'A re-assessment of Kettle finished and the overall score moved. Open the report to see what.',
      key,
    ],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  db = await connect();
  const dsn = new URL(process.env.VIBEFYCODE_TEST_DSN!);
  pool = new Pool({
    host: dsn.searchParams.get('host')!,
    database: dsn.pathname.slice(1),
    user: 'postgres',
  });
});

afterAll(async () => {
  await pool?.end();
  await db?.end();
});

describe('what is worth interrupting someone for', () => {
  it('pushes warnings and criticals, never information', () => {
    expect(isPushable({ severity: 'critical' })).toBe(true);
    expect(isPushable({ severity: 'warning' })).toBe(true);
    // "Your score went up" can wait until they open the app.
    expect(isPushable({ severity: 'info' })).toBe(false);
  });

  it('sends a critical at high priority and a warning at default', () => {
    const alert = { alertId: 'a1', appId: 'app1', title: 'T', body: 'B' } as const;
    expect(
      buildMessage({ ...alert, severity: 'critical' }, { deviceTokenId: 'd', token: token('x') })
        .priority,
    ).toBe('high');
    expect(
      buildMessage({ ...alert, severity: 'warning' }, { deviceTokenId: 'd', token: token('x') })
        .priority,
    ).toBe('default');
  });

  it('collapses whitespace and truncates rather than sending a wall of text', () => {
    const message = buildMessage(
      {
        alertId: 'a1',
        appId: null,
        severity: 'warning',
        title: 'Kettle:  score\n  fell',
        body: 'x'.repeat(400),
      },
      { deviceTokenId: 'd', token: token('x') },
    );
    expect(message.title).toBe('Kettle: score fell');
    expect(message.body).toHaveLength(240);
    expect(message.body.endsWith('…')).toBe(true);
  });

  it('carries the alert id so a tap opens the right thing', () => {
    const message = buildMessage(
      { alertId: 'a1', appId: 'app1', severity: 'critical', title: 'T', body: 'B' },
      { deviceTokenId: 'd', token: token('x') },
    );
    expect(message.data).toEqual({ alertId: 'a1', appId: 'app1' });
  });

  it('batches at Expo’s limit', () => {
    expect(
      batch(Array.from({ length: 250 }, (_, index) => index)).map((part) => part.length),
    ).toEqual([100, 100, 50]);
    expect(batch([])).toEqual([]);
  });
});

describe('what a ticket means', () => {
  it('treats a missing ticket as undelivered, not as delivered', () => {
    expect(interpretTicket(undefined).delivered).toBe(false);
  });

  it('disables a token Expo says is no longer registered', () => {
    const outcome = interpretTicket({
      status: 'error',
      message: 'not registered',
      details: { error: 'DeviceNotRegistered' },
    } satisfies PushTicket);
    expect(outcome.delivered).toBe(false);
    expect(outcome.disableToken).toBe(true);
  });

  it('does not disable a token over a transient error', () => {
    const outcome = interpretTicket({
      status: 'error',
      message: 'rate limited',
      details: { error: 'MessageRateExceeded' },
    });
    expect(outcome.disableToken).toBe(false);
  });
});

describe('the delivery sweep', () => {
  it('reaches every member’s device and nobody else’s', async () => {
    const owner = await seedAccount(db, 'push-owner');
    const stranger = await seedAccount(db, 'push-stranger');
    const appId = await seedApp(db, owner, 'Kettle');
    await registerDevice(owner, 'owner-1');
    await registerDevice(stranger, 'stranger-1');
    const alertId = await raise(owner, appId, 'critical', `push-scope-${Date.now()}`);

    const client = await pool.connect();
    try {
      const pending = await findPendingPushes(client);
      const forThisAlert = pending.filter((row) => row.alert_id === alertId);
      expect(forThisAlert).toHaveLength(1);
      expect(forThisAlert[0]!.token).toBe(token('owner-1'));
    } finally {
      client.release();
    }
  });

  it('never pushes the same alert to the same device twice', async () => {
    const owner = await seedAccount(db, 'push-once');
    const appId = await seedApp(db, owner, 'Kettle');
    await registerDevice(owner, 'once-1');
    await raise(owner, appId, 'critical', `push-once-${Date.now()}`);

    const sent: ExpoMessage[][] = [];
    const sender = async (messages: readonly ExpoMessage[]) => {
      sent.push([...messages]);
      return messages.map(() => ({ status: 'ok' as const, id: 'ticket' }));
    };

    const first = await sweepAlertPush(pool, sender);
    expect(first.delivered).toBeGreaterThanOrEqual(1);
    const second = await sweepAlertPush(pool, sender);
    expect(second.attempted).toBe(0);
  });

  it('stamps the alert as delivered so the console can say how', async () => {
    const owner = await seedAccount(db, 'push-stamped');
    const appId = await seedApp(db, owner, 'Kettle');
    await registerDevice(owner, 'stamped-1');
    const alertId = await raise(owner, appId, 'warning', `push-stamp-${Date.now()}`);

    await sweepAlertPush(pool, async (messages) => messages.map(() => ({ status: 'ok' as const })));

    const { rows } = await db.query<{
      delivered_at: string | null;
      delivery_channel: string | null;
    }>('select delivered_at, delivery_channel from public.alerts where id = $1', [alertId]);
    expect(rows[0]!.delivered_at).not.toBeNull();
    expect(rows[0]!.delivery_channel).toBe('push');
  });

  it('disables a dead token instead of retrying it for ever', async () => {
    const owner = await seedAccount(db, 'push-dead');
    const appId = await seedApp(db, owner, 'Kettle');
    const deviceId = await registerDevice(owner, 'dead-1');
    await raise(owner, appId, 'critical', `push-dead-${Date.now()}`);

    await sweepAlertPush(pool, async (messages) =>
      messages.map(() => ({
        status: 'error' as const,
        message: 'not registered',
        details: { error: 'DeviceNotRegistered' },
      })),
    );

    const { rows } = await db.query<{ disabled_at: string | null }>(
      'select disabled_at from public.device_tokens where id = $1',
      [deviceId],
    );
    expect(rows[0]!.disabled_at).not.toBeNull();
  });

  it('retries the whole batch when the push service itself fails', async () => {
    const owner = await seedAccount(db, 'push-outage');
    const appId = await seedApp(db, owner, 'Kettle');
    await registerDevice(owner, 'outage-1');
    const alertId = await raise(owner, appId, 'critical', `push-outage-${Date.now()}`);

    // Nothing is recorded, so the next sweep sees the same work rather than
    // treating an outage as a delivery.
    const failed = await sweepAlertPush(pool, async () => {
      throw new Error('Expo push service returned 503.');
    });
    expect(failed.attempted).toBe(0);

    const client = await pool.connect();
    try {
      const pending = await findPendingPushes(client);
      expect(pending.some((row) => row.alert_id === alertId)).toBe(true);
    } finally {
      client.release();
    }
  });

  it('refuses to change a delivery record once written', async () => {
    const owner = await seedAccount(db, 'push-append-only');
    const appId = await seedApp(db, owner, 'Kettle');
    const deviceId = await registerDevice(owner, 'append-1');
    const alertId = await raise(owner, appId, 'critical', `push-append-${Date.now()}`);
    await db.query(
      `insert into public.alert_deliveries (alert_id, channel, target_id, status)
       values ($1, 'push', $2, 'sent')`,
      [alertId, deviceId],
    );
    await expect(
      db.query(`update public.alert_deliveries set status = 'failed' where alert_id = $1`, [
        alertId,
      ]),
    ).rejects.toThrow(/append-only/i);
  });

  it('refuses a token that is not an Expo push token', async () => {
    const owner = await seedAccount(db, 'push-bad-token');
    await expect(
      db.query(
        `insert into public.device_tokens (user_id, token, platform) values ($1, 'not-a-token', 'ios')`,
        [owner.userId],
      ),
    ).rejects.toThrow();
  });
});
