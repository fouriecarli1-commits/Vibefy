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
import { compareToPeers } from './comparison.ts';
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
  category: string | null;
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
  // Already returned by the `a.*` in the query below; it was simply never
  // declared here, so nothing downstream could see it and nothing complained.
  not_tested: { criterion: string; because: string }[] | null;
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

/**
 * The columns this assembler turns into a claim, and what each absence would
 * assert instead.
 *
 * The query is `select a.*`, so these arrive by being columns of
 * `public.assessments` rather than by being asked for, and `AssessmentRow`
 * above is a declaration about what `a.*` contains rather than a check. Every
 * one of them is then read with a default — `?? []`, `?? ''`, `=== true` — and
 * a default cannot tell an empty value from an absent column.
 *
 * What that would cost, in this file's own words about `not_tested`: "a
 * document that quietly drops the questions it could not answer lets the reader
 * assume the missing line was fine, and that is the specific way an assurance
 * report misleads somebody." A renamed column does exactly that, to every
 * report, silently.
 *
 * So the keys are checked rather than the values. `'not_tested' in row` is the
 * whole mechanism, and it distinguishes the two cases a default cannot.
 */
const CLAIM_COLUMNS: Readonly<Record<string, string>> = {
  not_tested:
    'absent, every report would say nothing went unanswered, which is the one thing this document must never imply by omission',
  gate_failures:
    'absent, an assessment blocked from certification would list no blockers, and the page would read as though nothing stood in the way',
  certification_eligible:
    'absent, `=== true` is false and a certified assessment would be reported as not eligible — wrong in the direction that costs the customer their badge rather than the direction that costs us our word, and wrong either way',
  dimension_scores:
    'absent, the table of dimensions would be empty under a real overall score, and the comparison would place the application against its peers on nothing',
  scope_statement:
    'absent, the refusal below would fire with a message about a short scope statement, which would send somebody looking in the wrong place',
  prompt_bundle_sha256:
    'absent, the report would carry an empty hash where it names the prompts the run used, which is the field a reviewer reproduces a run from',
};

export class ReportSourceIncompleteError extends Error {
  constructor(assessmentId: string, column: string, consequence: string) {
    super(
      `Assessment ${assessmentId} came back without the column "${column}". No report was ` +
        `assembled: ${consequence}.`,
    );
    this.name = 'ReportSourceIncompleteError';
  }
}

/** Which of them the row does not carry, in the order they are declared. */
export function missingClaimColumns(row: object): string[] {
  return Object.keys(CLAIM_COLUMNS).filter((column) => !(column in row));
}

export async function assembleReportSource(
  client: SqlExecutor,
  assessmentId: string,
): Promise<ReportSource> {
  const assessment = await client.query<AssessmentRow>(
    `select a.*, app.name as app_name, app.primary_url, app.intended_for_app_store,
            app.category, o.name as organisation_name
       from public.assessments a
       join public.apps app on app.id = a.app_id
       join public.organisations o on o.id = a.organisation_id
      where a.id = $1`,
    [assessmentId],
  );
  const row = assessment.rows[0];
  if (!row) throw new Error(`Assessment ${assessmentId} does not exist.`);

  for (const column of missingClaimColumns(row)) {
    throw new ReportSourceIncompleteError(assessmentId, column, CLAIM_COLUMNS[column] ?? 'unknown');
  }

  /*
   * A report is a statement about a number. There has to be one.
   *
   * `overall_score` is nullable and nothing ties it to a status, so every
   * figure below read `Number(row.overall_score)` — and `bandFor(0)` is
   * "Not ready: findings that block usable release within the assessed scope",
   * the harshest sentence this product can print, arrived at by the absence of
   * a measurement rather than by one. The dimensions table would have been
   * empty underneath it and the comparison would have placed the application
   * against its peers at zero.
   *
   * It is not reachable today: the engine writes the score in the same
   * statement as the status, `sweepPendingReports` only takes `approved` and
   * `published`, and since `20261008010000` nothing a request can reach may
   * write the column at all. This refuses anyway, for the same reason
   * `scoreExit` does — a function that cannot tell "zero" from "not measured"
   * is wrong in itself, and the next caller will not be the careful one.
   */
  /*
   * And a statement of what was not covered.
   *
   * `generateReport` refuses a scope statement under a hundred characters —
   * "a report without one states no limits, and we do not publish those" — and
   * that check is in the function that *stores* a report. The console page
   * calls `renderReport` directly on this source and gates only on status, so
   * the one caller that shows a customer their report live would have rendered
   * the scope paragraph empty. One rule, enforced in one of the two callers,
   * which is the shape of half the night.
   *
   * Here rather than there, because here is where both callers meet.
   * `generateReport` keeps its own check: it names the frozen scope statement
   * specifically and it has a test, and a rule worth having is worth having
   * twice.
   */
  const scopeStatement = (row.scope_statement ?? '').trim();
  if (scopeStatement.length < 100) {
    throw new Error(
      `Assessment ${assessmentId} has no frozen scope statement, so there is no report to ` +
        'assemble. A report without one states no limits, and we do not publish those.',
    );
  }

  if (row.overall_score === null) {
    throw new Error(
      `Assessment ${assessmentId} has no score, so there is no report to assemble. ` +
        'Printing 0 would read as "Not ready", which is a finding about the application ' +
        'rather than about the run.',
    );
  }

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
      group by f.id
      -- Ordered, because Postgres has no obligation to return rows the same
      -- way twice and this decides which three findings a free report shows.
      -- The finding_severity enum is declared critical-first, so its own order
      -- is the order a reader wants; the rule id and the primary key settle the
      -- ties, which same-rule findings produce constantly.
      order by f.severity, f.rubric_rule_id, f.id`,
    [assessmentId],
  );

  const runs = await client.query<RunRow>(
    `select stage, status, metadata from public.assessment_runs
      where assessment_id = $1
      order by started_at nulls last, stage`,
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

  /*
   * Where this score stands among other applications of the same kind.
   *
   * A `security definer` function, because a customer may not read another
   * organisation's assessments and nothing here changes that: what comes back
   * is a bare array of numbers, with no names, no identifiers and nothing that
   * could be joined back to an application.
   *
   * Best-effort. A report that fails to render because a comparison could not
   * be computed is a worse report than one without a comparison.
   */
  let peerScores: number[] = [];
  try {
    const peers = await client.query<{ scores: string[] | null }>(
      'select public.category_peer_scores($1) as scores',
      [assessmentId],
    );
    peerScores = (peers.rows[0]?.scores ?? []).map(Number).filter(Number.isFinite);
  } catch {
    peerScores = [];
  }

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
          overallScore: Number(row.overall_score),
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
    overallScore: Number(row.overall_score),
    band: bandFor(Number(row.overall_score)),
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
    comparison: compareToPeers({
      score: Number(row.overall_score),
      category: row.category ?? null,
      peerScores,
    }),
    /*
     * The engine's own record of what it did not answer.
     *
     * Rendered whatever it says and on every tier, for the same reason the
     * public tick list shows `not_tested` as prominently as a pass: a document
     * that quietly drops the questions it could not answer lets the reader
     * assume the missing line was fine, and that is the specific way an
     * assurance report misleads somebody.
     */
    notTested: row.not_tested ?? [],
    stages: runs.rows.map((run) => ({
      stage: run.stage,
      status: run.status,
      notes: run.metadata?.notes ?? [],
    })),
    scopeStatement,
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
