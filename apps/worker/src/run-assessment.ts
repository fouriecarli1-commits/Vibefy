/**
 * The job: take an assessment request, build a scope guard from the stored
 * authorisation, run the pipeline, and persist what comes out.
 *
 * The authorisation is read from the database at dispatch and again at write
 * time. Between those two moments the customer can withdraw it, and if they do,
 * the run's output is discarded rather than stored.
 */
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  AnthropicTransport,
  COST_CEILING_BY_DEPTH,
  CostMeter,
  EvidenceStore,
  ModelClient,
  ScopeGuard,
  policyFromAuthorisation,
  runPipeline,
  type AssessmentDepth,
  type AssessmentTarget,
  type ModelTransport,
  type StageContext,
} from '@vibefy/engine';
import { persistOutcome } from './persist.ts';

export const ENGINE_VERSION = '1.0.0';

export interface AssessmentJob {
  readonly appId: string;
  readonly depth: AssessmentDepth;
  readonly requestedBy: string | null;
  readonly syntheticCredentials?: { email: string; password: string };
}

export interface RunDependencies {
  readonly pool: Pool;
  /** Injected so tests can run the whole job without calling the real API. */
  readonly transport?: ModelTransport;
  readonly log?: (message: string, detail?: Record<string, unknown>) => void;
}

export class NotAuthorisedError extends Error {}

export async function runAssessmentJob(
  job: AssessmentJob,
  dependencies: RunDependencies,
): Promise<{ assessmentId: string; totalCostUsd: number; status: string }> {
  const { pool } = dependencies;
  const log = dependencies.log ?? (() => undefined);

  const app = await pool.query(
    `select a.*, public.app_is_authorised_for_testing(a.id) as authorised
       from public.apps a where a.id = $1`,
    [job.appId],
  );
  const appRow = app.rows[0];
  if (!appRow) throw new NotAuthorisedError(`App ${job.appId} does not exist.`);
  if (appRow.screening_status === 'refused') {
    throw new NotAuthorisedError(
      `App ${job.appId} was refused under the Acceptable Use Policy; no assessment runs against it.`,
    );
  }
  if (!appRow.authorised) {
    throw new NotAuthorisedError(
      `App ${job.appId} has no verified, unexpired authorisation. This is the hard gate: no run starts without one.`,
    );
  }

  const authorisation = await pool.query('select * from public.current_authorisation($1)', [
    job.appId,
  ]);
  const record = authorisation.rows[0];
  if (!record) throw new NotAuthorisedError(`App ${job.appId} has no authorisation record.`);

  const guard = new ScopeGuard(policyFromAuthorisation(record));
  const meter = new CostMeter({ maxRunCostUsd: COST_CEILING_BY_DEPTH[job.depth] ?? 1 });
  const assessmentId = randomUUID();
  const evidence = new EvidenceStore(assessmentId);

  const target: AssessmentTarget = {
    appId: appRow.id,
    organisationId: appRow.organisation_id,
    appName: appRow.name,
    appType: appRow.app_type,
    primaryUrl: appRow.primary_url,
    repositoryPath: null,
    intendedForAppStore: appRow.intended_for_app_store,
    hasAuthentication: appRow.has_authentication,
    hasPayments: appRow.has_payments,
    processesPersonalData: appRow.processes_personal_data,
    description: appRow.description,
  };

  const context: StageContext = {
    assessmentId,
    depth: job.depth,
    guard,
    meter,
    evidence,
    model: new ModelClient(dependencies.transport ?? new AnthropicTransport(), meter),
    log,
    ...(job.syntheticCredentials ? { syntheticCredentials: job.syntheticCredentials } : {}),
    target,
  };

  log('Assessment starting', { assessmentId, appId: job.appId, depth: job.depth });
  const outcome = await runPipeline({ context });
  log('Assessment finished', {
    assessmentId,
    status: outcome.status,
    findings: outcome.findings.length,
    costUsd: outcome.totalCostUsd,
  });

  const client = await pool.connect();
  try {
    const persistedId = await persistOutcome(client, {
      outcome,
      appId: appRow.id,
      organisationId: appRow.organisation_id,
      authorisationId: record.id,
      depth: job.depth,
      requestedBy: job.requestedBy,
      engineVersion: ENGINE_VERSION,
    });
    return {
      assessmentId: persistedId,
      totalCostUsd: outcome.totalCostUsd,
      status: outcome.status,
    };
  } finally {
    client.release();
  }
}
