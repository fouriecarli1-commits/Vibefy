/**
 * Getting your records out.
 *
 * An organisation that has to answer to an auditor needs the evidence in a file,
 * not in our console. Six exports are offered, one per table that matters, each
 * scoped to one workspace and each recorded — the export itself is a disclosure,
 * and `audit_exports` is append-only so that a file produced in a dispute can be
 * checked against a hash we cannot have edited afterwards.
 *
 * Two things are deliberately not in any export: an IP address is truncated to
 * its network, and nobody's email address appears. The organisation already
 * knows who its own people are; a downloadable spreadsheet of staff addresses
 * and exact IPs is a breach waiting for somewhere to happen.
 */
import { createHash } from 'node:crypto';

export interface SqlExecutor {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

export type AuditExportKind =
  | 'assessments'
  | 'findings'
  | 'authorisations'
  | 'consents'
  | 'badge_events'
  | 'audit_log';

export type AuditExportFormat = 'csv' | 'json';

export const AUDIT_EXPORT_KINDS: Readonly<Record<AuditExportKind, string>> = {
  assessments: 'Every assessment, its score, its rubric version and when a human reviewed it',
  findings: 'Every published finding, with its dimension, severity and rule',
  authorisations: 'Every authorisation-to-test record, including withdrawals',
  consents: 'Every legal document accepted, with the version and hash of what was accepted',
  badge_events: 'Every badge issuance, suspension, reinstatement and revocation',
  audit_log: 'The append-only action log for this workspace',
};

/**
 * One query per kind, written out rather than generated.
 *
 * A generated `select *` would silently start exporting the next column somebody
 * adds — which is exactly how a personal-data column ends up in a customer's
 * spreadsheet without anyone deciding it should.
 */
const QUERIES: Readonly<Record<AuditExportKind, string>> = {
  assessments: `
    select a.id, app.name as app_name, app.primary_url, a.status, a.depth,
           a.rubric_version, a.overall_score, a.certification_eligible,
           a.gate_failures, a.created_at, a.completed_at, a.reviewed_at, a.published_at
      from public.assessments a
      join public.apps app on app.id = a.app_id
     where a.organisation_id = $1
       and a.created_at >= $2 and a.created_at < $3
     order by a.created_at`,
  findings: `
    select f.id, f.assessment_id, app.name as app_name, f.dimension, f.severity,
           f.confidence, f.rubric_rule_id, f.title, f.is_published, f.withheld_reason, f.created_at
      from public.findings f
      join public.assessments a on a.id = f.assessment_id
      join public.apps app on app.id = a.app_id
     where f.organisation_id = $1
       and f.created_at >= $2 and f.created_at < $3
     order by f.created_at`,
  authorisations: `
    select au.id, app.name as app_name, au.status, au.method, au.verification_target,
           au.scope_domains, au.scope_exclusions, au.warranty_text_version,
           au.warranty_text_sha256, au.supersedes_id, au.revocation_reason,
           host(network(set_masklen(au.accepted_ip::inet, 24))) as accepted_network,
           au.verified_at, au.expires_at, au.created_at
      from public.authorisations au
      join public.apps app on app.id = au.app_id
     where au.organisation_id = $1
       and au.created_at >= $2 and au.created_at < $3
     order by au.created_at`,
  consents: `
    select c.id, c.document_type, c.document_version, c.document_sha256, c.action,
           host(network(set_masklen(c.ip::inet, 24))) as accepted_network,
           c.occurred_at
      from public.consents c
     where c.organisation_id = $1
       and c.occurred_at >= $2 and c.occurred_at < $3
     order by c.occurred_at`,
  badge_events: `
    select be.id, b.slug, be.event_type, be.reason, be.observed_origin, be.occurred_at
      from public.badge_events be
      join public.badges b on b.id = be.badge_id
     where be.organisation_id = $1
       and be.occurred_at >= $2 and be.occurred_at < $3
     order by be.occurred_at`,
  audit_log: `
    select al.id, al.action, al.entity_type, al.entity_id, al.summary, al.actor_role, al.occurred_at
      from public.audit_log al
     where al.organisation_id = $1
       and al.occurred_at >= $2 and al.occurred_at < $3
     order by al.occurred_at`,
};

export function isAuditExportKind(value: string): value is AuditExportKind {
  return Object.hasOwn(QUERIES, value);
}

/** RFC 4180. A cell that starts with =, +, - or @ is prefixed, because a CSV that runs formulas is a vulnerability. */
export function toCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (Array.isArray(value)) text = value.join('; ');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: readonly Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const columns = Object.keys(rows[0]!);
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((column) => toCsvCell(row[column])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

export interface AuditExportRequest {
  readonly organisationId: string;
  readonly kind: AuditExportKind;
  readonly format?: AuditExportFormat;
  readonly periodStart?: Date | null;
  readonly periodEnd?: Date | null;
}

export interface AuditExportResult {
  readonly kind: AuditExportKind;
  readonly format: AuditExportFormat;
  readonly filename: string;
  readonly mediaType: string;
  readonly body: string;
  readonly rowCount: number;
  readonly sha256: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
}

/** Everything, if no period is given. An auditor asking for "all of it" should get all of it. */
const EPOCH = new Date('2020-01-01T00:00:00Z');

/**
 * Runs one export. The caller supplies the SQL executor, so the console runs it
 * under the requesting admin's own row-level security — a workspace cannot
 * export another workspace's records even if this function is asked to.
 */
export async function runAuditExport(
  client: SqlExecutor,
  request: AuditExportRequest,
): Promise<AuditExportResult> {
  const format = request.format ?? 'csv';
  const periodStart = request.periodStart ?? EPOCH;
  const periodEnd = request.periodEnd ?? new Date(Date.now() + 60_000);

  const { rows } = await client.query<Record<string, unknown>>(QUERIES[request.kind], [
    request.organisationId,
    periodStart.toISOString(),
    periodEnd.toISOString(),
  ]);

  const body = format === 'csv' ? toCsv(rows) : `${JSON.stringify(rows, null, 2)}\n`;
  const stamp = periodEnd.toISOString().slice(0, 10);

  return {
    kind: request.kind,
    format,
    filename: `vibefy-${request.kind}-${stamp}.${format}`,
    mediaType: format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
    body,
    rowCount: rows.length,
    sha256: createHash('sha256').update(body, 'utf8').digest('hex'),
    periodStart,
    periodEnd,
  };
}

/** Records that the export happened. Append-only on the database side. */
export async function recordAuditExport(
  client: SqlExecutor,
  input: {
    organisationId: string;
    requestedBy: string | null;
    result: AuditExportResult;
  },
): Promise<void> {
  await client.query(
    `insert into public.audit_exports
       (organisation_id, requested_by, kind, format, row_count, sha256, period_start, period_end)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.organisationId,
      input.requestedBy,
      input.result.kind,
      input.result.format,
      input.result.rowCount,
      input.result.sha256,
      input.result.periodStart.toISOString(),
      input.result.periodEnd.toISOString(),
    ],
  );
}
