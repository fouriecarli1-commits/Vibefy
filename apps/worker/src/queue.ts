/**
 * Claiming and completing assessment requests.
 *
 * `FOR UPDATE SKIP LOCKED` is the whole mechanism: several workers can poll the
 * same table and each gets a different row, without a lock manager, a broker, or
 * a library. It is what pg-boss does underneath, done directly so the queue is a
 * table the customer can see rather than a library's private schema.
 */
import type { PoolClient } from 'pg';

export interface ClaimedRequest {
  readonly id: string;
  readonly appId: string;
  readonly organisationId: string;
  readonly requestedBy: string | null;
  readonly depth: 'limited' | 'full' | 'continuous';
  readonly maxRunCostUsd: number;
  readonly attempts: number;
}

/** Takes the oldest queued request, or returns null if there is nothing to do. */
export async function claimNextRequest(client: PoolClient): Promise<ClaimedRequest | null> {
  await client.query('begin');
  try {
    const { rows } = await client.query<{
      id: string;
      app_id: string;
      organisation_id: string;
      requested_by: string | null;
      depth: ClaimedRequest['depth'];
      max_run_cost_usd: string;
      attempts: number;
    }>(
      `select id, app_id, organisation_id, requested_by, depth, max_run_cost_usd, attempts
         from public.assessment_requests
        where status = 'queued'
        order by created_at
        for update skip locked
        limit 1`,
    );

    const row = rows[0];
    if (!row) {
      await client.query('commit');
      return null;
    }

    await client.query(
      `update public.assessment_requests
          set status = 'claimed', claimed_at = now(), attempts = attempts + 1
        where id = $1`,
      [row.id],
    );
    await client.query('commit');

    return {
      id: row.id,
      appId: row.app_id,
      organisationId: row.organisation_id,
      requestedBy: row.requested_by,
      depth: row.depth,
      maxRunCostUsd: Number(row.max_run_cost_usd),
      attempts: row.attempts + 1,
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

export async function completeRequest(
  client: PoolClient,
  requestId: string,
  assessmentId: string,
): Promise<void> {
  await client.query(
    `update public.assessment_requests
        set status = 'completed', assessment_id = $2, completed_at = now()
      where id = $1`,
    [requestId, assessmentId],
  );
}

/**
 * Postgres error classes a retry cannot fix.
 *
 * This exists because of a real incident. The first production run finished,
 * cost real money, and then failed to persist against a foreign key — a rubric
 * version that had never been published. That is a deterministic failure: the
 * constraint will be violated identically every time. The job was requeued
 * anyway, so the whole assessment was paid for three times to reach the same
 * error.
 *
 *   22 — data exception (a value that will not fit or will not parse)
 *   23 — integrity constraint violation (the one that bit us)
 *   42 — syntax error or access rule violation (our SQL is wrong)
 *
 * Everything else still retries. A dropped connection, a deadlock, a
 * serialisation failure are all worth another attempt, and a deny-list keeps
 * them retryable rather than an allow-list quietly making them permanent.
 */
const UNRETRYABLE_SQLSTATE_CLASSES = ['22', '23', '42'];

/** Whether another attempt could plausibly end differently. */
export function isRetryableFailure(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return true;
  return !UNRETRYABLE_SQLSTATE_CLASSES.includes(code.slice(0, 2));
}

/**
 * A failed request goes back to the queue unless it has run out of attempts, or
 * unless the failure is one a retry cannot fix — an unauthorised target does not
 * become authorised by trying again, and retrying it would be attempting to test
 * something we are not permitted to test, twice.
 */
export async function failRequest(
  client: PoolClient,
  requestId: string,
  error: string,
  options: { retryable: boolean; maxAttempts?: number } = { retryable: true },
): Promise<'requeued' | 'failed'> {
  const maxAttempts = options.maxAttempts ?? 3;
  const { rows } = await client.query<{ attempts: number }>(
    'select attempts from public.assessment_requests where id = $1',
    [requestId],
  );
  const attempts = rows[0]?.attempts ?? maxAttempts;
  const requeue = options.retryable && attempts < maxAttempts;

  await client.query(
    `update public.assessment_requests
        set status = $2::text::public.request_status,
            last_error = $3,
            completed_at = case when $2::text = 'failed' then now() else null end,
            claimed_at = case when $2::text = 'queued' then null else claimed_at end
      where id = $1`,
    [requestId, requeue ? 'queued' : 'failed', error.slice(0, 2000)],
  );

  return requeue ? 'requeued' : 'failed';
}
