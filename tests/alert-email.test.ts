/**
 * Alerts by email.
 *
 * The channel that reaches everyone who did not install the app, which is most
 * people. What is tested is mostly restraint and honesty: the right recipients
 * and nobody else, never twice, an outage retried rather than recorded as a
 * loss, a dead address dropped rather than hammered, and a preference that
 * cannot silence a notice we are obliged to give.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import {
  FakeEmailProvider,
  isRetryable,
  renderAlertEmail,
  ResendEmailProvider,
  subjectFor,
  suppresses,
} from '../packages/notify/src/index.ts';
import { NON_RELIANCE_LEGEND } from '../packages/shared/src/index.ts';
import { lintText } from '../tools/copy-lint.mjs';
import { findPendingEmails, sweepAlertEmail } from '../apps/worker/src/email.ts';
import { connect } from './setup/client.ts';
import { seedAccount, seedApp, type SeededAccount } from './setup/seed.ts';

let db: Client;
let pool: Pool;

const CONSOLE = 'https://vibefycode.example';

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

describe('the email itself', () => {
  const input = {
    alertId: 'a1',
    kind: 'material_regression',
    severity: 'critical' as const,
    title: 'Kettle: material change found at re-assessment',
    body: 'The latest assessment found changes that fall outside what its verification covered.',
    appName: 'Kettle',
    consoleUrl: CONSOLE,
    recipientEmail: 'owner@example.test',
    deepLink: `${CONSOLE}/console/reports/a1`,
  };

  it('says what happened in the subject, and nothing louder', () => {
    expect(subjectFor(input)).toBe(input.title);
    // "Action required" on something that is not actionable teaches people to
    // ignore the ones that are.
    expect(subjectFor(input).toLowerCase()).not.toContain('urgent');
    expect(subjectFor(input).toLowerCase()).not.toContain('action required');
  });

  it('sends a text part as well as HTML', () => {
    const message = renderAlertEmail(input);
    expect(message.text).toContain(input.body);
    expect(message.text).toContain(input.deepLink);
    expect(message.html).toContain('<table');
  });

  it('carries no image, no web font and no tracking pixel', () => {
    const { html } = renderAlertEmail(input);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/fonts\.googleapis|@font-face/i);
    // A 1x1 beacon is the usual way an email knows it was opened. We do not.
    expect(html).not.toMatch(/width="1"|height="1"/);
    expect(html).not.toMatch(/https?:\/\/(?!vibefycode\.example)/);
  });

  it('repeats the non-reliance legend rather than softening it', () => {
    const message = renderAlertEmail(input);
    expect(message.text).toContain(NON_RELIANCE_LEGEND);
    expect(message.html).toContain(NON_RELIANCE_LEGEND.slice(0, 40));
  });

  it('says why it arrived, and where to change it', () => {
    const { text } = renderAlertEmail(input);
    expect(text).toMatch(/because you are a member of the workspace/);
    expect(text).toContain('/console/privacy');
    // No unsubscribe link, because there is no list — these are notices about
    // the customer's own application under an agreement they accepted.
    expect(text.toLowerCase()).not.toContain('unsubscribe');
  });

  it('passes the same copy gate as every other surface', () => {
    const message = renderAlertEmail(input);
    expect(lintText(message.text)).toEqual([]);
  });

  it('escapes what the alert row says rather than trusting it', () => {
    const { html } = renderAlertEmail({
      ...input,
      appName: '<script>alert(1)</script>',
      body: 'Ampersand & angle < bracket',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Ampersand &amp; angle &lt; bracket');
  });
});

describe('what a send result means', () => {
  it('retries an outage and a full mailbox, never a bad address', () => {
    expect(isRetryable({ sent: false, kind: 'provider_error', detail: '' })).toBe(true);
    expect(isRetryable({ sent: false, kind: 'soft_bounce', detail: '' })).toBe(true);
    expect(isRetryable({ sent: false, kind: 'hard_bounce', detail: '' })).toBe(false);
    expect(isRetryable({ sent: true, providerId: 'x' })).toBe(false);
  });

  it('suppresses only on a permanent failure', () => {
    expect(suppresses({ sent: false, kind: 'hard_bounce', detail: '' })).toBe(true);
    expect(suppresses({ sent: false, kind: 'soft_bounce', detail: '' })).toBe(false);
    expect(suppresses({ sent: false, kind: 'provider_error', detail: '' })).toBe(false);
  });

  it('treats a network failure as the provider’s problem, not the address’s', async () => {
    const provider = new ResendEmailProvider({
      apiKey: 'test',
      from: 'alerts@vibefycode.example',
      fetchImpl: async () => {
        throw new Error('ECONNRESET');
      },
    });
    const result = await provider.send({ to: 'a@b.test', subject: 's', text: 't', html: 'h' });
    expect(result.sent).toBe(false);
    expect(result.sent === false && result.kind).toBe('provider_error');
  });

  it('never puts the API key in the body it sends', async () => {
    let seen: RequestInit | undefined;
    const provider = new ResendEmailProvider({
      apiKey: 'rs_secret_value',
      from: 'alerts@vibefycode.example',
      fetchImpl: async (_url, init) => {
        seen = init;
        return new Response(JSON.stringify({ id: 'e1' }), { status: 200 });
      },
    });
    await provider.send({ to: 'a@b.test', subject: 's', text: 't', html: 'h' });
    expect(String(seen?.body)).not.toContain('rs_secret_value');
    expect(String((seen?.headers as Record<string, string>).authorization)).toContain(
      'rs_secret_value',
    );
  });
});

describe('the delivery sweep', () => {
  it('reaches every member of the workspace and nobody else', async () => {
    const owner = await seedAccount(db, 'email-owner');
    const stranger = await seedAccount(db, 'email-stranger');
    const appId = await seedApp(db, owner, 'Kettle');
    const alertId = await raise(owner, appId, 'critical', `email-scope-${Date.now()}`);

    const client = await pool.connect();
    try {
      const pending = (await findPendingEmails(client)).filter((row) => row.alert_id === alertId);
      expect(pending).toHaveLength(1);
      expect(pending[0]!.email).toBe(owner.email);
      expect(pending.some((row) => row.email === stranger.email)).toBe(false);
    } finally {
      client.release();
    }
  });

  it('never emails the same alert to the same person twice', async () => {
    const owner = await seedAccount(db, 'email-once');
    const appId = await seedApp(db, owner, 'Kettle');
    await raise(owner, appId, 'critical', `email-once-${Date.now()}`);

    const provider = new FakeEmailProvider();
    const first = await sweepAlertEmail(pool, provider, undefined, CONSOLE);
    expect(first.sent).toBeGreaterThanOrEqual(1);
    const before = provider.to(owner.email).length;

    await sweepAlertEmail(pool, provider, undefined, CONSOLE);
    expect(provider.to(owner.email)).toHaveLength(before);
  });

  it('does not email an informational alert', async () => {
    const owner = await seedAccount(db, 'email-info');
    const appId = await seedApp(db, owner, 'Kettle');
    await raise(owner, appId, 'info', `email-info-${Date.now()}`);

    const provider = new FakeEmailProvider();
    await sweepAlertEmail(pool, provider, undefined, CONSOLE);
    expect(provider.to(owner.email)).toHaveLength(0);
  });

  it('honours "only what needs action", and cannot silence what needs action', async () => {
    const owner = await seedAccount(db, 'email-quiet');
    const appId = await seedApp(db, owner, 'Kettle');
    await db.query(`update public.users set alert_email_level = 'critical_only' where id = $1`, [
      owner.userId,
    ]);

    await raise(owner, appId, 'warning', `email-quiet-warn-${Date.now()}`);
    const provider = new FakeEmailProvider();
    await sweepAlertEmail(pool, provider, undefined, CONSOLE);
    expect(provider.to(owner.email)).toHaveLength(0);

    // A badge suspension is a notice we are obliged to give, so there is no
    // setting that stops it.
    await raise(owner, appId, 'critical', `email-quiet-crit-${Date.now()}`);
    await sweepAlertEmail(pool, provider, undefined, CONSOLE);
    expect(provider.to(owner.email)).toHaveLength(1);
  });

  it('refuses a level that would silence everything', async () => {
    const owner = await seedAccount(db, 'email-none');
    await expect(
      db.query(`update public.users set alert_email_level = 'none' where id = $1`, [owner.userId]),
    ).rejects.toThrow(/alert_email_level/);
  });

  it('suppresses an address that hard-bounces, and stops writing to it', async () => {
    const owner = await seedAccount(db, 'email-bounce');
    await db.query(`update public.users set email = $2 where id = $1`, [
      owner.userId,
      `bounced-${Date.now()}@bounce.invalid`,
    ]);
    const appId = await seedApp(db, owner, 'Kettle');
    await raise(owner, appId, 'critical', `email-bounce-${Date.now()}`);

    const provider = new FakeEmailProvider();
    const result = await sweepAlertEmail(pool, provider, undefined, CONSOLE);
    expect(result.suppressed).toBeGreaterThanOrEqual(1);

    const { rows } = await db.query<{ kind: string }>(
      `select kind from public.email_suppressions where email = (select email from public.users where id = $1)`,
      [owner.userId],
    );
    expect(rows[0]!.kind).toBe('hard_bounce');

    // And the next alert to that address is not even attempted.
    await raise(owner, appId, 'critical', `email-bounce-2-${Date.now()}`);
    const client = await pool.connect();
    try {
      const pending = await findPendingEmails(client);
      expect(pending.some((row) => row.user_id === owner.userId)).toBe(false);
    } finally {
      client.release();
    }
  });

  it('retries a full mailbox rather than recording it as delivered', async () => {
    const owner = await seedAccount(db, 'email-soft');
    await db.query(`update public.users set email = $2 where id = $1`, [
      owner.userId,
      `slow-${Date.now()}@slow.invalid`,
    ]);
    const appId = await seedApp(db, owner, 'Kettle');
    const alertId = await raise(owner, appId, 'critical', `email-soft-${Date.now()}`);

    await sweepAlertEmail(pool, new FakeEmailProvider(), undefined, CONSOLE);

    const { rows } = await db.query('select id from public.alert_deliveries where alert_id = $1', [
      alertId,
    ]);
    // Nothing recorded, so the next sweep sees the same work.
    expect(rows).toHaveLength(0);
  });

  it('records nothing at all when the provider itself is down', async () => {
    const owner = await seedAccount(db, 'email-outage');
    const appId = await seedApp(db, owner, 'Kettle');
    const alertId = await raise(owner, appId, 'critical', `email-outage-${Date.now()}`);

    const result = await sweepAlertEmail(
      pool,
      new FakeEmailProvider({ failEverything: true }),
      undefined,
      CONSOLE,
    );
    expect(result.attempted).toBe(0);
    const { rows } = await db.query('select id from public.alert_deliveries where alert_id = $1', [
      alertId,
    ]);
    expect(rows).toHaveLength(0);
  });

  it('does nothing, quietly, when email is not configured', async () => {
    const result = await sweepAlertEmail(pool, null, undefined, CONSOLE);
    expect(result).toEqual({ attempted: 0, sent: 0, failed: 0, suppressed: 0 });
  });

  it('stamps the alert as delivered so the console can say we told them', async () => {
    const owner = await seedAccount(db, 'email-stamped');
    const appId = await seedApp(db, owner, 'Kettle');
    const alertId = await raise(owner, appId, 'critical', `email-stamp-${Date.now()}`);

    await sweepAlertEmail(pool, new FakeEmailProvider(), undefined, CONSOLE);

    const { rows } = await db.query<{ delivered_at: string | null; delivery_channel: string }>(
      'select delivered_at, delivery_channel from public.alerts where id = $1',
      [alertId],
    );
    expect(rows[0]!.delivered_at).not.toBeNull();
    expect(rows[0]!.delivery_channel).toBe('email');
  });

  it('refuses to edit a delivery record once written', async () => {
    await expect(
      db.query(`update public.alert_deliveries set status = 'sent' where status = 'failed'`),
    ).rejects.toThrow(/append-only/i);
  });
});

describe('the console surfaces what needs action, without being asked', () => {
  it('puts the banner on every console page rather than in a tab', () => {
    // Nobody reads email from a product like this, so the notice that changes
    // behaviour has to be on the screen the customer already opened.
    const layout = readFileSync(join(process.cwd(), 'apps/web/app/console/layout.tsx'), 'utf8');
    expect(layout).toContain('AlertBanner');

    const banner = readFileSync(
      join(process.cwd(), 'apps/web/components/alert-banner.tsx'),
      'utf8',
    );
    // Only critical. A banner that shows on every visit is one people learn to
    // scroll past, and the one that mattered goes with it.
    expect(banner).toMatch(/\.eq\('severity', 'critical'\)/);
    expect(banner).toMatch(/\.is\('read_at', null\)/);
    // Dismissing marks read; it never deletes. The history is the record.
    expect(banner).toContain('markAlertRead');
    expect(banner).not.toMatch(/\.delete\(/);
  });

  it('surfaces the same alerts on the mobile home screen', () => {
    const home = readFileSync(join(process.cwd(), 'apps/mobile/app/(tabs)/index.tsx'), 'utf8');
    expect(home).toContain('listAlerts');
    expect(home).toMatch(/severity === 'critical'/);
    expect(home).toContain('markAlertRead');
  });
});
