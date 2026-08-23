/**
 * Continuous monitoring: the sweeps.
 *
 * Four things happen here, all as sweeps over database state rather than as
 * messages between processes. The reason is the same one that made report
 * generation a sweep: a re-assessment that was supposed to be scheduled by a
 * cron entry nobody checked is indistinguishable, from the customer's side,
 * from a monitoring product that quietly stopped working.
 *
 *   1. Due re-assessments are queued.
 *   2. Finished assessments are compared against the one before them, and the
 *      comparison is written to the append-only `drift_reports` table.
 *   3. A material regression suspends the badge and tells the owner why.
 *   4. Applications that stop answering lose their badge, and get it back when
 *      they answer again.
 *
 * None of the decisions live in this file. They live in `@vibefycode/monitoring`,
 * which has no database access, so they can be tested exhaustively and quoted
 * back verbatim in an appeal.
 */
import {
  applyProbe,
  assessMateriality,
  badgeExpiringAlert,
  badgeSuspendedAlert,
  cadenceFor,
  computeDrift,
  driftAlert,
  isReassessmentDue,
  recoveredAlert,
  regressionAlert,
  unreachableAlert,
  type AlertDraft,
  type AssessmentSnapshot,
  type ComparableDimension,
  type ComparableFinding,
  type MonitoredPlan,
} from '@vibefycode/monitoring';
import { entitlementFor } from '@vibefycode/billing';
import type { PoolClient } from 'pg';

type Logger = (message: string, detail?: Record<string, unknown>) => void;
const noop: Logger = () => undefined;

interface Poolish {
  connect(): Promise<PoolClient>;
}

/** A liveness check is one GET to the certified origin. Injectable so tests never touch a network. */
export type LivenessProbeFn = (
  url: string,
) => Promise<{ status: number | null; error?: string | undefined }>;

export const LIVENESS_TIMEOUT_MS = 10_000;

export const httpLivenessProbe: LivenessProbeFn = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVENESS_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'VibefyCodeMonitor/1.0 (+https://vibefycode.app/methodology)' },
    });
    return { status: response.status };
  } catch (error) {
    return { status: null, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
};

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

/**
 * Writes an alert, or does nothing if the same one already exists.
 *
 * `on conflict do nothing` against the unique dedupe index is the whole
 * mechanism — the sweeps are free to run as often as they like and to recompute
 * whatever they like, because a duplicate alert cannot be written.
 */
export async function raiseAlert(
  client: PoolClient,
  organisationId: string,
  draft: AlertDraft,
  links: { driftReportId?: string | undefined } = {},
): Promise<boolean> {
  const { rowCount } = await client.query(
    `insert into public.alerts
       (organisation_id, app_id, kind, severity, title, body, assessment_id, drift_report_id, badge_id, dedupe_key)
     values ($1, $2, $3::text::public.alert_kind, $4::text::public.alert_severity, $5, $6, $7, $8, $9, $10)
     on conflict (organisation_id, dedupe_key) do nothing`,
    [
      organisationId,
      draft.appId,
      draft.kind,
      draft.severity,
      draft.title,
      draft.body,
      draft.assessmentId ?? null,
      links.driftReportId ?? null,
      draft.badgeId ?? null,
      draft.dedupeKey,
    ],
  );
  return (rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

interface AssessmentRow {
  id: string;
  app_id: string;
  organisation_id: string;
  rubric_version: string;
  overall_score: string | null;
  certification_eligible: boolean;
  dimension_scores: { dimension: string; score: number }[] | null;
  assessed_at: string;
}

const SNAPSHOT_SELECT = `select a.id, a.app_id, a.organisation_id, a.rubric_version, a.overall_score,
                                a.certification_eligible, a.dimension_scores,
                                coalesce(a.completed_at, a.created_at) as assessed_at
                           from public.assessments a`;

async function findingsFor(client: PoolClient, assessmentId: string): Promise<ComparableFinding[]> {
  const { rows } = await client.query<{
    rubric_rule_id: string;
    dimension: ComparableFinding['dimension'];
    severity: ComparableFinding['severity'];
    title: string;
    is_published: boolean;
  }>(
    `select rubric_rule_id, dimension, severity, title, is_published
       from public.findings where assessment_id = $1`,
    [assessmentId],
  );
  return rows.map((row) => ({
    ruleId: row.rubric_rule_id,
    dimension: row.dimension,
    severity: row.severity,
    title: row.title,
    isPublished: row.is_published,
  }));
}

function toSnapshot(row: AssessmentRow, findings: ComparableFinding[]): AssessmentSnapshot {
  const dimensions: ComparableDimension[] = (row.dimension_scores ?? []).map((entry) => ({
    dimension: entry.dimension as ComparableDimension['dimension'],
    score: Number(entry.score),
  }));
  return {
    assessmentId: row.id,
    assessedAt: new Date(row.assessed_at),
    rubricVersion: row.rubric_version,
    overallScore: Number(row.overall_score ?? 0),
    certificationEligible: row.certification_eligible,
    dimensions,
    findings,
  };
}

export async function snapshotFor(
  client: PoolClient,
  assessmentId: string,
): Promise<(AssessmentSnapshot & { appId: string; organisationId: string }) | null> {
  const { rows } = await client.query<AssessmentRow>(`${SNAPSHOT_SELECT} where a.id = $1`, [
    assessmentId,
  ]);
  const row = rows[0];
  if (!row) return null;
  const snapshot = toSnapshot(row, await findingsFor(client, assessmentId));
  return { ...snapshot, appId: row.app_id, organisationId: row.organisation_id };
}

/** The assessment immediately before this one, on the same application, that a customer actually saw. */
export async function previousSnapshotFor(
  client: PoolClient,
  appId: string,
  before: { assessmentId: string; assessedAt: Date },
): Promise<AssessmentSnapshot | null> {
  const { rows } = await client.query<AssessmentRow>(
    `${SNAPSHOT_SELECT}
      where a.app_id = $1
        and a.id <> $2
        and a.status in ('approved', 'published')
        and a.overall_score is not null
        and coalesce(a.completed_at, a.created_at) < $3
      order by coalesce(a.completed_at, a.created_at) desc
      limit 1`,
    [appId, before.assessmentId, before.assessedAt.toISOString()],
  );
  const row = rows[0];
  if (!row) return null;
  return toSnapshot(row, await findingsFor(client, row.id));
}

// ---------------------------------------------------------------------------
// Sweep 1 — comparing a finished assessment against the one before it
// ---------------------------------------------------------------------------

export interface DriftOutcome {
  readonly assessmentId: string;
  readonly driftReportId: string;
  readonly materialRegression: boolean;
  readonly badgeSuspended: boolean;
}

/**
 * Compares one assessment and records the result.
 *
 * Everything happens in one transaction: the drift report, the alerts and the
 * suspension are one decision, and a crash between them would leave a badge down
 * with no record of why — the exact thing the append-only table exists to
 * prevent.
 */
export async function recordDriftFor(
  client: PoolClient,
  assessmentId: string,
  log: Logger = noop,
): Promise<DriftOutcome | null> {
  const current = await snapshotFor(client, assessmentId);
  if (!current) return null;

  const previous = await previousSnapshotFor(client, current.appId, {
    assessmentId: current.assessmentId,
    assessedAt: current.assessedAt,
  });
  // A first assessment has nothing to drift from. That is not a failure and it
  // is not retried forever: the sweep only looks at apps with a prior result.
  if (!previous) return null;

  const drift = computeDrift(previous, current);
  const verdict = assessMateriality(drift);

  const { rows: appRows } = await client.query<{ name: string }>(
    'select name from public.apps where id = $1',
    [current.appId],
  );
  const appName = appRows[0]?.name ?? 'Your application';

  await client.query('begin');
  try {
    const { rows } = await client.query<{ id: string }>(
      `insert into public.drift_reports
         (app_id, organisation_id, assessment_id, previous_assessment_id,
          score_before, score_after, score_delta, dimension_deltas,
          findings_new, findings_resolved, findings_persisting,
          new_finding_titles, resolved_finding_titles,
          material_regression, regression_reasons, certification_lost)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16)
       on conflict (assessment_id) do nothing
       returning id`,
      [
        current.appId,
        current.organisationId,
        drift.assessmentId,
        drift.previousAssessmentId,
        drift.scoreBefore,
        drift.scoreAfter,
        drift.scoreDelta,
        JSON.stringify(drift.dimensionDeltas),
        drift.newFindings.length,
        drift.resolvedFindings.length,
        drift.persistingFindings.length,
        drift.newFindings.map((finding) => finding.title),
        drift.resolvedFindings.map((finding) => finding.title),
        verdict.material,
        verdict.reasons.map((reason) => reason.explanation),
        drift.certificationLost,
      ],
    );

    const driftReportId = rows[0]?.id;
    if (!driftReportId) {
      // Another worker got there first. The table is append-only, so there is
      // nothing to reconcile — the first writer's report is the report.
      await client.query('commit');
      return null;
    }

    await raiseAlert(client, current.organisationId, driftAlert(appName, current.appId, drift), {
      driftReportId,
    });

    let badgeSuspended = false;
    if (verdict.material) {
      await raiseAlert(
        client,
        current.organisationId,
        regressionAlert(appName, current.appId, drift, verdict),
        { driftReportId },
      );
    }

    if (verdict.suspendBadge) {
      const suspended = await client.query<{ id: string }>(
        `update public.badges
            set status = 'suspended', suspended_at = now(),
                suspension_reason = $2
          where app_id = $1 and status = 'active'
          returning id`,
        [
          current.appId,
          `Material change found at re-assessment on ${current.assessedAt.toISOString().slice(0, 10)}.`,
        ],
      );
      for (const badge of suspended.rows) {
        badgeSuspended = true;
        await raiseAlert(
          client,
          current.organisationId,
          badgeSuspendedAlert(
            appName,
            current.appId,
            badge.id,
            verdict.reasons[0]?.explanation ?? 'A material change was found at re-assessment.',
          ),
          { driftReportId },
        );
      }
    }

    await client.query('commit');
    log('drift recorded', {
      assessmentId,
      driftReportId,
      scoreDelta: drift.scoreDelta,
      material: verdict.material,
      badgeSuspended,
    });
    return {
      assessmentId,
      driftReportId,
      materialRegression: verdict.material,
      badgeSuspended,
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

/** Every reviewed assessment that has a predecessor and no comparison yet. */
export async function sweepDriftDetection(
  pool: Poolish,
  log: Logger = noop,
  limit = 20,
): Promise<number> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      `select a.id
         from public.assessments a
        where a.status in ('approved', 'published')
          and a.overall_score is not null
          and not exists (select 1 from public.drift_reports d where d.assessment_id = a.id)
          and exists (
            select 1 from public.assessments prior
             where prior.app_id = a.app_id
               and prior.id <> a.id
               and prior.status in ('approved', 'published')
               and prior.overall_score is not null
               and coalesce(prior.completed_at, prior.created_at)
                   < coalesce(a.completed_at, a.created_at)
          )
        order by coalesce(a.completed_at, a.created_at)
        limit $1`,
      [limit],
    );

    let recorded = 0;
    for (const row of rows) {
      try {
        if (await recordDriftFor(client, row.id, log)) recorded += 1;
      } catch (error) {
        log('drift detection failed', {
          assessmentId: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return recorded;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Sweep 2 — queueing due re-assessments
// ---------------------------------------------------------------------------

interface MonitoredAppRow {
  app_id: string;
  organisation_id: string;
  name: string;
  primary_url: string;
  plan: MonitoredPlan | null;
  last_assessed_at: string | null;
}

/**
 * Queues a re-assessment for every monitored application whose cadence is up.
 *
 * Two conditions are checked in SQL rather than in code, because getting either
 * wrong costs real money or breaks a promise: the application must still have a
 * live authorisation to test, and there must not already be a request in flight
 * for it.
 */
export async function sweepScheduledReassessments(
  pool: Poolish,
  log: Logger = noop,
  now: Date = new Date(),
  limit = 20,
): Promise<number> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<MonitoredAppRow>(
      `select app.id            as app_id,
              app.organisation_id,
              app.name,
              app.primary_url,
              sub.plan::text    as plan,
              greatest(
                coalesce(app.last_reassessed_at, to_timestamp(0)),
                coalesce(last_assessment.assessed_at, to_timestamp(0))
              )                 as last_assessed_at
         from public.apps app
         join lateral (
           select s.plan::text as plan
             from public.subscriptions s
            where s.organisation_id = app.organisation_id
              and s.status in ('active', 'trialing')
            order by case s.status when 'active' then 0 else 1 end
            limit 1
         ) sub on true
         left join lateral (
           select coalesce(a.completed_at, a.created_at) as assessed_at
             from public.assessments a
            where a.app_id = app.id and a.status in ('approved', 'published')
            order by coalesce(a.completed_at, a.created_at) desc
            limit 1
         ) last_assessment on true
        where app.monitoring_enabled
          -- Never re-test something we are no longer permitted to test.
          and public.app_is_authorised_for_testing(app.id)
          and not exists (
            select 1 from public.assessment_requests r
             where r.app_id = app.id and r.status in ('queued', 'claimed')
          )
        limit $1`,
      [limit],
    );

    let queued = 0;
    for (const row of rows) {
      const plan = row.plan;
      if (!plan) continue;
      const lastAssessedAt =
        row.last_assessed_at && new Date(row.last_assessed_at).getTime() > 0
          ? new Date(row.last_assessed_at)
          : null;
      if (!isReassessmentDue(plan, lastAssessedAt, now)) continue;

      const cadence = cadenceFor(plan);
      if (cadence.reassessEveryDays === null) continue;

      try {
        // `last_reassessed_at` is stamped in the same transaction as the insert,
        // so a request that fails to run still counts as scheduled. Otherwise a
        // permanently failing application would be re-queued every sweep for ever.
        await client.query('begin');
        await client.query(
          `insert into public.assessment_requests
             (app_id, organisation_id, requested_by, depth, plan_at_request, max_run_cost_usd)
           values ($1, $2, null, 'continuous', $3::text::public.plan_tier, $4)`,
          [row.app_id, row.organisation_id, plan, entitlementFor(plan).maxRunCostUsd],
        );
        await client.query('update public.apps set last_reassessed_at = now() where id = $1', [
          row.app_id,
        ]);
        await client.query('commit');
        queued += 1;
        log('re-assessment queued', { appId: row.app_id, plan });
      } catch (error) {
        await client.query('rollback');
        log('re-assessment scheduling failed', {
          appId: row.app_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return queued;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Sweep 3 — liveness
// ---------------------------------------------------------------------------

export interface LivenessSweepResult {
  readonly checked: number;
  readonly down: number;
  readonly suspended: number;
  readonly restored: number;
}

/**
 * Pings every monitored application with a live badge.
 *
 * The URL checked is the badge's `certified_origin` — the exact origin the badge
 * asserts, which is also the origin the authorisation covers. Checking anything
 * else would be testing a target the customer did not authorise.
 */
export async function sweepLiveness(
  pool: Poolish,
  probe: LivenessProbeFn = httpLivenessProbe,
  log: Logger = noop,
  now: Date = new Date(),
  limit = 50,
): Promise<LivenessSweepResult> {
  const client = await pool.connect();
  const result = { checked: 0, down: 0, suspended: 0, restored: 0 };
  try {
    const { rows } = await client.query<{
      app_id: string;
      organisation_id: string;
      name: string;
      certified_origin: string;
      badge_id: string;
      badge_status: 'active' | 'suspended' | 'expired' | 'revoked';
      consecutive_liveness_failures: number;
      plan: MonitoredPlan | null;
      last_checked_minutes: number | null;
    }>(
      `select app.id as app_id,
              app.organisation_id,
              app.name,
              b.certified_origin,
              b.id as badge_id,
              b.status::text as badge_status,
              app.consecutive_liveness_failures,
              sub.plan::text as plan,
              extract(epoch from (now() - app.last_seen_at)) / 60 as last_checked_minutes
         from public.apps app
         join public.badges b on b.app_id = app.id and b.status in ('active', 'suspended')
         left join lateral (
           select s.plan::text as plan from public.subscriptions s
            where s.organisation_id = app.organisation_id and s.status in ('active', 'trialing')
            limit 1
         ) sub on true
        where app.monitoring_enabled
        limit $1`,
      [limit],
    );

    for (const row of rows) {
      const plan = row.plan;
      if (!plan) continue;
      const cadence = cadenceFor(plan);
      if (cadence.livenessEveryMinutes === null) continue;
      if (
        row.last_checked_minutes !== null &&
        Number(row.last_checked_minutes) < cadence.livenessEveryMinutes
      ) {
        continue;
      }

      const outcome = await probe(row.certified_origin);
      result.checked += 1;

      const decision = applyProbe(
        {
          consecutiveFailures: row.consecutive_liveness_failures,
          badgeStatus: row.badge_status,
        },
        outcome,
        cadence.livenessFailuresBeforeSuspension,
      );

      await client.query('begin');
      try {
        await client.query(
          `update public.apps
              set consecutive_liveness_failures = $2,
                  last_liveness_status = $3,
                  last_seen_at = case when $4 then now() else last_seen_at end
            where id = $1`,
          [row.app_id, decision.consecutiveFailures, outcome.status, decision.outcome === 'up'],
        );

        if (decision.outcome === 'down') {
          result.down += 1;
          if (decision.reason) {
            await raiseAlert(
              client,
              row.organisation_id,
              unreachableAlert(row.name, row.app_id, decision, now),
            );
          }
        }

        if (decision.suspendBadge) {
          await client.query(
            `update public.badges
                set status = 'suspended', suspended_at = now(), suspension_reason = $2
              where id = $1 and status = 'active'`,
            [
              row.badge_id,
              decision.reason ?? 'The application stopped responding to liveness checks.',
            ],
          );
          result.suspended += 1;
          await raiseAlert(
            client,
            row.organisation_id,
            badgeSuspendedAlert(
              row.name,
              row.app_id,
              row.badge_id,
              decision.reason ?? 'The application stopped responding to liveness checks.',
            ),
          );
        }

        if (decision.restoreBadge) {
          // Only reverses a suspension this sweep caused: the where clause matches
          // on the reason text we wrote, so a regression or licence suspension is
          // left exactly where the human who made it put it.
          const restored = await client.query(
            `update public.badges
                set status = 'active', suspended_at = null, suspension_reason = null
              where id = $1 and status = 'suspended'
                and suspension_reason like 'The application did not respond%'
              returning id`,
            [row.badge_id],
          );
          if ((restored.rowCount ?? 0) > 0) {
            result.restored += 1;
            await raiseAlert(client, row.organisation_id, recoveredAlert(row.name, row.app_id, now));
          }
        }

        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        log('liveness update failed', {
          appId: row.app_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (result.checked > 0) log('liveness sweep', { ...result });
    return result;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Sweep 4 — telling people before the badge expires, not after
// ---------------------------------------------------------------------------

export const EXPIRY_WARNING_DAYS = [30, 7] as const;

export async function sweepBadgeExpiryWarnings(
  pool: Poolish,
  log: Logger = noop,
  now: Date = new Date(),
): Promise<number> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{
      badge_id: string;
      app_id: string;
      organisation_id: string;
      name: string;
      expires_at: string;
      days_remaining: number;
    }>(
      `select b.id as badge_id, b.app_id, b.organisation_id, app.name, b.expires_at,
              ceil(extract(epoch from (b.expires_at - now())) / 86400)::int as days_remaining
         from public.badges b
         join public.apps app on app.id = b.app_id
        where b.status = 'active'
          and b.expires_at > now()
          and b.expires_at <= now() + interval '30 days'`,
    );

    let raised = 0;
    for (const row of rows) {
      const days = Math.max(1, row.days_remaining);
      const draft = badgeExpiringAlert(
        row.name,
        row.app_id,
        row.badge_id,
        new Date(row.expires_at),
        days,
      );
      if (await raiseAlert(client, row.organisation_id, draft)) raised += 1;
    }
    if (raised > 0) log('badge expiry warnings raised', { raised });
    return raised;
  } finally {
    client.release();
  }
}
