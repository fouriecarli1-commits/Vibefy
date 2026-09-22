/**
 * The job: take an assessment request, build a scope guard from the stored
 * authorisation, run the pipeline, and persist what comes out.
 *
 * The authorisation is read from the database at dispatch and again at write
 * time. Between those two moments the customer can withdraw it, and if they do,
 * the run's output is discarded rather than stored.
 */
import { UnretryableError } from './errors.ts';
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
  fetchRepository,
  runPipeline,
  type FetchedRepository,
  type AssessmentDepth,
  type AssessmentTarget,
  type ModelTransport,
  type StageContext,
} from '@vibefycode/engine';
import { persistOutcome, recordUnattributedCost } from './persist.ts';

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
  /**
   * How the declared repository is fetched. The real one only clones public
   * HTTPS URLs on a handful of forges; a test injects one that will also take
   * a local path, so the seam is here at the call site rather than a permission
   * inside the validator where a misconfiguration could open it in production.
   */
  readonly fetchRepository?: typeof fetchRepository;
  readonly log?: (message: string, detail?: Record<string, unknown>) => void;
}

export class NotAuthorisedError extends UnretryableError {}

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
  // `pending` is not "not refused yet". It is the state the intake screen puts
  // a submission in when it could not settle the question on wording alone, and
  // the application page tells the customer a reviewer confirms before any
  // assessment runs. Until this check existed, `refused` was blocked here and
  // `pending` went straight past — so the sentence on that page was untrue of
  // every application, because the judgement pass is not wired up and every
  // submission lands in `pending`.
  if (appRow.screening_status === 'pending') {
    throw new NotAuthorisedError(
      `App ${job.appId} has not been screened by a person yet. A reviewer clears or refuses it at /review/screening; no assessment runs before that.`,
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
  const meter = new CostMeter({ maxRunCostUsd: COST_CEILING_BY_DEPTH[job.depth] });
  const assessmentId = randomUUID();
  const evidence = new EvidenceStore(assessmentId);

  /*
   * The repository, where the customer declared one.
   *
   * `repositoryPath` was the literal `null` here, with nothing beside it to
   * say why — so the static stage, which its own header calls the cheapest and
   * least arguable in this engine, has never once run against a customer. Every
   * paid assessment told them in writing that secrets in source, dependency
   * risk and licensing were outside its scope, for the tier whose whole
   * differentiator is that they are not.
   *
   * It is fetched into the runner's temporary space and deleted in the
   * `finally` below, whatever happens: the safest place to keep somebody
   * else's source is nowhere.
   */
  let repository: FetchedRepository | null = null;
  let repositoryUnavailable: string | undefined;
  const authorisedRepository =
    typeof record.repository_url === 'string' && record.repository_url.length > 0
      ? record.repository_url
      : null;
  const declaredRepository =
    typeof appRow.repository_url === 'string' && appRow.repository_url.length > 0
      ? appRow.repository_url
      : null;

  if (authorisedRepository !== null) {
    try {
      const fetch = dependencies.fetchRepository ?? fetchRepository;
      repository = await fetch(authorisedRepository, { log });
      log('repository ready', { appId: appRow.id, bytes: repository.bytes });
    } catch (error) {
      repositoryUnavailable = error instanceof Error ? error.message : String(error);
      log('repository unavailable', { appId: appRow.id, reason: repositoryUnavailable });
    }
  } else if (declaredRepository !== null) {
    // The app names a repository and the authorisation does not. That is the
    // same rule the domain scope has, for the same reason: an authorisation we
    // can widen afterwards is worth nothing as evidence that our testing was
    // lawful. Said out loud rather than skipped, because from the report it
    // would otherwise look exactly like an application with no source.
    repositoryUnavailable =
      'the authorisation on file does not cover it — a repository added after the warranty was accepted needs a fresh authorisation';
    log('repository not authorised', { appId: appRow.id });
  }

  const target: AssessmentTarget = {
    appId: appRow.id,
    organisationId: appRow.organisation_id,
    appName: appRow.name,
    appType: appRow.app_type,
    primaryUrl: appRow.primary_url,
    repositoryPath: repository?.path ?? null,
    ...(repositoryUnavailable === undefined ? {} : { repositoryUnavailable }),
    intendedForAppStore: appRow.intended_for_app_store,
    isGame: appRow.is_game,
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
  let outcome;
  try {
    outcome = await runPipeline({ context });
  } finally {
    // Always, and before anything else can fail. Decision 008: a customer's
    // source is processed in the ephemeral runner volume and deleted on
    // completion, because the safest place to store it is nowhere.
    await repository?.dispose();
  }
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
  } catch (error) {
    // The run has already been paid for. If it cannot be written down as an
    // assessment, the money is still gone, and the spend cap reads the ledger —
    // so the cost goes in unattributed rather than vanishing. Best-effort and
    // deliberately silent on its own failure: the error below is the one worth
    // reporting, and losing it to a secondary failure here would replace a
    // precise diagnosis with a vague one.
    try {
      const rows = await recordUnattributedCost(client, {
        organisationId: appRow.organisation_id,
        costByStage: outcome.costByStage,
      });
      log('unpersisted run cost recorded', { rows, costUsd: outcome.totalCostUsd });
    } catch (ledgerError) {
      log('unpersisted run cost could not be recorded', { error: String(ledgerError) });
    }
    throw error;
  } finally {
    client.release();
  }
}
