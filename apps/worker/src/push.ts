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
} from '@vibefycode/api';
import type { PoolClient } from 'pg';

type Logger = (message: string, detail?: Record<string, unknown>) => void;
const noop: Logger = () => undefined;

interface Poolish {
  connect(): Promise<PoolClient>;
}

interface PendingRow {
  alert_id: string;
  created_at: string;
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
export async function findPendingPushes(client: PoolClient, limit = 200): Promise<PendingRow[]> {
  const { rows } = await client.query<PendingRow>(
    `select al.id as alert_id, al.created_at, al.app_id, al.severity::text as severity,
            al.title, al.body,
            dt.id as device_token_id, dt.token
       from public.alerts al
       join public.memberships m on m.organisation_id = al.organisation_id
       join public.device_tokens dt on dt.user_id = m.user_id and dt.disabled_at is null
      where al.severity in ('warning', 'critical')
        and al.created_at > now() - interval '7 days'
        and not exists (
          select 1 from public.alert_deliveries ad
           where ad.alert_id = al.id and ad.channel = 'push' and ad.target_id = dt.id
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
  /** In a batch the sender could not take, to be tried again next sweep. */
  readonly deferred: number;
  /** Written off, because trying again has run out of again. */
  readonly abandoned: number;
}

/**
 * How long a push may keep being deferred before it is written down as failed.
 *
 * A day inside the seven-day window the query uses, and the gap is the whole
 * point. A sender that throws records nothing, deliberately, so an outage does
 * not become a permanent loss. But recording nothing also meant that on the
 * eighth day the alert dropped out of the query having never reached the phone
 * and having left no trace of not reaching it — and this file's own docstring
 * calls the delivery table the record of what we sent and when. It held neither
 * a success nor a failure, so "never attempted" and "attempted and lost" were
 * the same thing to anyone reading it afterwards, and both looked like success.
 */
export const PUSH_GIVE_UP_AFTER_DAYS = 6;

export async function sweepAlertPush(
  pool: Poolish,
  send: PushSender = expoPushSender,
  log: Logger = noop,
  now: Date = new Date(),
): Promise<PushSweepResult> {
  const client = await pool.connect();
  const result = {
    attempted: 0,
    delivered: 0,
    failed: 0,
    tokensDisabled: 0,
    deferred: 0,
    abandoned: 0,
  };
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
        // The batch is simply not recorded, so the next sweep tries it again —
        // except for the rows that have been waiting so long they are about to
        // age out of the query, which are written down as the failures they
        // have become rather than allowed to vanish unaccounted for.
        const detail = error instanceof Error ? error.message : String(error);
        for (const row of chunk) {
          const age = now.getTime() - new Date(row.created_at).getTime();
          if (age < PUSH_GIVE_UP_AFTER_DAYS * 86_400_000) {
            result.deferred += 1;
            continue;
          }
          result.abandoned += 1;
          await client.query(
            `insert into public.alert_deliveries (alert_id, channel, target_id, status, detail)
             values ($1, 'push', $2, 'failed', $3)
             on conflict (alert_id, channel, target_id) do nothing`,
            [row.alert_id, row.device_token_id, `Never sent: ${detail}`.slice(0, 500)],
          );
          log('push given up on', { alertId: row.alert_id, error: detail });
        }
        continue;
      }

      for (const [index, row] of chunk.entries()) {
        const outcome = interpretTicket(tickets[index]);
        result.attempted += 1;
        if (outcome.delivered) result.delivered += 1;
        else result.failed += 1;

        await client.query(
          `insert into public.alert_deliveries (alert_id, channel, target_id, status, detail)
           values ($1, 'push', $2, $3, $4)
           on conflict (alert_id, channel, target_id) do nothing`,
          [
            row.alert_id,
            row.device_token_id,
            outcome.delivered ? 'sent' : 'failed',
            outcome.detail,
          ],
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

    // Deferrals count as something having happened. Gating this on `attempted`
    // meant a sweep in which the sender was down throughout said nothing about
    // itself at all.
    if (result.attempted > 0 || result.deferred > 0) log('alert push sweep', { ...result });
    return result;
  } finally {
    client.release();
  }
}
