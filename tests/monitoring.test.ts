/**
 * Continuous monitoring, against the database.
 *
 * The pure rules are covered in drift.test.ts. What is tested here is the thing
 * that actually costs a customer something: that a material regression takes a
 * live badge down and says why in writing, that an unreachable application loses
 * its badge and gets it back, that a re-assessment is queued once and not
 * repeatedly, and that none of it can produce a wall of duplicate alerts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import {
  recordDriftFor,
  sweepBadgeExpiryWarnings,
  sweepSupersededRubric,
  sweepDriftDetection,
  sweepLiveness,
  sweepScheduledReassessments,
  httpLivenessProbe,
  livenessPolicy,
} from '../apps/worker/src/monitoring.ts';
import { isReassessmentDue } from '../packages/monitoring/src/index.ts';
import { CURRENT_RUBRIC_VERSION } from '../packages/rubric/src/rubric.ts';
import { KIND_LABEL } from '../apps/web/lib/alert-kinds.ts';
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

/**
 * Turns monitoring on without issuing a badge.
 *
 * The re-assessment sweep does not look at badges at all — it needs monitoring
 * on, a live authorisation, a plan with a cadence and something already
 * assessed. Saying so here keeps these tests honest about what they depend on,
 * and keeps them from littering a shared test database with badges that the
 * badge sweeps in other files then have to wade through.
 */
async function monitor(space: Workspace): Promise<void> {
  await db.query('update public.apps set monitoring_enabled = true where id = $1', [space.appId]);
}

/** The same as `isolate`, for a test that needs more monitored applications than the sweep's limit. */
async function isolateAll(spaces: readonly Workspace[]): Promise<void> {
  await db.query('update public.apps set monitoring_enabled = (id = any($1::uuid[]))', [
    spaces.map((space) => space.appId),
  ]);
}

async function alertsFor(
  space: Workspace,
): Promise<{ kind: string; title: string; body: string }[]> {
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
      db.query(
        'update public.drift_reports set material_regression = false where assessment_id = $1',
        [second],
      ),
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

describe('when the standard moves on', () => {
  // A score is never retroactively altered by a rubric revision — the database
  // refuses to edit a published version — so a badge earned against v1.0.0 stays
  // valid on v1.0.0 terms. Correct, and it means a customer can be carrying a
  // live mark measured against a standard nobody uses any more.
  //
  // Both halves of the answer were already in the database. Nobody had asked
  // them together.
  //
  // This used to supersede 1.0.0 by hand before checking the sweep, which is a
  // fair test of the sweep and no test at all of whether the condition it
  // depends on ever arises. It did not: publishing 1.1.0 left 1.0.0 looking
  // current, `superseded_at` was null on every row in the database, and the
  // sweep — whose condition is `superseded_at is not null` — had never once
  // fired in its life while reporting zero notices raised and looking healthy.
  // So the fixture is gone and these run against the real state.

  it('says nothing about a badge earned against the version in force', async () => {
    const space = await workspace('rubric-current');
    const assessmentId = await assess(space, { score: 80, rubricVersion: CURRENT_RUBRIC_VERSION });
    const consentId = await acceptBadgeLicence(db, space.owner);
    await issueBadge(db, space.owner, { appId: space.appId, assessmentId, consentId });

    await sweepSupersededRubric(pool);
    expect((await alertsFor(space)).map((alert) => alert.kind)).not.toContain('rubric_superseded');
  });

  it('tells a badge holder their rubric version was superseded, once', async () => {
    // Earned against 1.0.0, which the migrations mark superseded because the
    // engine stopped scoring against it — the production condition, not one
    // this test arranged for itself.
    const space = await workspace('rubric-superseded');
    const assessmentId = await assess(space, { score: 80, rubricVersion: '1.0.0' });
    const consentId = await acceptBadgeLicence(db, space.owner);
    await issueBadge(db, space.owner, { appId: space.appId, assessmentId, consentId });

    expect(await sweepSupersededRubric(pool)).toBeGreaterThanOrEqual(1);
    expect(await sweepSupersededRubric(pool)).toBe(0);

    const raised = (await alertsFor(space)).filter((alert) => alert.kind === 'rubric_superseded');
    expect(raised).toHaveLength(1);
    expect(raised[0]!.body).toMatch(/earned its badge against Rubric v1\.0\.0/);
    expect(raised[0]!.body).toContain(`v${CURRENT_RUBRIC_VERSION} is now in force`);
  });

  it('raises nothing while the database and the engine disagree about what is current', async () => {
    // The window that opens every time a rubric is published: the migration
    // that inserts the new version and the deploy that teaches the engine to
    // score against it are two acts on two machines. Whichever lands first, a
    // notice sent in between names a successor that nothing is scoring against
    // yet — a false statement to a paying customer about their own badge.
    const space = await workspace('rubric-disagree');
    const assessmentId = await assess(space, { score: 80, rubricVersion: '1.0.0' });
    const consentId = await acceptBadgeLicence(db, space.owner);
    await issueBadge(db, space.owner, { appId: space.appId, assessmentId, consentId });

    const ahead = '99.0.0';
    await db.query(
      `insert into public.rubric_versions
         (version, definition, checksum, changelog, published_at, effective_from)
       values ($1, '{}'::jsonb, repeat('a', 64), 'Published ahead of the deploy.', now(), now())
       on conflict (version) do nothing`,
      [ahead],
    );
    try {
      const said: string[] = [];
      expect(await sweepSupersededRubric(pool, (message) => said.push(message))).toBe(0);
      expect(said.join(' ')).toMatch(/disagreement/i);
      expect((await alertsFor(space)).map((alert) => alert.kind)).not.toContain(
        'rubric_superseded',
      );
    } finally {
      // Put back, because every other file shares this database and the version
      // in force is a fact about all of them.
      await db.query('delete from public.rubric_versions where version = $1', [ahead]);
    }
  });

  it('says plainly that the badge is unaffected', () => {
    // The notice must not read as a suspension. A customer who thinks their
    // badge just stopped working will pull it off their site, and they would be
    // wrong to — nothing about the assessment they hold has changed.
    const alerts = readFileSync(join(process.cwd(), 'packages/monitoring/src/alerts.ts'), 'utf8');
    const draft = alerts.slice(alerts.indexOf('export function rubricSupersededAlert'));
    expect(draft).toContain('The badge is unaffected');
    expect(draft).toContain('never changed after the fact');
  });

  it('sells nothing', () => {
    // Monitoring is the half of this product whose independence has to be beyond
    // question. A signal that arrives bundled with an offer is a signal somebody
    // can reasonably suspect was generated in order to make the offer — which is
    // the objection the whole independence policy exists to answer.
    const alerts = readFileSync(join(process.cwd(), 'packages/monitoring/src/alerts.ts'), 'utf8');
    const from = alerts.indexOf('export function rubricSupersededAlert');
    const draft = alerts.slice(from, alerts.indexOf('export function', from + 1));
    for (const pitch of [
      'we can',
      'our team',
      'upgrade service',
      'let us fix',
      'buy ',
      'discount',
    ]) {
      expect(draft.toLowerCase(), `the notice pitches: ${pitch}`).not.toContain(pitch);
    }
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

  it('reaches the due application even when the page is full of ones that are not', async () => {
    // The sweep reads a page of applications, not all of them. If that page is
    // unordered, the due one can sit behind a crowd of not-due ones for ever —
    // and every sweep reports "0 queued" and looks perfectly healthy. So: more
    // monitored applications than the limit, exactly one of them due.
    const crowd: Workspace[] = [];
    for (let index = 0; index < 4; index += 1) {
      const space = await workspace(`schedule-crowd-${index}`);
      await subscribe(space, 'certified');
      await assess(space, { score: 80, assessedAt: '2026-07-31T00:00:00Z' });
      await monitor(space);
      crowd.push(space);
    }
    const due = await workspace('schedule-crowd-due');
    await subscribe(due, 'certified');
    await assess(due, { score: 80, assessedAt: '2026-01-01T00:00:00Z' });
    await monitor(due);
    await isolateAll([...crowd, due]);

    const now = new Date('2026-08-01T00:00:00Z');
    expect(await sweepScheduledReassessments(pool, undefined, now, 1)).toBe(1);

    const { rows } = await db.query<{ app_id: string }>(
      'select app_id from public.assessment_requests where app_id = any($1::uuid[])',
      [[...crowd.map((space) => space.appId), due.appId]],
    );
    expect(rows.map((row) => row.app_id)).toEqual([due.appId]);
  });

  it('takes the most overdue first', async () => {
    // Which one gets the single slot is not arbitrary: the one that has waited
    // longest. Otherwise a busy account starves the customer who has been owed
    // a re-assessment since January.
    const recent = await workspace('schedule-order-recent');
    await subscribe(recent, 'certified');
    await assess(recent, { score: 80, assessedAt: '2026-06-20T00:00:00Z' });
    await monitor(recent);
    const ancient = await workspace('schedule-order-ancient');
    await subscribe(ancient, 'certified');
    await assess(ancient, { score: 80, assessedAt: '2026-02-01T00:00:00Z' });
    await monitor(ancient);
    await isolateAll([recent, ancient]);

    expect(
      await sweepScheduledReassessments(pool, undefined, new Date('2026-08-01T00:00:00Z'), 1),
    ).toBe(1);
    const { rows } = await db.query<{ app_id: string }>(
      'select app_id from public.assessment_requests where app_id = any($1::uuid[])',
      [[recent.appId, ancient.appId]],
    );
    expect(rows.map((row) => row.app_id)).toEqual([ancient.appId]);
  });

  it('agrees with the rule a person reads, case by case', async () => {
    // Two expressions of one rule — the predicate in SQL and `isReassessmentDue`
    // in TypeScript — is how a rule quietly forks. The sweep logs a complaint
    // when they disagree; this checks that it never has to.
    const space = await workspace('schedule-agreement');
    await subscribe(space, 'certified');
    const assessmentId = await assess(space, { score: 80 });
    await monitor(space);
    await isolate(space);

    const now = new Date('2026-08-01T00:00:00Z');
    for (const daysAgo of [0, 1, 29, 30, 31, 60]) {
      const assessedAt = new Date(now.getTime() - daysAgo * 86_400_000);
      await db.query('update public.assessments set completed_at = $2 where id = $1', [
        assessmentId,
        assessedAt.toISOString(),
      ]);
      await db.query('delete from public.assessment_requests where app_id = $1', [space.appId]);
      await db.query('update public.apps set last_reassessed_at = null where id = $1', [
        space.appId,
      ]);

      const queued = await sweepScheduledReassessments(pool, undefined, now);
      const expected = isReassessmentDue('certified', assessedAt, now) ? 1 : 0;
      expect(queued, `assessed ${daysAgo} days ago`).toBe(expected);
    }
    await db.query('delete from public.assessment_requests where app_id = $1', [space.appId]);
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

  it('spends the page on the applications actually owed a check', async () => {
    // The sweep reads a page of badged applications. If that page is unordered
    // and the cadence is applied afterwards in code, the page fills up with
    // applications pinged a minute ago and the one nobody has heard from in a
    // day never gets looked at — while the sweep reports itself busy and well.
    const seen = await workspace('liveness-page-seen');
    await subscribe(seen, 'certified');
    await liveBadge(seen, await assess(seen, { score: 80 }));
    const owed = await workspace('liveness-page-owed');
    await subscribe(owed, 'certified');
    await liveBadge(owed, await assess(owed, { score: 80 }));
    await isolateAll([seen, owed]);
    // This plan is pinged hourly. One was answered a minute ago, the other a
    // day ago, and there is room in the page for exactly one of them.
    await db.query(
      "update public.apps set last_seen_at = now() - interval '1 minute' where id = $1",
      [seen.appId],
    );
    await db.query("update public.apps set last_seen_at = now() - interval '1 day' where id = $1", [
      owed.appId,
    ]);

    const probed: string[] = [];
    await sweepLiveness(
      pool,
      async (url) => {
        probed.push(url);
        return { status: 200 };
      },
      undefined,
      new Date('2026-08-11T00:00:00Z'),
      1,
    );

    const origin = await db.query<{ certified_origin: string }>(
      'select certified_origin from public.badges where app_id = $1',
      [owed.appId],
    );
    expect(probed).toEqual([origin.rows[0]!.certified_origin]);
  });

  it('does not suspend a badge because we were the ones who stopped looking', async () => {
    // The scope guard refusing an origin and the origin going dark are the same
    // shape of nothing: no status, no body, no answer. They mean opposite
    // things. Counting a refusal as an outage suspends a working customer's
    // badge and tells them, in writing, that their application stopped
    // responding — a statement we would have no basis for and they would have
    // no way to check.
    const { space, badgeId } = await setUp('liveness-refused');
    const refused = async () => ({
      status: null,
      refusedReason: 'Refused by the scope guard: it resolves to the non-public address 10.0.0.4',
    });

    for (let attempt = 1; attempt <= 9; attempt += 1) {
      const result = await sweepLiveness(
        pool,
        refused,
        undefined,
        new Date(`2026-08-${String(attempt).padStart(2, '0')}T00:00:00Z`),
      );
      expect(result.refused, `sweep ${attempt}`).toBe(1);
      expect(result.down, `sweep ${attempt}`).toBe(0);
    }

    const badge = await db.query<{ status: string }>(
      'select status::text as status from public.badges where id = $1',
      [badgeId],
    );
    expect(badge.rows[0]!.status).toBe('active');

    const { rows } = await db.query<{ consecutive_liveness_failures: number }>(
      'select consecutive_liveness_failures from public.apps where id = $1',
      [space.appId],
    );
    expect(rows[0]!.consecutive_liveness_failures).toBe(0);

    const kinds = (await alertsFor(space)).map((alert) => alert.kind);
    expect(kinds).toContain('monitoring_blocked');
    expect(kinds).not.toContain('application_unreachable');
    expect(kinds).not.toContain('badge_suspended');
  });

  it('says we could not look, not that the application is down', async () => {
    const { space } = await setUp('liveness-refused-wording');
    await sweepLiveness(
      pool,
      async () => ({ status: null, refusedReason: 'Refused by the scope guard: out of scope' }),
      undefined,
      new Date('2026-08-12T00:00:00Z'),
    );
    const blocked = (await alertsFor(space)).find((alert) => alert.kind === 'monitoring_blocked');
    expect(blocked).toBeDefined();
    // The distinction is the entire point of the alert, so it is checked as
    // wording and not only as a kind.
    expect(blocked!.body).toContain('cannot say whether it is answering');
    expect(blocked!.body).toContain('not a finding about the application');
    expect(blocked!.body.toLowerCase()).not.toContain('did not respond');
  });

  it('leaves a genuine outage counting where it was when a refusal interrupts it', async () => {
    // A refusal is not evidence either way, so it must not forgive an outage in
    // progress. Three failures, a refusal, three more failures: still six.
    const { badgeId } = await setUp('liveness-refused-midway');
    const down = async () => ({ status: null, error: 'connect ETIMEDOUT' });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await sweepLiveness(pool, down, undefined, new Date(`2026-08-0${attempt}T00:00:00Z`));
    }
    await sweepLiveness(
      pool,
      async () => ({ status: null, refusedReason: 'Refused by the scope guard: out of scope' }),
      undefined,
      new Date('2026-08-04T00:00:00Z'),
    );
    for (let attempt = 5; attempt <= 7; attempt += 1) {
      await sweepLiveness(pool, down, undefined, new Date(`2026-08-0${attempt}T00:00:00Z`));
    }
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

describe('every kind of alert has a name a person can read', () => {
  it('has a console label for every alert_kind the database knows', async () => {
    // Asked of the catalogue rather than of the migrations, because the gap this
    // closes is between two files that never mention each other: a kind is added
    // to the enum in SQL and the console goes on rendering the raw label. Three
    // kinds were in exactly that state when this test was written.
    const { rows } = await db.query<{ label: string }>(
      `select e.enumlabel as label
         from pg_enum e join pg_type t on t.oid = e.enumtypid
        where t.typname = 'alert_kind'
        order by e.enumsortorder`,
    );
    const unnamed = rows.map((row) => row.label).filter((label) => !KIND_LABEL[label]);
    expect(unnamed, 'alert kinds with no label in the console inbox').toEqual([]);
  });
});

describe('the liveness probe is inside the scope boundary', () => {
  it('refuses an origin that resolves to a private address', async () => {
    // The certified origin is a public name today. If its DNS is later pointed
    // at link-local, an unguarded probe would fetch cloud metadata on a
    // schedule, every hour, for as long as the badge lives.
    const probe = await httpLivenessProbe('http://127.0.0.1:1/');
    expect(probe.status).toBeNull();
    // In `refusedReason` and not in `error`, which is the difference between
    // "we did not look" and "nobody answered". Everything downstream — the
    // failure counter, the suspension, the wording of the notice — turns on
    // which of the two fields this arrives in.
    expect(probe.refusedReason ?? '').toMatch(/scope guard|private|refused/i);
    expect(probe.error).toBeUndefined();
  });

  it('refuses a redirect that leaves the certified origin', async () => {
    const { createServer } = await import('node:http');
    const server = createServer((_request, response) => {
      // A target that redirects the monitor somewhere else is exactly what the
      // guard exists to refuse — and following it automatically would be a
      // request the guard never saw.
      response.writeHead(302, { location: 'https://example.invalid/elsewhere' });
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const probe = await httpLivenessProbe(`http://127.0.0.1:${port}/`);
      expect(probe.status).toBeNull();
      expect(probe.refusedReason ?? '').toMatch(/scope guard|refused|private/i);
      expect(probe.error).toBeUndefined();
    } finally {
      server.close();
    }
  });

  it('permits exactly one host and nothing that changes state', () => {
    const policy = livenessPolicy('https://kettle.example');
    expect(policy.allowedHosts).toEqual(['kettle.example']);
    expect(policy.ceiling.nonDestructiveOnly).toBe(true);
    expect(policy.ceiling.allowDataModification).toBe(false);
    expect(policy.ceiling.allowAccountCreation).toBe(false);
    // A ping is one request, plus the redirects it may follow. Not a crawl.
    expect(policy.ceiling.maxTotalRequests).toBeLessThanOrEqual(4);
  });
});
