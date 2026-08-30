/**
 * Delivering alerts by email.
 *
 * The sibling of `push.ts`, and deliberately the same shape: find what has not
 * been delivered, send it, record the attempt, and let the unique index make a
 * second sweep a no-op. Between the two, an alert now reaches someone whether or
 * not they installed the app — which is what M4 promised and neither channel
 * delivered on its own.
 *
 * Four rules, all enforced by the database rather than by this file:
 *   · one attempt per alert per channel per target, unique-indexed;
 *   · the recipients of an alert are the members of the workspace it belongs to;
 *   · a suppressed address is never written to again;
 *   · the delivery record is append-only, so what we sent and when is not
 *     something anyone can revise afterwards.
 */
import {
  isRetryable,
  renderAlertEmail,
  suppresses,
  type AlertSeverity,
  type EmailProvider,
} from '@vibefycode/notify';
import type { PoolClient } from 'pg';

type Logger = (message: string, detail?: Record<string, unknown>) => void;
const noop: Logger = () => undefined;

interface Poolish {
  connect(): Promise<PoolClient>;
}

interface PendingRow {
  alert_id: string;
  kind: string;
  severity: AlertSeverity;
  title: string;
  body: string;
  app_name: string | null;
  assessment_id: string | null;
  app_id: string | null;
  user_id: string;
  email: string;
}

/**
 * Every alert that someone is entitled to and has asked for, and that has not
 * been emailed to them yet.
 *
 * `alert_email_level` is honoured in SQL rather than in code: a preference that
 * only one code path checks is a preference that the next code path ignores.
 * There is no level that silences a critical alert, because a badge suspension
 * is a notice we are obliged to give.
 */
export async function findPendingEmails(client: PoolClient, limit = 200): Promise<PendingRow[]> {
  const { rows } = await client.query<PendingRow>(
    `select al.id as alert_id, al.kind::text as kind, al.severity::text as severity,
            al.title, al.body, al.assessment_id, al.app_id,
            app.name as app_name,
            u.id as user_id, u.email::text as email
       from public.alerts al
       join public.memberships m on m.organisation_id = al.organisation_id
       join public.users u on u.id = m.user_id
       left join public.apps app on app.id = al.app_id
      where al.created_at > now() - interval '7 days'
        and u.deleted_at is null
        -- Two filters, and one exception to both.
        --
        -- The severity floor exists so nobody is emailed about routine
        -- information. badge_issued is information and is still the one event
        -- the customer paid for: it happens once per badge, it carries the embed
        -- snippet they need, and a product that reliably delivers its bad news
        -- and stays quiet about its good news teaches people to dread its name.
        -- It is exempt from the floor, not promoted above it — calling a badge
        -- being issued a "warning" to get it delivered would be a lie told to
        -- the code so it would behave.
        and (
          al.kind = 'badge_issued'
          or (
            (u.alert_email_level = 'all' or al.severity = 'critical')
            and al.severity in ('warning', 'critical')
          )
        )
        and not exists (
          select 1 from public.email_suppressions s where s.email = u.email
        )
        and not exists (
          select 1 from public.alert_deliveries d
           where d.alert_id = al.id and d.channel = 'email' and d.target_id = u.id
        )
      order by al.created_at
      limit $1`,
    [limit],
  );
  return rows;
}

export interface EmailSweepResult {
  readonly attempted: number;
  readonly sent: number;
  readonly failed: number;
  readonly suppressed: number;
}

export async function sweepAlertEmail(
  pool: Poolish,
  provider: EmailProvider | null,
  log: Logger = noop,
  consoleUrl = process.env.NEXT_PUBLIC_SITE_URL ?? '',
): Promise<EmailSweepResult> {
  const result = { attempted: 0, sent: 0, failed: 0, suppressed: 0 };
  if (!provider) {
    // Not an error. A deployment that runs assessments and sends no email is a
    // legitimate deployment; saying so once beats failing a sweep every five
    // minutes.
    return result;
  }

  const client = await pool.connect();
  try {
    const pending = await findPendingEmails(client);
    for (const row of pending) {
      const deepLink = row.assessment_id
        ? `${consoleUrl}/console/reports/${row.assessment_id}`
        : row.app_id
          ? `${consoleUrl}/console/apps/${row.app_id}`
          : null;

      const message = renderAlertEmail({
        alertId: row.alert_id,
        kind: row.kind,
        severity: row.severity,
        title: row.title,
        body: row.body,
        appName: row.app_name,
        consoleUrl,
        recipientEmail: row.email,
        deepLink,
      });

      const outcome = await provider.send(message);
      // A provider outage or a full mailbox records nothing, so the next sweep
      // tries again. Recording a failure we never really attempted would turn an
      // outage into a permanent silent loss.
      if (isRetryable(outcome)) {
        log('alert email deferred', {
          alertId: row.alert_id,
          reason: outcome.sent ? '' : outcome.detail,
        });
        continue;
      }

      result.attempted += 1;
      if (outcome.sent) result.sent += 1;
      else result.failed += 1;

      await client.query(
        `insert into public.alert_deliveries (alert_id, channel, target_id, status, detail)
         values ($1, 'email', $2, $3, $4)
         on conflict (alert_id, channel, target_id) do nothing`,
        [
          row.alert_id,
          row.user_id,
          outcome.sent ? 'sent' : 'failed',
          outcome.sent ? null : outcome.detail,
        ],
      );

      if (suppresses(outcome)) {
        await client.query(
          `insert into public.email_suppressions (email, reason, kind)
           values ($1, $2, 'hard_bounce')
           on conflict (email) do nothing`,
          [row.email, outcome.sent ? '' : outcome.detail.slice(0, 500)],
        );
        result.suppressed += 1;
        log('address suppressed', { userId: row.user_id });
      }

      if (outcome.sent) {
        await client.query(
          `update public.alerts
              set delivered_at = coalesce(delivered_at, now()),
                  delivery_channel = coalesce(delivery_channel, 'email')
            where id = $1`,
          [row.alert_id],
        );
      }
    }

    if (result.attempted > 0) log('alert email sweep', { ...result });
    return result;
  } finally {
    client.release();
  }
}
