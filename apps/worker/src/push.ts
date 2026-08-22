/**
 * Delivering alerts to phones.
 *
 * The last sweep, and the one that closes the loop M4 left open: an alert that
 * only exists in the console is an alert seen by whoever happens to log in.
 *
 * Three rules, all enforced by the database rather than by this file:
 *   - one delivery row per alert per device, unique-indexed, so a sweep that
 *     runs twice cannot push twice;
 *   - a device token belongs to exactly one person, so the recipients of an
 *     alert are the members of the workspace it belongs to and nobody else;
 *   - the delivery record is append-only, so what we sent and when is not
 *     something anyone can revise afterwards.
 */
import {
  batch,
  buildMessage,
  expoPushSender,
  interpretTicket,
  isPushable,
  type ExpoMessage,
  type PushSender,
  type PushableAlert,
  type PushRecipient,
} from '@vibefy/api';
import type { PoolClient } from 'pg';

type Logger = (message: string, detail?: Record<string, unknown>) => void;
const noop: Logger = () => undefined;

interface Poolish {
  connect(): Promise<PoolClient>;
}

interface PendingRow {
  alert_id: string;
  app_id: string | null;
  severity: PushableAlert['severity'];
  title: string;
  body: string;
  device_token_id: string;
  token: string;
}

/**
 * Every warning-or-worse alert that has a device to reach and no delivery
 * attempt for it yet.
 *
 * The recipient set comes from membership of the alert's organisation, resolved
 * in SQL. Doing it in code would mean a second implementation of "who is allowed
 * to know about this", and the whole point of one client and one schema is that
 * there is only ever one.
 */
export async function findPendingPushes(
  client: PoolClient,
  limit = 200,
): Promise<PendingRow[]> {
  const { rows } = await client.query<PendingRow>(
    `select al.id as alert_id, al.app_id, al.severity::text as severity, al.title, al.body,
            dt.id as device_token_id, dt.token
       from public.alerts al
       join public.memberships m on m.organisation_id = al.organisation_id
       join public.device_tokens dt on dt.user_id = m.user_id and dt.disabled_at is null
      where al.severity in ('warning', 'critical')
        and al.created_at > now() - interval '7 days'
        and not exists (
          select 1 from public.alert_deliveries ad
           where ad.alert_id = al.id and ad.device_token_id = dt.id
        )
      order by al.created_at
      limit $1`,
    [limit],
  );
  return rows;
}

export interface PushSweepResult {
  readonly attempted: number;
  readonly delivered: number;
  readonly failed: number;
  readonly tokensDisabled: number;
}

export async function sweepAlertPush(
  pool: Poolish,
  send: PushSender = expoPushSender,
  log: Logger = noop,
): Promise<PushSweepResult> {
  const client = await pool.connect();
  const result = { attempted: 0, delivered: 0, failed: 0, tokensDisabled: 0 };
  try {
    const pending = await findPendingPushes(client);
    if (pending.length === 0) return result;

    for (const chunk of batch(pending)) {
      const messages: ExpoMessage[] = chunk.map((row) => {
        const alert: PushableAlert = {
          alertId: row.alert_id,
          appId: row.app_id,
          severity: row.severity,
          title: row.title,
          body: row.body,
        };
        const recipient: PushRecipient = { deviceTokenId: row.device_token_id, token: row.token };
        // Belt and braces: the query already filters, and this refuses anything
        // that slipped through a future change to it.
        if (!isPushable(alert)) throw new Error('Refusing to push an informational alert.');
        return buildMessage(alert, recipient);
      });

      let tickets;
      try {
        tickets = await send(messages);
      } catch (error) {
        // The batch is simply not recorded, so the next sweep tries it again.
        log('push send failed', { error: error instanceof Error ? error.message : String(error) });
        continue;
      }

      for (const [index, row] of chunk.entries()) {
        const outcome = interpretTicket(tickets[index]);
        result.attempted += 1;
        if (outcome.delivered) result.delivered += 1;
        else result.failed += 1;

        await client.query(
          `insert into public.alert_deliveries (alert_id, device_token_id, status, detail)
           values ($1, $2, $3, $4)
           on conflict (alert_id, device_token_id) do nothing`,
          [row.alert_id, row.device_token_id, outcome.delivered ? 'sent' : 'failed', outcome.detail],
        );

        if (outcome.disableToken) {
          await client.query(
            `update public.device_tokens set disabled_at = now(), disabled_reason = $2 where id = $1`,
            [row.device_token_id, outcome.disableReason],
          );
          result.tokensDisabled += 1;
        }

        if (outcome.delivered) {
          // Stamped on the alert itself so the console can say "we told you, and
          // how" rather than leaving the customer to guess.
          await client.query(
            `update public.alerts
                set delivered_at = coalesce(delivered_at, now()), delivery_channel = 'push'
              where id = $1`,
            [row.alert_id],
          );
        }
      }
    }

    if (result.attempted > 0) log('alert push sweep', { ...result });
    return result;
  } finally {
    client.release();
  }
}
