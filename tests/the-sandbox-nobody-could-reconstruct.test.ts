/**
 * What a run was allowed to touch, after the permission has changed.
 *
 * `assessment_runs.enforced_scope` has carried its reason since the first
 * migration: "copied from the authorisation at dispatch so the sandbox
 * configuration that actually ran is recoverable even if a later authorisation
 * supersedes it." Nothing ever wrote to it. Every run row in this product held
 * null.
 *
 * It is the answer to the one question this company would least like to be
 * unable to answer. A customer says we tested something they did not authorise.
 * Their authorisation has since been superseded — by their own hand, or by a
 * revocation, both of which this schema supports and one of which has its own
 * migration — and the record of what was permitted while the run happened is
 * the thing that settles it. The current authorisation is not that record. The
 * whole reason the column exists is that authorisations change.
 *
 * Taken from the guard rather than from the authorisation row:
 * `policyFromAuthorisation` fills in ceilings the row does not state and the
 * guard normalises again on construction, so what is stored is what was
 * enforced rather than what somebody would reconstruct and hope matched.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import {
  DEFAULT_CEILING,
  ScopeGuard,
  policyFromAuthorisation,
} from '../packages/engine/src/index.ts';
import { persistOutcome } from '../apps/worker/src/index.ts';
import { memoryStorage } from './setup/artefacts.ts';
import { connect } from './setup/client.ts';
import {
  sha256,
  seedAccount,
  seedApp,
  seedAuthorisation,
  seedRubric,
  type SeededAccount,
} from './setup/seed.ts';

let db: Client;
let pool: Pool;
let owner: SeededAccount;

function poolConfig() {
  const dsn = process.env.VIBEFYCODE_TEST_DSN!;
  const url = new URL(dsn);
  return { host: url.searchParams.get('host')!, database: url.pathname.slice(1), user: 'postgres' };
}

beforeAll(async () => {
  db = await connect();
  pool = new Pool(poolConfig());
  owner = await seedAccount(db, 'enforced-scope');
  await seedRubric(db);
});

afterAll(async () => {
  await pool?.end();
  await db?.end();
});

/** The smallest outcome `persistOutcome` will take, with a scope on it. */
function outcomeWith(assessmentId: string, guard: ScopeGuard) {
  return {
    assessmentId,
    status: 'completed' as const,
    stopReason: null,
    rubricVersion: '1.0.0',
    promptBundleSha256: 'a'.repeat(64),
    stageResults: [
      {
        stage: 'static_intake' as const,
        status: 'succeeded' as const,
        findings: [],
        notes: ['read the checkout'],
      },
    ],
    findings: [],
    score: {
      rubricVersion: '1.0.0',
      overallScore: 80,
      band: 'Usable with reservations',
      dimensions: [],
      gatesApplied: [],
      certificationEligible: false,
      certificationBlockers: [],
    },
    narrative: null,
    evidence: [],
    costByStage: {},
    totalCostUsd: 0,
    scopeStatement: 'What was assessed, and what was not. '.repeat(4),
    nonRelianceLegend: 'x',
    aiDisclosure: 'y',
    notes: [],
    notTestedCriteria: [],
    provenance: [],
    exitMeasurement: null,
    enforcedScope: guard.policy,
  };
}

async function runAgainst(guard: ScopeGuard): Promise<string> {
  const appId = await seedApp(db, owner, `Scope App ${crypto.randomUUID().slice(0, 8)}`);
  await seedAuthorisation(db, owner, appId);
  const authorisationId = (
    await db.query<{ id: string }>('select id from public.current_authorisation($1)', [appId])
  ).rows[0]!.id;
  const client = await pool.connect();
  try {
    return await persistOutcome(client, {
      outcome: outcomeWith(crypto.randomUUID(), guard) as never,
      evidenceBodies: new Map(),
      storage: memoryStorage(),
      appId,
      organisationId: owner.organisationId,
      authorisationId,
      depth: 'limited',
      requestedBy: owner.userId,
      engineVersion: '1.0.0',
    });
  } finally {
    client.release();
  }
}

describe('the sandbox a run actually ran in', () => {
  it('is written down, rather than left null for somebody to reconstruct', async () => {
    const guard = new ScopeGuard({
      allowedHosts: ['kettle.example'],
      exclusions: ['/admin'],
      ceiling: { ...DEFAULT_CEILING, maxRequestsPerMinute: 30 },
    });
    const assessmentId = await runAgainst(guard);

    const { rows } = await db.query<{ enforced_scope: Record<string, unknown> | null }>(
      'select enforced_scope from public.assessment_runs where assessment_id = $1',
      [assessmentId],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(
        row.enforced_scope,
        'the run row says nothing about what it was allowed to do',
      ).not.toBeNull();
      expect(row.enforced_scope).toMatchObject({
        allowedHosts: ['kettle.example'],
        exclusions: ['/admin'],
      });
      expect((row.enforced_scope as { ceiling: Record<string, unknown> }).ceiling).toMatchObject({
        maxRequestsPerMinute: 30,
      });
    }
  });

  it('records the ceilings the authorisation did not state', async () => {
    /*
     * The reason this comes from the guard and not from the authorisation row.
     * `policyFromAuthorisation` fills in a default for every ceiling the record
     * leaves out, and the guard normalises again — so the row alone does not
     * say what was enforced, and anybody reconstructing it later would be
     * guessing at exactly the numbers in dispute.
     */
    const guard = new ScopeGuard(
      policyFromAuthorisation({
        scope_domains: ['kettle.example'],
        scope_exclusions: [],
        intensity_ceiling: { max_requests_per_minute: 12 },
      }),
    );
    const assessmentId = await runAgainst(guard);
    const { rows } = await db.query<{ enforced_scope: { ceiling: Record<string, unknown> } }>(
      'select enforced_scope from public.assessment_runs where assessment_id = $1',
      [assessmentId],
    );
    const ceiling = rows[0]!.enforced_scope.ceiling;
    expect(ceiling.maxRequestsPerMinute).toBe(12);
    // The ones nobody wrote down, which are the ones a dispute turns on.
    expect(ceiling.maxTotalRequests).toBe(DEFAULT_CEILING.maxTotalRequests);
    expect(ceiling.nonDestructiveOnly).toBe(true);
    expect(ceiling.allowDataModification).toBe(false);
  });

  it('survives the authorisation it was copied from being superseded', async () => {
    // The whole point of the column, in one case. The run's record stands on
    // its own after the permission behind it has been replaced.
    const guard = new ScopeGuard({
      allowedHosts: ['kettle.example'],
      exclusions: [],
      ceiling: DEFAULT_CEILING,
    });
    const assessmentId = await runAgainst(guard);
    const appId = (
      await db.query<{ app_id: string }>('select app_id from public.assessments where id = $1', [
        assessmentId,
      ])
    ).rows[0]!.app_id;

    // A revocation is a new row that supersedes, never an update: the table is
    // append-only, which is the same reasoning this column rests on — what was
    // true at the time has to stay readable after it stops being true.
    const granted = (
      await db.query<{ id: string }>('select id from public.current_authorisation($1)', [appId])
    ).rows[0]!.id;
    await db.query(
      `insert into public.authorisations
         (app_id, organisation_id, supersedes_id, status, method, scope_domains,
          warranty_text_version, warranty_text_sha256, granted_by, revocation_reason)
       values ($1, $2, $3, 'revoked', 'dns_txt', '{}', '1.0.0', $4, $5, 'Customer withdrew authorisation')`,
      [appId, owner.organisationId, granted, sha256('w'), owner.userId],
    );

    const { rows } = await db.query<{ enforced_scope: { allowedHosts: string[] } | null }>(
      'select enforced_scope from public.assessment_runs where assessment_id = $1',
      [assessmentId],
    );
    expect(rows[0]!.enforced_scope?.allowedHosts).toEqual(['kettle.example']);
  });
});
