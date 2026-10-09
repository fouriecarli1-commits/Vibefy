/**
 * A notice we were obliged to give, that reached nobody.
 *
 * `alerts.delivered_at` carries this comment in the schema that created it:
 * "Set once the alert has been delivered outside the console. Null means it has
 * only ever been visible to someone who happened to log in." The same migration
 * built `alerts_undelivered_idx on public.alerts (created_at) where delivered_at
 * is null` — an index whose only purpose is to answer "which alerts reached
 * nobody".
 *
 * Nothing had ever asked. Measured on 2026-10-09 against the test database: a
 * `critical` `badge_suspended` alert, for an organisation whose only member's
 * address had hard-bounced and who had no device registered, came out of both
 * sweeps with `attempted: 0`, no row in `alert_deliveries`, `delivered_at` null,
 * and not a line anywhere else. The Badge Licence obliges us to give that
 * notice. We did not give it, and nothing in the system said so.
 *
 * `email.ts` and `push.ts` each close the half of this they can see: when a
 * provider keeps refusing, the attempt is written down as a failure rather than
 * left as silence. Neither can see the case where there was no attempt to
 * record — a suppressed address with no handset behind it, an organisation whose
 * last member was deleted — because an alert in that state never appears in
 * either pending query at all.
 *
 * So this sweep asks the question the index was built for, and writes the answer
 * where it cannot later be revised: one `audit_log` row per alert, action
 * `alert.notice_not_given`, saying what the notice was and why nobody received
 * it. It sends nothing. The channels are what failed; adding a third would be
 * answering a different question.
 */
import type { PoolClient } from 'pg';

type Logger = (message: string, detail?: Record<string, unknown>) => void;
const noop: Logger = () => undefined;

interface Poolish {
  connect(): Promise<PoolClient>;
}

/**
 * How long before an undelivered notice is declared undelivered.
 *
 * Seven days, which is the width of both pending queries' windows. Up to six
 * days a retryable failure is deferred; between six and seven the two sweeps
 * write the attempt down as failed; past seven the alert has left both windows
 * and nothing will ever try again. That last moment is the honest one to say the
 * notice was not given, and saying it earlier would mean saying it about
 * something still being attempted.
 */
export const NOTICE_NOT_GIVEN_AFTER_DAYS = 7;

export interface NoticeSweepResult {
  /** Notices found undelivered past the window and recorded as such. */
  readonly recorded: number;
}

interface UndeliveredRow {
  alert_id: string;
  organisation_id: string;
  kind: string;
  severity: string;
  title: string;
  members: string;
  reachable_addresses: string;
  devices: string;
}

/**
 * Why nobody received it, in the words an operator needs.
 *
 * Three causes, and they want three different actions: find another way to
 * reach the customer, ask them to re-register a device, or look at why an
 * organisation has no members.
 */
function because(row: UndeliveredRow): string {
  const members = Number(row.members);
  const reachable = Number(row.reachable_addresses);
  const devices = Number(row.devices);

  if (members === 0) {
    return 'The organisation has no member we could write to, so there was no recipient at all.';
  }
  if (reachable === 0 && devices === 0) {
    return `Every address belonging to the ${members} member(s) of this organisation is suppressed, and no device is registered, so there was nowhere to send it.`;
  }
  if (reachable === 0) {
    return `Every address belonging to the ${members} member(s) is suppressed. ${devices} device(s) are registered and none of them accepted it.`;
  }
  return `${reachable} address(es) and ${devices} device(s) were available and the notice reached none of them. The delivery records for this alert say what each channel reported.`;
}

/**
 * Every alert past the window that somebody was entitled to receive outside the
 * console, and that reached nobody.
 *
 * The entitlement conditions are the same two the pending queries use, stated
 * here in the same SQL rather than re-derived in TypeScript — `push.ts` says
 * why: "Doing it in code would mean a second implementation of who is allowed to
 * know about this." One deliberate difference: the email branch does not
 * exclude a suppressed address. Being unable to write to somebody is the
 * failure this sweep exists to record, not a reason to leave it out.
 *
 * `info` alerts are absent because nothing was ever supposed to deliver them
 * outside the console, and reporting those would bury the ones that matter.
 */
export async function findUndeliveredNotices(
  client: PoolClient,
  days = NOTICE_NOT_GIVEN_AFTER_DAYS,
  limit = 200,
): Promise<UndeliveredRow[]> {
  const { rows } = await client.query<UndeliveredRow>(
    `select al.id as alert_id, al.organisation_id, al.kind::text as kind,
            al.severity::text as severity, al.title,
            (select count(*) from public.memberships m
               join public.users u on u.id = m.user_id
              where m.organisation_id = al.organisation_id and u.deleted_at is null) as members,
            (select count(*) from public.memberships m
               join public.users u on u.id = m.user_id
              where m.organisation_id = al.organisation_id and u.deleted_at is null
                and not exists (
                  select 1 from public.email_suppressions s where s.email = u.email
                )) as reachable_addresses,
            (select count(*) from public.memberships m
               join public.device_tokens dt on dt.user_id = m.user_id and dt.disabled_at is null
              where m.organisation_id = al.organisation_id) as devices
       from public.alerts al
      where al.delivered_at is null
        and al.created_at < now() - ($1 || ' days')::interval
        and (
          exists (
            select 1 from public.memberships m
              join public.users u on u.id = m.user_id
             where m.organisation_id = al.organisation_id
               and u.deleted_at is null
               and (
                 al.kind = 'badge_issued'
                 or (
                   (u.alert_email_level = 'all' or al.severity = 'critical')
                   and al.severity in ('warning', 'critical')
                 )
               )
          )
          or (
            al.severity in ('warning', 'critical')
            and exists (
              select 1 from public.memberships m
                join public.device_tokens dt on dt.user_id = m.user_id and dt.disabled_at is null
               where m.organisation_id = al.organisation_id
            )
          )
          -- An organisation with no members at all is the third case, and both
          -- conditions above are false for it. It belongs here: an alert nobody
          -- could have received is the clearest instance of a notice not given.
          or not exists (
            select 1 from public.memberships m where m.organisation_id = al.organisation_id
          )
        )
        and not exists (
          select 1 from public.audit_log l
           where l.entity_type = 'alert'
             and l.entity_id = al.id
             and l.action = 'alert.notice_not_given'
        )
      order by al.created_at
      limit $2`,
    [String(days), limit],
  );
  return rows;
}

export async function sweepUndeliveredNotices(
  pool: Poolish,
  log: Logger = noop,
  days = NOTICE_NOT_GIVEN_AFTER_DAYS,
): Promise<NoticeSweepResult> {
  const client = await pool.connect();
  try {
    const undelivered = await findUndeliveredNotices(client, days);
    let recorded = 0;
    for (const row of undelivered) {
      // One row at a time, each in its own statement. A single alert whose
      // write fails must not take the rest of the batch with it — this sweep
      // exists to make a silence audible, and dying halfway through would be a
      // new silence of its own.
      try {
        await client.query(
          `insert into public.audit_log
             (organisation_id, actor_id, actor_role, action, entity_type, entity_id, summary)
           values ($1, null, 'system', 'alert.notice_not_given', 'alert', $2, $3)`,
          [
            row.organisation_id,
            row.alert_id,
            `A ${row.severity} notice (${row.kind}) was not delivered outside the console within ` +
              `${days} days: "${row.title}". ${because(row)}`,
          ],
        );
        recorded += 1;
      } catch (error) {
        log('could not record an undelivered notice', {
          alertId: row.alert_id,
          error: String(error),
        });
      }
    }
    // Counted rather than logged line by line, for the same reason the email
    // sweep counts its deferrals: a provider outage or a deleted organisation
    // produces many identical sentences, and one number is the clearer account.
    if (recorded > 0) log('notices not given', { recorded });
    return { recorded };
  } finally {
    client.release();
  }
}
