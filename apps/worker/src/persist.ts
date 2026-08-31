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
import type { AssessmentOutcome } from '@vibefycode/engine';

export interface PersistInput {
  readonly outcome: AssessmentOutcome;
  readonly appId: string;
  readonly organisationId: string;
  readonly authorisationId: string;
  readonly depth: 'limited' | 'full' | 'continuous';
  readonly requestedBy: string | null;
  readonly engineVersion: string;
}

export class AuthorisationWithdrawnError extends Error {
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
         report_narrative, started_at, completed_at
       ) values ($1, $2, $3, $4, $5, $6, 'running', $7, $8, false, $9, $10, $11, $12, $13, $14, now(), now())
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
        if (!persistedId) continue;
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
    await client.query('update public.assessments set status = $2 where id = $1', [
      assessmentId,
      outcome.status === 'completed' ? 'awaiting_review' : 'failed',
    ]);

    await client.query(
      `insert into public.audit_log
         (organisation_id, actor_id, action, entity_type, entity_id, summary, after_state)
       values ($1, $2, 'assessment.completed', 'assessment', $3, $4, $5)`,
      [
        input.organisationId,
        input.requestedBy,
        assessmentId,
        `Assessment ${outcome.status}: ${outcome.findings.length} finding(s), score ${outcome.score.overallScore}, cost $${outcome.totalCostUsd.toFixed(4)}.`,
        JSON.stringify({
          status: outcome.status,
          score: outcome.score.overallScore,
          certificationEligible: outcome.score.certificationEligible,
          blockers: outcome.score.certificationBlockers,
          promptBundleSha256: outcome.promptBundleSha256,
        }),
      ],
    );

    await client.query('commit');
    return assessmentId;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

function mapStageStatus(status: string): string {
  switch (status) {
    case 'succeeded':
      return 'succeeded';
    case 'skipped':
      return 'cancelled';
    case 'aborted':
      return 'aborted';
    default:
      return 'failed';
  }
}
