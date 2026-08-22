/**
 * Carrying out what the schema promised.
 *
 * Three sweeps, all of them things the database has been recording the *intent*
 * of since M1 without anything acting on it: a spend ceiling, a retention
 * deadline, and a response deadline on a data-subject request.
 *
 * The pattern is the same as everywhere else in this worker — the decision is a
 * pure function in `@vibefy/governance`, this file is the part that talks to
 * Postgres, and every sweep is idempotent.
 */
import {
  deletionRecordFor,
  dueForDeletion,
  evaluateSpend,
  isOverdue,
  spendWindows,
  type RetainedRecord,
} from '@vibefy/governance';
import type { PoolClient } from 'pg';

type Logger = (message: string, detail?: Record<string, unknown>) => void;
const noop: Logger = () => undefined;

interface Poolish {
  connect(): Promise<PoolClient>;
}

// ---------------------------------------------------------------------------
// Spend
// ---------------------------------------------------------------------------

export interface SpendSweepResult {
  readonly todayUsd: number;
  readonly freeTierThisWeekUsd: number;
  readonly paused: boolean;
  readonly alerts: number;
}

/**
 * Applies the global daily ceiling.
 *
 * The pause is written to the database rather than held in this process,
 * because a ceiling that resets when the worker restarts is not a ceiling. The
 * partial unique index means two workers crossing the line at once produce one
 * pause, not two.
 */
export async function sweepSpendCap(
  pool: Poolish,
  log: Logger = noop,
  now: Date = new Date(),
): Promise<SpendSweepResult> {
  const client = await pool.connect();
  try {
    const { dayStart, weekStart } = spendWindows(now);
    const { rows } = await client.query<{ today: string; free_week: string; paused: boolean }>(
      `select public.spend_since($1)            as today,
              public.free_tier_spend_since($2)  as free_week,
              public.spending_is_paused()       as paused`,
      [dayStart.toISOString(), weekStart.toISOString()],
    );
    const row = rows[0]!;
    const observation = {
      todayUsd: Number(row.today),
      freeTierThisWeekUsd: Number(row.free_week),
      alreadyPaused: row.paused,
    };

    const actions = evaluateSpend(observation);
    let paused = observation.alreadyPaused;
    let alerts = 0;

    for (const action of actions) {
      if (action.kind === 'pause') {
        const inserted = await client.query(
          `insert into public.spend_pauses (reason, observed_usd, ceiling_usd)
           values ($1, $2, $3)
           on conflict do nothing
           returning id`,
          [action.reason, action.observedUsd, action.ceilingUsd],
        );
        if ((inserted.rowCount ?? 0) > 0) {
          paused = true;
          log('spending paused', { observed: action.observedUsd, ceiling: action.ceilingUsd });
        }
      } else if (action.kind === 'alert') {
        // Delivered to platform staff as an alert on every organisation they
        // administer would be noise, so it goes to the log and the cost
        // dashboard, which is where somebody looking at spend already is.
        alerts += 1;
        log('spend alert', { reason: action.reason });
      }
    }

    return { ...observation, paused, alerts };
  } finally {
    client.release();
  }
}

/** Read before claiming work. A paused platform starts nothing new. */
export async function spendingIsPaused(client: PoolClient): Promise<boolean> {
  const { rows } = await client.query<{ paused: boolean }>(
    'select public.spending_is_paused() as paused',
  );
  return rows[0]?.paused === true;
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export interface RetentionSweepResult {
  readonly evidenceDeleted: number;
  readonly alertsDeleted: number;
}

/**
 * Deletes what is past its deadline, and records that it did.
 *
 * The hash survives and the artefact does not. That is enough to show an
 * artefact existed and was removed on schedule, without keeping the thing the
 * schedule existed to remove — and it means a customer asking "did you actually
 * delete my screenshots" gets an answer rather than an assurance.
 */
export async function sweepRetention(
  pool: Poolish,
  log: Logger = noop,
  now: Date = new Date(),
  limit = 500,
): Promise<RetentionSweepResult> {
  const client = await pool.connect();
  const result = { evidenceDeleted: 0, alertsDeleted: 0 };
  try {
    const { rows } = await client.query<{
      id: string;
      organisation_id: string;
      sha256: string;
      retention_until: string;
    }>(
      `select id, organisation_id, sha256, retention_until
         from public.evidence
        where retention_until < $1
        order by retention_until
        limit $2`,
      [now.toISOString(), limit],
    );

    const records: RetainedRecord[] = rows.map((row) => ({
      id: row.id,
      dataClass: 'evidence',
      retentionUntil: new Date(row.retention_until),
      sha256: row.sha256,
      organisationId: row.organisation_id,
    }));

    for (const record of dueForDeletion(records, now)) {
      const deletion = deletionRecordFor(record);
      await client.query('begin');
      try {
        // The record of the deletion is written before the deletion, so a crash
        // between them leaves a record of something still present rather than a
        // deleted artefact nobody can account for.
        await client.query(
          `insert into public.retention_deletions
             (data_class, entity_id, organisation_id, sha256, retention_until)
           values ($1, $2, $3, $4, $5)`,
          [
            deletion.dataClass,
            deletion.entityId,
            deletion.organisationId,
            deletion.sha256,
            deletion.retentionUntil.toISOString(),
          ],
        );
        await client.query('delete from public.evidence where id = $1', [record.id]);
        await client.query('commit');
        result.evidenceDeleted += 1;
      } catch (error) {
        await client.query('rollback');
        log('retention deletion failed', {
          entityId: record.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Alerts are a record of what we told someone, kept a year. No hash: there
    // is no artefact, only a row.
    const alerts = await client.query(
      `delete from public.alerts where created_at < $1 returning id`,
      [new Date(now.getTime() - 365 * 86_400_000).toISOString()],
    );
    result.alertsDeleted = alerts.rowCount ?? 0;

    if (result.evidenceDeleted > 0 || result.alertsDeleted > 0) {
      log('retention sweep', { ...result });
    }
    return result;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------------

export interface DeadlineSweepResult {
  readonly overdueRequests: number;
  readonly overdueAppeals: number;
}

/**
 * Notices a deadline we published and are about to miss.
 *
 * It does not answer anything — a data-subject request and an appeal both need a
 * person. What it does is make missing one loud, because a thirty-day statutory
 * deadline that nobody is watching is the same as no deadline at all.
 */
export async function sweepGovernanceDeadlines(
  pool: Poolish,
  log: Logger = noop,
  now: Date = new Date(),
): Promise<DeadlineSweepResult> {
  const client = await pool.connect();
  try {
    const requests = await client.query<{ id: string; due_at: string; status: string }>(
      `select id, due_at, status::text as status from public.data_requests
        where status not in ('completed', 'refused')`,
    );
    const appeals = await client.query<{ id: string; due_at: string; status: string }>(
      `select id, due_at, status::text as status from public.appeals
        where status in ('open', 'under_review')`,
    );

    const overdueRequests = requests.rows.filter((row) =>
      isOverdue(new Date(row.due_at), row.status as never, now),
    );
    const overdueAppeals = appeals.rows.filter(
      (row) => new Date(row.due_at).getTime() < now.getTime(),
    );

    for (const row of overdueRequests) {
      log('data-subject request overdue', { requestId: row.id, dueAt: row.due_at });
    }
    for (const row of overdueAppeals) {
      log('appeal overdue', { appealId: row.id, dueAt: row.due_at });
    }

    return { overdueRequests: overdueRequests.length, overdueAppeals: overdueAppeals.length };
  } finally {
    client.release();
  }
}
