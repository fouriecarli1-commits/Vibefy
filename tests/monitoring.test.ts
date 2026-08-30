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
  const supersede = async (from: string, to: string) => {
    await db.query(
      `insert into public.rubric_versions (version, definition, checksum, changelog, published_at, effective_from)
       values ($1, '{}'::jsonb, repeat('a', 64), 'test', now(), now())
       on conflict (version) do nothing`,
      [to],
    );
    await db.query(`update public.rubric_versions set superseded_at = now() where version = $1`, [
      from,
    ]);
  };

  it('tells a badge holder their rubric version was superseded, once', async () => {
    const space = await workspace('rubric-superseded');
    const assessmentId = await assess(space, { score: 80 });
    const consentId = await acceptBadgeLicence(db, space.owner);
    await issueBadge(db, space.owner, { appId: space.appId, assessmentId, consentId });

    // Nothing to say while the rubric it was earned against is still current.
    expect(await sweepSupersededRubric(pool)).toBe(0);

    await supersede('1.0.0', '1.1.0');

    expect(await sweepSupersededRubric(pool)).toBeGreaterThanOrEqual(1);
    expect(await sweepSupersededRubric(pool)).toBe(0);

    const raised = (await alertsFor(space)).filter((alert) => alert.kind === 'rubric_superseded');
    expect(raised).toHaveLength(1);
    expect(raised[0]!.body).toMatch(/earned its badge against Rubric v1\.0\.0/);
    expect(raised[0]!.body).toMatch(/v1\.1\.0 is now in force/);
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

describe('the liveness probe is inside the scope boundary', () => {
  it('refuses an origin that resolves to a private address', async () => {
    // The certified origin is a public name today. If its DNS is later pointed
    // at link-local, an unguarded probe would fetch cloud metadata on a
    // schedule, every hour, for as long as the badge lives.
    const probe = await httpLivenessProbe('http://127.0.0.1:1/');
    expect(probe.status).toBeNull();
    expect(probe.error ?? '').toMatch(/scope guard|private|refused/i);
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
      expect(probe.error ?? '').toMatch(/scope guard|refused|private/i);
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
