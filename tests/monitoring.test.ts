/**
 * Continuous monitoring, against the database.
 *
 * The pure rules are covered in drift.test.ts. What is tested here is the thing
 * that actually costs a customer something: that a material regression takes a
 * live badge down and says why in writing, that an unreachable application loses
 * its badge and gets it back, that a re-assessment is queued once and not
 * repeatedly, and that none of it can produce a wall of duplicate alerts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import {
  recordDriftFor,
  sweepBadgeExpiryWarnings,
  sweepDriftDetection,
  sweepLiveness,
  sweepScheduledReassessments,
} from '../apps/worker/src/monitoring.ts';
import { connect } from './setup/client.ts';
import {
  acceptBadgeLicence,
  approveAssessment,
  issueBadge,
  makeReviewer,
  seedAccount,
  seedApp,
  seedAssessment,
  seedAuthorisation,
  seedFinding,
  type SeededAccount,
} from './setup/seed.ts';

let db: Client;
let pool: Pool;
let reviewer: SeededAccount;

interface Workspace {
  readonly owner: SeededAccount;
  readonly appId: string;
  readonly authorisationId: string;
}

async function workspace(label: string): Promise<Workspace> {
  const owner = await seedAccount(db, label);
  const appId = await seedApp(db, owner, 'Kettle');
  const authorisationId = await seedAuthorisation(db, owner, appId);
  return { owner, appId, authorisationId };
}

/** One approved assessment on an existing application, with the findings given. */
async function assess(
  space: Workspace,
  options: {
    score: number;
    certificationEligible?: boolean;
    findings?: { ruleId: string; severity: string; dimension?: string; title: string }[];
    dimensions?: { dimension: string; score: number }[];
    rubricVersion?: string;
    assessedAt?: string;
  },
): Promise<string> {
  const seeded = await seedAssessment(db, space.owner, {
    appId: space.appId,
    authorisationId: space.authorisationId,
    depth: 'continuous',
    ...(options.rubricVersion ? { rubricVersion: options.rubricVersion } : {}),
  });
  for (const finding of options.findings ?? []) {
    await seedFinding(db, space.owner, seeded.assessmentId, finding);
  }
  await approveAssessment(db, space.owner, seeded.assessmentId, reviewer.userId, {
    certificationEligible: options.certificationEligible ?? true,
    score: options.score,
  });
  await db.query(
    `update public.assessments
        set dimension_scores = $2::jsonb,
            completed_at = coalesce($3::timestamptz, now())
      where id = $1`,
    [
      seeded.assessmentId,
      JSON.stringify(
        options.dimensions ?? [
          { dimension: 'security_posture', score: 80 },
          { dimension: 'data_privacy_practice', score: 78 },
        ],
      ),
      options.assessedAt ?? null,
    ],
  );
  return seeded.assessmentId;
}

async function liveBadge(space: Workspace, assessmentId: string): Promise<string> {
  const consentId = await acceptBadgeLicence(db, space.owner);
  const badgeId = await issueBadge(db, space.owner, {
    appId: space.appId,
    assessmentId,
    consentId,
  });
  await db.query('update public.apps set monitoring_enabled = true where id = $1', [space.appId]);
  return badgeId;
}

async function subscribe(space: Workspace, plan: string): Promise<void> {
  await db.query(
    `insert into public.subscriptions (organisation_id, plan, status, current_period_start, current_period_end)
     values ($1, $2::text::public.plan_tier, 'active', now(), now() + interval '30 days')`,
    [space.owner.organisationId, plan],
  );
}

/**
 * Points the sweeps at one application.
 *
 * The sweeps are deliberately global — they scan every monitored app — so
 * without this each test would be affected by the fixtures of the ones before
 * it. The queries under test are unchanged; only which apps are monitored is.
 */
async function isolate(space: Workspace): Promise<void> {
  await db.query('update public.apps set monitoring_enabled = (id = $1)', [space.appId]);
}

async function alertsFor(space: Workspace): Promise<{ kind: string; title: string; body: string }[]> {
  const { rows } = await db.query<{ kind: string; title: string; body: string }>(
    'select kind::text as kind, title, body from public.alerts where organisation_id = $1 order by created_at',
    [space.owner.organisationId],
  );
  return rows;
}

beforeAll(async () => {
  db = await connect();
  const dsn = new URL(process.env.VIBEFYCODE_TEST_DSN!);
  pool = new Pool({
    host: dsn.searchParams.get('host')!,
    database: dsn.pathname.slice(1),
    user: 'postgres',
  });
  reviewer = await seedAccount(db, 'monitoring-reviewer');
  await makeReviewer(db, reviewer.userId);
});

afterAll(async () => {
  await pool?.end();
  await db?.end();
});

describe('drift, recorded', () => {
  it('writes one comparison per assessment and never a second', async () => {
    const space = await workspace('drift-once');
    await assess(space, { score: 82, assessedAt: '2026-06-01T00:00:00Z' });
    const second = await assess(space, { score: 80, assessedAt: '2026-07-01T00:00:00Z' });

    const client = await pool.connect();
    try {
      const first = await recordDriftFor(client, second);
      expect(first).not.toBeNull();
      // The table is append-only, so a second attempt must be a no-op rather
      // than an error or an overwrite.
      expect(await recordDriftFor(client, second)).toBeNull();
    } finally {
      client.release();
    }

    const { rows } = await db.query(
      'select count(*)::int as n from public.drift_reports where assessment_id = $1',
      [second],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('does not compare a first assessment against anything', async () => {
    const space = await workspace('drift-first');
    const only = await assess(space, { score: 82 });
    const client = await pool.connect();
    try {
      expect(await recordDriftFor(client, only)).toBeNull();
    } finally {
      client.release();
    }
  });

  it('suspends a live badge on a material regression and records why', async () => {
    const space = await workspace('drift-regression');
    const first = await assess(space, {
      score: 84,
      dimensions: [
        { dimension: 'security_posture', score: 84 },
        { dimension: 'data_privacy_practice', score: 80 },
      ],
    });
    const badgeId = await liveBadge(space, first);

    await assess(space, {
      score: 55,
      certificationEligible: false,
      dimensions: [
        { dimension: 'security_posture', score: 40 },
        { dimension: 'data_privacy_practice', score: 80 },
      ],
      findings: [
        {
          ruleId: 'SEC-04',
          severity: 'critical',
          dimension: 'security_posture',
          title: 'Live API credential present in the client bundle',
        },
      ],
    });

    const recorded = await sweepDriftDetection(pool);
    expect(recorded).toBeGreaterThanOrEqual(1);

    const badge = await db.query<{ status: string; suspension_reason: string | null }>(
      'select status::text as status, suspension_reason from public.badges where id = $1',
      [badgeId],
    );
    expect(badge.rows[0]!.status).toBe('suspended');
    expect(badge.rows[0]!.suspension_reason ?? '').toMatch(/Material change/i);

    const drift = await db.query<{
      material_regression: boolean;
      regression_reasons: string[];
      certification_lost: boolean;
      findings_new: number;
    }>(
      `select material_regression, regression_reasons, certification_lost, findings_new
         from public.drift_reports where app_id = $1`,
      [space.appId],
    );
    expect(drift.rows[0]!.material_regression).toBe(true);
    expect(drift.rows[0]!.certification_lost).toBe(true);
    expect(drift.rows[0]!.findings_new).toBe(1);
    expect(drift.rows[0]!.regression_reasons.length).toBeGreaterThanOrEqual(3);

    const kinds = (await alertsFor(space)).map((alert) => alert.kind);
    expect(kinds).toContain('drift_detected');
    expect(kinds).toContain('material_regression');
    expect(kinds).toContain('badge_suspended');
  });

  it('leaves the badge alone when the application simply improved', async () => {
    const space = await workspace('drift-improved');
    const first = await assess(space, { score: 72 });
    const badgeId = await liveBadge(space, first);
    await assess(space, { score: 91 });

    await sweepDriftDetection(pool);

    const badge = await db.query<{ status: string }>(
      'select status::text as status from public.badges where id = $1',
      [badgeId],
    );
    expect(badge.rows[0]!.status).toBe('active');
    const kinds = (await alertsFor(space)).map((alert) => alert.kind);
    expect(kinds).toContain('drift_detected');
    expect(kinds).not.toContain('material_regression');
  });

  it('never suspends a badge because the rubric version changed', async () => {
    const space = await workspace('drift-rubric');
    const first = await assess(space, { score: 88 });
    const badgeId = await liveBadge(space, first);
    await assess(space, { score: 41, certificationEligible: false, rubricVersion: '9.9.9' });

    await sweepDriftDetection(pool);

    const badge = await db.query<{ status: string }>(
      'select status::text as status from public.badges where id = $1',
      [badgeId],
    );
    expect(badge.rows[0]!.status).toBe('active');
    const drift = await db.query<{ material_regression: boolean }>(
      'select material_regression from public.drift_reports where app_id = $1',
      [space.appId],
    );
    expect(drift.rows[0]!.material_regression).toBe(false);
  });

  it('refuses a drift report claiming a regression with no reason', async () => {
    // Belt and braces against the code path above: the constraint is what makes
    // "we suspended it and cannot say why" unrepresentable.
    const space = await workspace('drift-constraint');
    const first = await assess(space, { score: 80 });
    const second = await assess(space, { score: 60 });
    await expect(
      db.query(
        `insert into public.drift_reports
           (app_id, organisation_id, assessment_id, previous_assessment_id,
            score_before, score_after, score_delta, material_regression)
         values ($1, $2, $3, $4, 80, 60, -20, true)`,
        [space.appId, space.owner.organisationId, second, first],
      ),
    ).rejects.toThrow(/drift_regression_needs_reason/);
  });

  it('refuses to change a drift report once it is written', async () => {
    const space = await workspace('drift-append-only');
    await assess(space, { score: 80 });
    const second = await assess(space, { score: 60 });
    await sweepDriftDetection(pool);
    await expect(
      db.query('update public.drift_reports set material_regression = false where assessment_id = $1', [
        second,
      ]),
    ).rejects.toThrow();
  });
});

describe('alerts do not repeat themselves', () => {
  it('writes one alert per dedupe key however many times the sweep runs', async () => {
    const space = await workspace('alert-dedupe');
    await assess(space, { score: 80 });
    await assess(space, { score: 62 });

    await sweepDriftDetection(pool);
    await sweepDriftDetection(pool);
    await sweepDriftDetection(pool);

    const { rows } = await db.query<{ dedupe_key: string; n: number }>(
      `select dedupe_key, count(*)::int as n from public.alerts
        where organisation_id = $1 group by dedupe_key having count(*) > 1`,
      [space.owner.organisationId],
    );
    expect(rows).toEqual([]);
  });

  it('warns before a badge expires, once', async () => {
    const space = await workspace('alert-expiry');
    const assessmentId = await assess(space, { score: 80 });
    const consentId = await acceptBadgeLicence(db, space.owner);
    await issueBadge(db, space.owner, {
      appId: space.appId,
      assessmentId,
      consentId,
      expiresInMonths: 1,
    });
    await db.query(
      `update public.badges set expires_at = now() + interval '5 days' where app_id = $1`,
      [space.appId],
    );

    expect(await sweepBadgeExpiryWarnings(pool)).toBeGreaterThanOrEqual(1);
    expect(await sweepBadgeExpiryWarnings(pool)).toBe(0);

    const expiring = (await alertsFor(space)).filter((alert) => alert.kind === 'badge_expiring');
    expect(expiring).toHaveLength(1);
    expect(expiring[0]!.body).toMatch(/expires in 5 days/);
  });
});

describe('scheduled re-assessment', () => {
  it('queues a run when the cadence is up, and only one', async () => {
    const space = await workspace('schedule-due');
    await subscribe(space, 'certified');
    const assessmentId = await assess(space, { score: 80, assessedAt: '2026-06-01T00:00:00Z' });
    await liveBadge(space, assessmentId);
    await isolate(space);

    const now = new Date('2026-08-01T00:00:00Z');
    expect(await sweepScheduledReassessments(pool, undefined, now)).toBe(1);
    // The second sweep must find the in-flight request and leave it alone.
    expect(await sweepScheduledReassessments(pool, undefined, now)).toBe(0);

    const { rows } = await db.query<{ status: string; depth: string; requested_by: string | null }>(
      `select status::text as status, depth::text as depth, requested_by
         from public.assessment_requests where app_id = $1`,
      [space.appId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('queued');
    expect(rows[0]!.requested_by).toBeNull();
  });

  it('does not queue before the cadence is up', async () => {
    const space = await workspace('schedule-early');
    await subscribe(space, 'certified');
    const assessmentId = await assess(space, { score: 80, assessedAt: '2026-07-25T00:00:00Z' });
    await liveBadge(space, assessmentId);
    await isolate(space);
    expect(
      await sweepScheduledReassessments(pool, undefined, new Date('2026-08-01T00:00:00Z')),
    ).toBe(0);
  });

  it('never re-tests an application whose authorisation has been withdrawn', async () => {
    // The whole promise of the authorisation record is that it is checked every
    // time, not once at the start of the relationship.
    const space = await workspace('schedule-unauthorised');
    await subscribe(space, 'certified');
    const assessmentId = await assess(space, { score: 80, assessedAt: '2026-01-01T00:00:00Z' });
    await liveBadge(space, assessmentId);
    // Withdrawal is a new row, not an edit: the authorisations table is
    // append-only, so the history of who permitted what stays intact.
    await db.query(
      `insert into public.authorisations
         (app_id, organisation_id, supersedes_id, status, method, verification_target,
          scope_domains, warranty_text_version, warranty_text_sha256, granted_by, revocation_reason)
       select app_id, organisation_id, id, 'revoked', method, verification_target,
              '{}', warranty_text_version, warranty_text_sha256, granted_by,
              'Withdrawn by the owner for this test.'
         from public.authorisations where id = $1`,
      [space.authorisationId],
    );
    await isolate(space);
    expect(
      await sweepScheduledReassessments(pool, undefined, new Date('2026-08-01T00:00:00Z')),
    ).toBe(0);
  });

  it('does not monitor an application on a plan that does not include it', async () => {
    const space = await workspace('schedule-unpaid');
    const assessmentId = await assess(space, { score: 80, assessedAt: '2026-01-01T00:00:00Z' });
    await liveBadge(space, assessmentId);
    await isolate(space);
    expect(
      await sweepScheduledReassessments(pool, undefined, new Date('2026-08-01T00:00:00Z')),
    ).toBe(0);
  });
});

describe('liveness', () => {
  async function setUp(label: string): Promise<{ space: Workspace; badgeId: string }> {
    const space = await workspace(label);
    await subscribe(space, 'certified');
    const assessmentId = await assess(space, { score: 80 });
    const badgeId = await liveBadge(space, assessmentId);
    await isolate(space);
    return { space, badgeId };
  }

  it('suspends a badge after a run of failures, not on the first one', async () => {
    const { space, badgeId } = await setUp('liveness-down');
    const down = async () => ({ status: null, error: 'connect ETIMEDOUT' });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await sweepLiveness(pool, down, undefined, new Date(`2026-08-0${attempt}T00:00:00Z`));
      const badge = await db.query<{ status: string }>(
        'select status::text as status from public.badges where id = $1',
        [badgeId],
      );
      expect(badge.rows[0]!.status, `still active after ${attempt} failures`).toBe('active');
    }

    const result = await sweepLiveness(pool, down, undefined, new Date('2026-08-06T00:00:00Z'));
    expect(result.suspended).toBe(1);

    const badge = await db.query<{ status: string; suspension_reason: string }>(
      'select status::text as status, suspension_reason from public.badges where id = $1',
      [badgeId],
    );
    expect(badge.rows[0]!.status).toBe('suspended');
    expect(badge.rows[0]!.suspension_reason).toMatch(/did not respond to 6 consecutive checks/);

    const kinds = (await alertsFor(space)).map((alert) => alert.kind);
    expect(kinds).toContain('badge_suspended');
  });

  it('restores the badge when the application answers again', async () => {
    const { space, badgeId } = await setUp('liveness-recovered');
    const down = async () => ({ status: 503 });
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      await sweepLiveness(pool, down, undefined, new Date(`2026-08-0${attempt}T00:00:00Z`));
    }
    expect(
      (await db.query('select status::text as status from public.badges where id = $1', [badgeId]))
        .rows[0]!.status,
    ).toBe('suspended');

    const result = await sweepLiveness(
      pool,
      async () => ({ status: 200 }),
      undefined,
      new Date('2026-08-07T00:00:00Z'),
    );
    expect(result.restored).toBe(1);
    const badge = await db.query<{ status: string; suspension_reason: string | null }>(
      'select status::text as status, suspension_reason from public.badges where id = $1',
      [badgeId],
    );
    expect(badge.rows[0]!.status).toBe('active');
    expect(badge.rows[0]!.suspension_reason).toBeNull();
    expect((await alertsFor(space)).map((alert) => alert.kind)).toContain('application_recovered');
  });

  it('treats a 404 as alive — the origin answered', async () => {
    const { badgeId } = await setUp('liveness-404');
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      await sweepLiveness(
        pool,
        async () => ({ status: 404 }),
        undefined,
        new Date(`2026-08-0${attempt > 9 ? 9 : attempt}T00:00:00Z`),
      );
    }
    expect(
      (await db.query('select status::text as status from public.badges where id = $1', [badgeId]))
        .rows[0]!.status,
    ).toBe('active');
  });

  it('does not reinstate a badge a reviewer suspended on the merits', async () => {
    const { badgeId } = await setUp('liveness-not-mine');
    await db.query(
      `update public.badges
          set status = 'suspended', suspended_at = now(),
              suspension_reason = 'Suspended by a reviewer pending an investigation into the licence terms.'
        where id = $1`,
      [badgeId],
    );
    await sweepLiveness(
      pool,
      async () => ({ status: 200 }),
      undefined,
      new Date('2026-08-09T00:00:00Z'),
    );
    expect(
      (await db.query('select status::text as status from public.badges where id = $1', [badgeId]))
        .rows[0]!.status,
    ).toBe('suspended');
  });

  it('checks the certified origin and nothing else', async () => {
    const { space } = await setUp('liveness-scope');
    const seen: string[] = [];
    await sweepLiveness(
      pool,
      async (url) => {
        seen.push(url);
        return { status: 200 };
      },
      undefined,
      new Date('2026-08-10T00:00:00Z'),
    );
    const origin = await db.query<{ certified_origin: string }>(
      'select certified_origin from public.badges where app_id = $1',
      [space.appId],
    );
    expect(seen).toEqual([origin.rows[0]!.certified_origin]);
  });
});
