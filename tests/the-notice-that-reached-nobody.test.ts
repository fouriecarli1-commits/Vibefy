/**
 * A notice we were obliged to give, that reached nobody, and nothing said so.
 *
 * `alerts.delivered_at` has carried this comment since the migration that
 * created it: "Set once the alert has been delivered outside the console. Null
 * means it has only ever been visible to someone who happened to log in." The
 * same migration built `alerts_undelivered_idx ... where delivered_at is null`,
 * an index whose only purpose is to answer which alerts reached nobody.
 *
 * Measured on 2026-10-09: a `critical` `badge_suspended` alert, for an
 * organisation whose only member's address had hard-bounced and who had no
 * device registered, appears in neither pending query, has no row in
 * `alert_deliveries`, has `delivered_at` null, and is mentioned nowhere else.
 * The Badge Licence obliges us to give that notice.
 *
 * Both channels already close the half they can see: a provider that keeps
 * refusing gets the attempt written down as a failure rather than left silent.
 * Neither can see the case where there was no attempt to record, because an
 * alert in that state never enters either pending query.
 *
 * Both directions are held here. A notice nobody could have received is
 * recorded; one that was delivered, one still inside its retry window, and one
 * nothing was ever supposed to deliver are left alone — a log that fills with
 * entries about `info` alerts is a log nobody reads.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { findPendingEmails } from '../apps/worker/src/email.ts';
import { findPendingPushes } from '../apps/worker/src/push.ts';
import {
  NOTICE_NOT_GIVEN_AFTER_DAYS,
  sweepUndeliveredNotices,
} from '../apps/worker/src/notices.ts';
import { connect } from './setup/client.ts';
import { seedAccount, seedApp, type SeededAccount } from './setup/seed.ts';

let db: Client;
let pool: Pool;

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

/** An alert, aged by writing its `created_at` into the past. */
async function raise(
  account: SeededAccount,
  appId: string | null,
  options: {
    kind: string;
    severity: 'info' | 'warning' | 'critical';
    key: string;
    daysOld?: number;
    delivered?: boolean;
  },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.alerts (organisation_id, app_id, kind, severity, title, body, dedupe_key,
                                created_at, delivered_at, delivery_channel)
     values ($1, $2, $3::text::public.alert_kind, $4::text::public.alert_severity, $5, $6, $7,
             now() - ($8 || ' days')::interval, $9, $10)
     returning id`,
    [
      account.organisationId,
      appId,
      options.kind,
      options.severity,
      `Kettle: a thing happened (${options.key})`,
      'The badge for Kettle has been suspended and must be removed from the site within seven days.',
      options.key,
      String(options.daysOld ?? 10),
      options.delivered ? new Date() : null,
      options.delivered ? 'email' : null,
    ],
  );
  return rows[0]!.id;
}

const recordedFor = async (alertId: string) => {
  const { rows } = await db.query<{ summary: string; actor_role: string }>(
    `select summary, actor_role from public.audit_log
      where entity_type = 'alert' and entity_id = $1 and action = 'alert.notice_not_given'`,
    [alertId],
  );
  return rows;
};

describe('a critical notice that could not be delivered', () => {
  let account: SeededAccount;
  let alertId: string;
  let freshId: string;

  beforeAll(async () => {
    account = await seedAccount(db, 'notice-nobody');
    const appId = await seedApp(db, account);
    // The address hard-bounced, so we must never write to it again, and no
    // device is registered. There is nowhere left to send.
    await db.query(
      `insert into public.email_suppressions (email, reason, kind)
       values ($1, 'mailbox does not exist', 'hard_bounce')`,
      [account.email],
    );
    alertId = await raise(account, appId, {
      kind: 'badge_suspended',
      severity: 'critical',
      key: 'notice-nobody',
    });
    // The same notice, raised today. The premise below needs one inside both
    // pending windows: a ten-day-old alert is outside them whatever the
    // addresses say, so asking the queries about it would prove nothing about
    // there being nowhere to send.
    freshId = await raise(account, appId, {
      kind: 'badge_suspended',
      severity: 'critical',
      key: 'notice-nobody-fresh',
      daysOld: 1,
    });
  });

  it('is attempted by neither channel, which is how it stayed silent', async () => {
    /*
     * The premise, asked of this alert rather than of a counter.
     *
     * The first version of this ran both sweeps and asserted `attempted === 0`
     * on each result. That passed here and failed in CI, correctly: a sweep
     * counts every pending alert in the database, so another test file's
     * seeded alert made the number 1 and said nothing at all about this one.
     * It is the same mistake as measuring with `count(*)` — an assertion about
     * a total, standing in for an assertion about the row.
     *
     * Asking the two pending queries directly is both the precise question and
     * free of side effects: running the sweeps here would deliver other files'
     * alerts as a by-product of establishing a premise.
     */
    const client = await pool.connect();
    try {
      const emails = await findPendingEmails(client);
      const pushes = await findPendingPushes(client);
      // The fresh one: well inside both windows, and in neither query, because
      // the one address belonging to this organisation is suppressed and no
      // device is registered. There is nowhere to send it.
      expect(emails.map((row) => row.alert_id)).not.toContain(freshId);
      expect(pushes.map((row) => row.alert_id)).not.toContain(freshId);
      expect(emails.map((row) => row.alert_id)).not.toContain(alertId);
      expect(pushes.map((row) => row.alert_id)).not.toContain(alertId);
    } finally {
      client.release();
    }

    const { rows } = await db.query<{ deliveries: string; delivered_at: string | null }>(
      `select a.delivered_at,
              (select count(*) from public.alert_deliveries d where d.alert_id = a.id) as deliveries
         from public.alerts a where a.id = $1`,
      [alertId],
    );
    expect(rows[0]!.delivered_at).toBeNull();
    expect(rows[0]!.deliveries).toBe('0');
  }, 60_000);

  it('is written down as a notice not given', async () => {
    const result = await sweepUndeliveredNotices(pool, () => undefined);
    expect(result.recorded).toBeGreaterThan(0);

    const recorded = await recordedFor(alertId);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.actor_role).toBe('system');
    // What it was, and why nobody got it — the two things an operator needs
    // before they can do anything about it.
    expect(recorded[0]!.summary).toMatch(/badge_suspended/);
    expect(recorded[0]!.summary).toMatch(/critical/);
    expect(recorded[0]!.summary).toMatch(/suppressed/i);
    expect(recorded[0]!.summary).toMatch(/no device is registered/i);
  }, 60_000);

  it('is written down once, however often the sweep runs', async () => {
    await sweepUndeliveredNotices(pool, () => undefined);
    await sweepUndeliveredNotices(pool, () => undefined);
    // The audit log is append-only and has no unique index, so a second row is
    // a second row for ever. Idempotence is the query's job.
    expect(await recordedFor(alertId)).toHaveLength(1);
  }, 60_000);
});

describe('what it leaves alone', () => {
  let account: SeededAccount;
  let control: string;

  beforeAll(async () => {
    account = await seedAccount(db, 'notice-quiet');
    /*
     * A control, in the same block as the three that must not be recorded.
     *
     * Without it a sweep that did nothing at all — threw, found no rows, was
     * handed the wrong pool — makes every assertion below pass, and each one
     * becomes evidence of the opposite of what it claims. This is the third
     * absence assertion tonight to need anchoring, and the only reason the
     * other two were found is that mutation went looking.
     */
    control = await raise(account, null, {
      kind: 'badge_suspended',
      severity: 'critical',
      key: 'quiet-control',
    });
    await db.query(
      `insert into public.email_suppressions (email, reason, kind)
       values ($1, 'mailbox does not exist', 'hard_bounce')`,
      [account.email],
    );
  });

  it('records the one that really did reach nobody', async () => {
    await sweepUndeliveredNotices(pool, () => undefined);
    expect(await recordedFor(control)).toHaveLength(1);
  }, 60_000);

  it('says nothing about an alert that was delivered', async () => {
    const id = await raise(account, null, {
      kind: 'badge_suspended',
      severity: 'critical',
      key: 'quiet-delivered',
      delivered: true,
    });
    await sweepUndeliveredNotices(pool, () => undefined);
    expect(await recordedFor(id)).toHaveLength(0);
  }, 60_000);

  it('says nothing about one still inside its retry window', async () => {
    const id = await raise(account, null, {
      kind: 'badge_suspended',
      severity: 'critical',
      key: 'quiet-young',
      daysOld: NOTICE_NOT_GIVEN_AFTER_DAYS - 2,
    });
    await sweepUndeliveredNotices(pool, () => undefined);
    expect(await recordedFor(id)).toHaveLength(0);
  }, 60_000);

  it('says nothing about an alert nothing was ever meant to deliver', async () => {
    // `info` is console-only by design: the severity floor in both pending
    // queries keeps it there. A log that fills with these is a log nobody
    // reads, and the real notices would be buried in it.
    const id = await raise(account, null, {
      kind: 'drift_detected',
      severity: 'info',
      key: 'quiet-info',
    });
    await sweepUndeliveredNotices(pool, () => undefined);
    expect(await recordedFor(id)).toHaveLength(0);
  }, 60_000);
});
