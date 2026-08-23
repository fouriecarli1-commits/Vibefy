/**
 * Assembling a report from stored rows.
 *
 * Lives in the report package rather than in the worker because both the worker
 * (generating a PDF) and the console (showing a report on screen) need exactly
 * this, and two copies of it would eventually disagree about what a report says.
 *
 * It takes a minimal SQL interface rather than a client, so the console can run
 * it under the caller's own row-level-security identity and the worker can run
 * it with direct access — one assembly path, two trust levels.
 */
import { getRubric } from '@vibefycode/rubric';
import { evaluatePolicy, type PolicyProfile, type PolicySubject } from '@vibefycode/policy';
import type { ReportSource } from './types.ts';

/** The smallest database surface this needs. `pg.PoolClient` satisfies it. */
export interface SqlExecutor {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

/** The shapes the three queries below return. Declared, because a row read as
 *  `unknown` is a row nobody checked. */
interface AssessmentRow {
  id: string;
  app_name: string;
  primary_url: string | null;
  intended_for_app_store: boolean;
  policy_profile_id: string | null;
  organisation_name: string;
  rubric_version: string;
  overall_score: string | number | null;
  dimension_scores: { dimension: string; score: number; weight: number; band: string }[] | null;
  certification_eligible: boolean;
  gate_failures: string[] | null;
  scope_statement: string | null;
  prompt_bundle_sha256: string | null;
  report_narrative: ReportSource['narrative'];
  completed_at: string | null;
  created_at: string;
  reviewed_at: string | null;
}

interface FindingRow {
  id: string;
  rubric_rule_id: string;
  dimension: ReportSource['findings'][number]['dimension'];
  severity: ReportSource['findings'][number]['severity'];
  confidence: ReportSource['findings'][number]['confidence'];
  title: string;
  description: string;
  remediation: string;
  evidence: ReportSource['findings'][number]['evidence'];
}

interface RunRow {
  stage: string;
  status: string;
  metadata: { notes?: string[] } | null;
}

interface BrandingRow {
  display_name: string;
  logo_data_uri: string | null;
  accent_colour: string | null;
  contact_line: string | null;
  footer_note: string | null;
}

interface PolicyRow {
  id: string;
  name: string;
  description: string | null;
  min_overall_score: string | null;
  dimension_floors: Record<string, number> | null;
  max_open_severity: PolicyProfile['maxOpenSeverity'];
  require_certification: boolean;
  require_store_readiness: boolean;
}

export async function assembleReportSource(
  client: SqlExecutor,
  assessmentId: string,
): Promise<ReportSource> {
  const assessment = await client.query<AssessmentRow>(
    `select a.*, app.name as app_name, app.primary_url, app.intended_for_app_store,
            o.name as organisation_name
       from public.assessments a
       join public.apps app on app.id = a.app_id
       join public.organisations o on o.id = a.organisation_id
      where a.id = $1`,
    [assessmentId],
  );
  const row = assessment.rows[0];
  if (!row) throw new Error(`Assessment ${assessmentId} does not exist.`);

  const findings = await client.query<FindingRow>(
    `select f.*,
            coalesce(
              json_agg(
                json_build_object(
                  'id', e.id, 'kind', e.kind, 'sha256', e.sha256,
                  'capturedAt', e.captured_at,
                  'summary', coalesce(e.metadata ->> 'summary', e.kind::text)
                ) order by e.captured_at
              ) filter (where e.id is not null),
              '[]'
            ) as evidence
       from public.findings f
       left join public.finding_evidence fe on fe.finding_id = f.id
       left join public.evidence e on e.id = fe.evidence_id
      where f.assessment_id = $1 and f.is_published
      group by f.id`,
    [assessmentId],
  );

  const runs = await client.query<RunRow>(
    `select stage, status, metadata from public.assessment_runs where assessment_id = $1`,
    [assessmentId],
  );

  // The agency's cover block, if this workspace has one. Read through the same
  // identity as everything else, so a workspace cannot brand someone else's report.
  const branding = await client.query<BrandingRow>(
    `select display_name, logo_data_uri, accent_colour, contact_line, footer_note
       from public.workspace_branding
      where organisation_id = (select organisation_id from public.assessments where id = $1)`,
    [assessmentId],
  );

  const policyProfile = row.policy_profile_id
    ? (
        await client.query<PolicyRow>(
          `select id, name, description, min_overall_score, dimension_floors,
                  max_open_severity, require_certification, require_store_readiness
             from public.policy_profiles where id = $1`,
          [row.policy_profile_id],
        )
      ).rows[0]
    : undefined;

  const rubric = getRubric(row.rubric_version);
  const labelFor = (id: string) => rubric.dimensions.find((d) => d.id === id)?.label ?? id;
  const bandFor = (score: number) =>
    rubric.bands.find((band) => score >= band.min && score <= band.max)?.label ?? 'Unbanded';

  const dimensionScores = row.dimension_scores ?? [];
  const narrative = row.report_narrative ?? null;
  const brandingRow = branding.rows[0];

  // The policy is evaluated here, over the finished score, and never anywhere
  // that could feed back into it.
  const policyEvaluation = policyProfile
    ? evaluatePolicy(
        {
          id: policyProfile.id,
          name: policyProfile.name,
          description: policyProfile.description,
          minOverallScore:
            policyProfile.min_overall_score === null
              ? null
              : Number(policyProfile.min_overall_score),
          dimensionFloors: (policyProfile.dimension_floors ??
            {}) as PolicyProfile['dimensionFloors'],
          maxOpenSeverity: policyProfile.max_open_severity,
          requireCertification: policyProfile.require_certification,
          requireStoreReadiness: policyProfile.require_store_readiness,
        },
        {
          assessmentId: row.id,
          overallScore: Number(row.overall_score ?? 0),
          certificationEligible: row.certification_eligible === true,
          dimensions: dimensionScores.map((dimension) => ({
            dimension: dimension.dimension as PolicySubject['dimensions'][number]['dimension'],
            score: Number(dimension.score),
          })),
          openFindings: findings.rows.map((finding) => ({
            ruleId: finding.rubric_rule_id,
            dimension: finding.dimension as PolicySubject['openFindings'][number]['dimension'],
            severity: finding.severity as PolicySubject['openFindings'][number]['severity'],
            title: finding.title,
          })),
          intendedForAppStore: row.intended_for_app_store === true,
        },
      )
    : null;

  return {
    assessmentId: row.id,
    appName: row.app_name,
    appUrl: row.primary_url,
    organisationName: row.organisation_name,
    rubricVersion: row.rubric_version,
    assessedOn: new Date(row.completed_at ?? row.created_at).toISOString().slice(0, 10),
    reviewedOn: row.reviewed_at ? new Date(row.reviewed_at).toISOString().slice(0, 10) : null,
    overallScore: Number(row.overall_score ?? 0),
    band: bandFor(Number(row.overall_score ?? 0)),
    certificationEligible: row.certification_eligible === true,
    certificationBlockers: row.gate_failures ?? [],
    dimensions: dimensionScores.map((dimension) => ({
      dimension: dimension.dimension as ReportSource['dimensions'][number]['dimension'],
      label: labelFor(dimension.dimension),
      score: Number(dimension.score),
      weight: Number(dimension.weight),
      band: dimension.band ?? bandFor(Number(dimension.score)),
    })),
    findings: findings.rows.map((finding) => ({
      id: finding.id,
      ruleId: finding.rubric_rule_id,
      dimension: finding.dimension,
      severity: finding.severity,
      confidence: finding.confidence,
      title: finding.title,
      description: finding.description,
      remediation: finding.remediation,
      evidence: finding.evidence,
    })),
    narrative,
    stages: runs.rows.map((run) => ({
      stage: run.stage,
      status: run.status,
      notes: run.metadata?.notes ?? [],
    })),
    scopeStatement: row.scope_statement ?? '',
    promptBundleSha256: row.prompt_bundle_sha256 ?? '',
    intendedForAppStore: row.intended_for_app_store === true,
    branding: brandingRow
      ? {
          displayName: brandingRow.display_name,
          logoDataUri: brandingRow.logo_data_uri,
          accentColour: brandingRow.accent_colour,
          contactLine: brandingRow.contact_line,
          footerNote: brandingRow.footer_note,
        }
      : null,
    policy: policyEvaluation
      ? {
          profileName: policyEvaluation.profileName,
          meetsPolicy: policyEvaluation.meetsPolicy,
          failures: policyEvaluation.failures.map((failure) => failure.explanation),
          note: policyEvaluation.note,
        }
      : null,
  };
}
