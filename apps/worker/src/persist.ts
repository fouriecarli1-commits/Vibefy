/**
 * Writing an assessment outcome to the database.
 *
 * This runs with direct database access rather than through the customer's
 * session, so it is the one place that can write findings and evidence — and
 * therefore the one place that has to be careful. Three rules are enforced here
 * as well as in the schema, because the schema's triggers only fire on the rows
 * that reach them:
 *
 *   · Nothing is written unless the app still has a verified authorisation. A
 *     customer who withdrew authorisation mid-run gets no report from it.
 *   · Everything lands in one transaction. A half-written assessment with some
 *     of its evidence is worse than no assessment.
 *   · The assessment stops at `awaiting_review`. Nothing here can approve it;
 *     that requires a human, and the database refuses the transition without one.
 */
import type { PoolClient } from 'pg';
import { UnretryableError } from './errors.ts';
import { STOP_LABEL, type AssessmentOutcome, type StageResult } from '@vibefycode/engine';

export interface PersistInput {
  readonly outcome: AssessmentOutcome;
  readonly appId: string;
  readonly organisationId: string;
  readonly authorisationId: string;
  readonly depth: 'limited' | 'full' | 'continuous';
  readonly requestedBy: string | null;
  readonly engineVersion: string;
}

/**
 * A finding cited evidence that was never stored.
 *
 * Unreachable today, and that is the reason it throws rather than shrugs. The
 * guarantee is spread across three files that do not know about each other:
 * `enforceEvidence` filters model findings against what was actually captured,
 * and the deterministic stages pass ids straight back from a capture that
 * either stored something or threw. Nothing joins those two facts up. If either
 * ever stops being true, the old `continue` would publish a finding with no
 * proof behind it, and the one claim this company cannot afford to get wrong is
 * "here is what we found, and here is what we saw".
 *
 * The whole transaction goes rather than the one link, for the reason stated at
 * the top of this file: a half-written assessment is worse than no assessment.
 */
export class DanglingEvidenceError extends UnretryableError {
  constructor(findingTitle: string, evidenceId: string) {
    super(
      `The finding "${findingTitle}" cites evidence ${evidenceId}, which this run did not store. ` +
        `Nothing is written: a published finding whose evidence we do not hold is a claim we cannot back.`,
    );
    this.name = 'DanglingEvidenceError';
  }
}

export class AuthorisationWithdrawnError extends UnretryableError {
  constructor(appId: string) {
    super(
      `Authorisation for app ${appId} is no longer verified. The run's output is discarded rather than stored: we do not keep the results of testing we are no longer authorised to have done.`,
    );
    this.name = 'AuthorisationWithdrawnError';
  }
}

/**
 * Writes down money that was spent by a run which never became an assessment.
 *
 * The success path records cost inside `persistOutcome`'s transaction, keyed to
 * the assessment. When that transaction is the thing that failed, the spend is
 * no less real — the model was called, the tokens were bought — and the daily
 * cap reads `cost_records`. Recording nothing would mean the ledger under-reports
 * precisely when a run is failing repeatedly, which is when it matters most.
 *
 * One row per stage, exactly as the success path writes them, with a null
 * assessment id. Kept deliberately quiet: this runs while another error is on
 * its way up, and it must never replace it.
 */
export async function recordUnattributedCost(
  // Only `query` — this function never owns the connection, so it must never be
  // in a position to release one. It also lets the tests hand it a plain Client.
  client: Pick<PoolClient, 'query'>,
  input: {
    readonly organisationId: string;
    readonly costByStage: AssessmentOutcome['costByStage'];
  },
): Promise<number> {
  let written = 0;
  for (const record of Object.values(input.costByStage)) {
    await client.query(
      `insert into public.cost_records
         (assessment_id, organisation_id, model, input_tokens, output_tokens, cache_read_tokens,
          ai_cost_usd, compute_seconds, compute_cost_usd, storage_bytes, third_party_calls,
          third_party_cost_usd, purpose)
       values (null, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'assessment')`,
      [
        input.organisationId,
        record.model,
        record.inputTokens,
        record.outputTokens,
        record.cacheReadTokens,
        record.aiCostUsd.toFixed(6),
        record.computeSeconds.toFixed(3),
        record.computeCostUsd.toFixed(6),
        record.storageBytes,
        record.thirdPartyCalls,
        record.thirdPartyCostUsd.toFixed(6),
      ],
    );
    written += 1;
  }
  return written;
}

export async function persistOutcome(client: PoolClient, input: PersistInput): Promise<string> {
  const { outcome } = input;

  await client.query('begin');
  try {
    // Re-checked at write time, not just at dispatch. A customer can withdraw
    // authorisation while a run is in flight, and if they did, this run's output
    // does not become a report.
    const stillAuthorised = await client.query<{ ok: boolean }>(
      'select public.app_is_authorised_for_testing($1) as ok',
      [input.appId],
    );
    if (!stillAuthorised.rows[0]?.ok) throw new AuthorisationWithdrawnError(input.appId);

    const assessment = await client.query<{ id: string }>(
      `insert into public.assessments (
         id, app_id, organisation_id, authorisation_id, rubric_version, depth, status,
         overall_score, dimension_scores, certification_eligible, gate_failures,
         scope_statement, prompt_bundle_sha256, engine_version, requested_by,
         report_narrative, exit_measurement, not_tested, started_at, completed_at
       ) values ($1, $2, $3, $4, $5, $6, 'running', $7, $8, false, $9, $10, $11, $12, $13, $14, $15, $16, now(), now())
       returning id`,
      [
        outcome.assessmentId,
        input.appId,
        input.organisationId,
        input.authorisationId,
        outcome.rubricVersion,
        input.depth,
        outcome.score.overallScore,
        JSON.stringify(outcome.score.dimensions),
        outcome.score.certificationBlockers,
        outcome.scopeStatement,
        outcome.promptBundleSha256,
        input.engineVersion,
        input.requestedBy,
        outcome.narrative ? JSON.stringify(outcome.narrative) : null,
        outcome.exitMeasurement ? JSON.stringify(outcome.exitMeasurement) : null,
        JSON.stringify(outcome.notTestedCriteria),
      ],
    );
    const assessmentId = assessment.rows[0]!.id;

    for (const stage of outcome.stageResults) {
      await client.query(
        `insert into public.assessment_runs
           (assessment_id, organisation_id, stage, status, error_message, metadata, started_at, finished_at)
         values ($1, $2, $3, $4, $5, $6, now(), now())
         on conflict (assessment_id, stage, attempt) do nothing`,
        [
          assessmentId,
          input.organisationId,
          stage.stage,
          mapStageStatus(stage.status),
          stage.error ?? null,
          JSON.stringify({ notes: stage.notes, promptSha256: stage.promptSha256 ?? null }),
        ],
      );
    }

    // Evidence before findings, so the join rows below have both ends to link.
    const evidenceIdMap = new Map<string, string>();
    for (const artefact of outcome.evidence) {
      const row = await client.query<{ id: string }>(
        `insert into public.evidence
           (assessment_id, organisation_id, kind, storage_path, sha256, content_type, byte_size,
            captured_at, retention_until, metadata)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         returning id`,
        [
          assessmentId,
          input.organisationId,
          artefact.kind,
          artefact.storagePath,
          artefact.sha256,
          artefact.contentType,
          artefact.byteSize,
          artefact.capturedAt,
          artefact.retentionUntil,
          JSON.stringify({ summary: artefact.summary, ...artefact.metadata }),
        ],
      );
      evidenceIdMap.set(artefact.id, row.rows[0]!.id);
    }

    for (const finding of outcome.findings) {
      const row = await client.query<{ id: string }>(
        `insert into public.findings
           (assessment_id, organisation_id, dimension, severity, confidence, rubric_rule_id,
            title, description, remediation, is_published)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
         returning id`,
        [
          assessmentId,
          input.organisationId,
          finding.dimension,
          finding.severity,
          finding.confidence,
          finding.ruleId,
          finding.title,
          finding.description,
          finding.remediation,
        ],
      );
      const findingId = row.rows[0]!.id;

      // A join row, not a column on evidence: one artefact commonly evidences
      // several findings, and a single foreign key would silently detach it from
      // all but the last.
      for (const engineEvidenceId of finding.evidenceIds) {
        const persistedId = evidenceIdMap.get(engineEvidenceId);
        if (!persistedId) throw new DanglingEvidenceError(finding.title, engineEvidenceId);
        await client.query(
          `insert into public.finding_evidence (finding_id, evidence_id, organisation_id)
           values ($1, $2, $3) on conflict do nothing`,
          [findingId, persistedId, input.organisationId],
        );
      }
    }

    for (const [stage, record] of Object.entries(outcome.costByStage)) {
      await client.query(
        `insert into public.cost_records
           (assessment_id, organisation_id, model, input_tokens, output_tokens, cache_read_tokens,
            ai_cost_usd, compute_seconds, compute_cost_usd, storage_bytes, third_party_calls,
            third_party_cost_usd, purpose)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'assessment')`,
        [
          assessmentId,
          input.organisationId,
          record.model,
          record.inputTokens,
          record.outputTokens,
          record.cacheReadTokens,
          record.aiCostUsd.toFixed(6),
          record.computeSeconds.toFixed(3),
          record.computeCostUsd.toFixed(6),
          record.storageBytes,
          record.thirdPartyCalls,
          record.thirdPartyCostUsd.toFixed(6),
        ],
      );
      void stage;
    }

    // The last step, and the only status this code is allowed to set. Approval
    // needs a human, and the database refuses the transition without a logged
    // review action.
    //
    // Three outcomes, three words. A run that stopped at a limit used to be
    // written down as a failure, which told the customer their application had
    // broken something when what had actually happened was a limit working.
    // The reason travels with it, and the database refuses an aborted row that
    // does not carry one.
    await client.query(
      'update public.assessments set status = $2, stop_reason = $3 where id = $1',
      [assessmentId, assessmentStatus(outcome), outcome.stopReason],
    );

    await client.query(
      `insert into public.audit_log
         (organisation_id, actor_id, action, entity_type, entity_id, summary, after_state)
       values ($1, $2, $6, 'assessment', $3, $4, $5)`,
      [
        input.organisationId,
        input.requestedBy,
        assessmentId,
        summariseOutcome(outcome),
        JSON.stringify({
          status: outcome.status,
          stopReason: outcome.stopReason,
          score: outcome.score.overallScore,
          certificationEligible: outcome.score.certificationEligible,
          blockers: outcome.score.certificationBlockers,
          promptBundleSha256: outcome.promptBundleSha256,
        }),
        // An aborted run filed under `assessment.completed` is a log that has
        // to be read with the summary to be believed, which is not a log.
        `assessment.${outcome.status}`,
      ],
    );

    await client.query('commit');
    return assessmentId;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

/**
 * The status this run is written down as.
 *
 * `aborted` is not a failure and must not be recorded as one: it means the run
 * reached its spending limit, used up the intensity the customer authorised, or
 * was turned back at the scope boundary. What was assessed before the stop
 * still stands, which is why the findings and the score are written either way.
 * It does not go to a reviewer, because a stopped run is not a complete one.
 */
function assessmentStatus(outcome: AssessmentOutcome): string {
  if (outcome.status === 'completed') return 'awaiting_review';
  return outcome.status === 'aborted' ? 'aborted' : 'failed';
}

/** The audit line, in words somebody reading it a year later can act on. */
function summariseOutcome(outcome: AssessmentOutcome): string {
  const money = `cost $${outcome.totalCostUsd.toFixed(4)}`;
  const counted = `${outcome.findings.length} finding(s), score ${outcome.score.overallScore}`;
  if (outcome.stopReason) {
    return `Assessment stopped — it ${STOP_LABEL[outcome.stopReason]}. What ran first stands: ${counted}, ${money}.`;
  }
  return `Assessment ${outcome.status}: ${counted}, ${money}.`;
}

/**
 * A stage's own word for how it ended, in the word the database uses.
 *
 * Exhaustive on purpose, with no default. This used to take a `string` and send
 * everything it did not recognise to `failed` — the same conflation that was
 * fixed one level up, where a run that stopped at a limit was written down as a
 * breakage and the customer was told their application had broken something
 * when what had happened was a limit working. A fifth stage status added to the
 * engine would have inherited exactly that bug, silently. Now it does not
 * compile.
 */
function mapStageStatus(status: StageResult['status']): string {
  switch (status) {
    case 'succeeded':
      return 'succeeded';
    // The database's word for "did not run", which is not the same as failing.
    case 'skipped':
      return 'cancelled';
    case 'aborted':
      return 'aborted';
    case 'failed':
      return 'failed';
    default: {
      const unhandled: never = status;
      throw new Error(
        `No database status is defined for the stage outcome "${String(unhandled)}".`,
      );
    }
  }
}
