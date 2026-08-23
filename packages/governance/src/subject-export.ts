/**
 * Assembling a person's own data, as a machine can read it.
 *
 * The access and portability rights are published in `REQUEST_KINDS` with a
 * precise promise: the account record, workspace memberships, every consent with
 * the version and hash of what was agreed to, and the applications submitted.
 * Until this existed, meeting that promise meant a reviewer running queries by
 * hand — which is the same shape of failure the whole product exists to find:
 * a stated commitment with no mechanism behind it.
 *
 * Two rules shape what goes in.
 *
 *   1. **The person's data, not their workspace's.** An assessment result
 *      belongs to the organisation that paid for it and is exported from the
 *      audit export instead. Handing one person a colleague's findings under
 *      the banner of a subject access request would be a disclosure, not a
 *      right — and `REQUEST_KINDS` says so in the words we are held to.
 *
 *   2. **What is there, and what is deliberately not.** Every export names the
 *      categories that were considered and left out, with the reason. An export
 *      that silently omits something looks complete, and the person has no way
 *      to know what to ask for next.
 *
 * And one rule about who may run it. Every query here reads under the caller's
 * own row-level security, and `consents` and `data_requests` are readable only
 * by the person themselves or a platform admin. A reviewer running this would
 * get an export with an empty `consents` array and no indication that anything
 * was missing — the silent omission this file's second rule exists to prevent.
 * So it refuses to assemble anything for a caller who is not a platform admin,
 * rather than quietly producing a partial answer to a statutory request.
 */

/** The smallest database surface this needs. `pg.PoolClient` satisfies it. */
export interface SqlExecutor {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

export const SUBJECT_EXPORT_VERSION = 1 as const;

export interface OmittedCategory {
  readonly category: string;
  readonly reason: string;
}

export interface SubjectExport {
  readonly exportVersion: typeof SUBJECT_EXPORT_VERSION;
  readonly assembledAt: string;
  readonly subjectId: string;
  readonly account: Record<string, unknown> | null;
  readonly memberships: readonly Record<string, unknown>[];
  readonly consents: readonly Record<string, unknown>[];
  readonly applications: readonly Record<string, unknown>[];
  readonly dataRequests: readonly Record<string, unknown>[];
  readonly notIncluded: readonly OmittedCategory[];
  /** Written to be read by the person, not by us. */
  readonly readMe: string;
}

/**
 * What was considered and left out, and why.
 *
 * This list is part of the answer, not a footnote to it. Each entry is either
 * "this is not yours to receive" or "we do not hold it" — and neither is a thing
 * we get to leave unsaid.
 */
export const NOT_INCLUDED: readonly OmittedCategory[] = [
  {
    category: 'Assessment results, findings, reports and badges',
    reason:
      'These belong to the workspace that commissioned them rather than to any one person. A workspace owner exports them from the workspace audit export. Handing them out under a personal request would disclose a colleague’s records.',
  },
  {
    category: 'Evidence artefacts — screenshots, traces, HTTP exchanges',
    reason:
      'Captures of a customer’s own application, held for thirty to ninety days and deleted on the retention schedule. They are workspace records, and they are not indexed by person.',
  },
  {
    category: 'Payment card details',
    reason: 'Never held. Card data goes to the payment provider and never touches our systems.',
  },
  {
    category: 'Passwords and authentication secrets',
    reason:
      'Held by the authentication service as hashes and never in a readable form. Exporting a hash would give you nothing you can use and one more copy of something worth stealing.',
  },
  {
    category: 'Analytics and behavioural records',
    reason: 'Not held. We do not record which pages you opened, which emails you read, or when.',
  },
];

const READ_ME = [
  'This is everything VibefyCode holds that is about you as a person.',
  '',
  'It is JSON so that another system can read it. Every timestamp is UTC.',
  '',
  '`consents` is the important one: each row names the document you agreed to, its',
  'version, and the SHA-256 hash of the exact text as it stood at that moment. That',
  'hash is how you can prove what you agreed to, rather than taking our word for it.',
  '',
  '`notIncluded` lists what was considered and left out, and why. Read it. An export',
  'that silently omits a category looks complete, and leaves you with no way to know',
  'what to ask for next.',
].join('\n');

export class NotPermittedToExportError extends Error {
  constructor() {
    super(
      'Assembling a data export requires a platform admin. A reviewer can read the account but not the consents, so what they would produce is a partial answer that looks like a complete one.',
    );
    this.name = 'NotPermittedToExportError';
  }
}

export async function assembleSubjectExport(
  sql: SqlExecutor,
  subjectId: string,
  now: Date = new Date(),
): Promise<SubjectExport> {
  // Asked of the database rather than of the caller. A guard the call site can
  // forget is a guard that will be forgotten.
  const permitted = await sql.query<{ ok: boolean }>('select public.is_platform_admin() as ok');
  if (permitted.rows[0]?.ok !== true) throw new NotPermittedToExportError();

  const account = await sql.query<Record<string, unknown>>(
    `select id, email::text as email, full_name, platform_role, alert_email_level,
            created_at, updated_at
       from public.users where id = $1`,
    [subjectId],
  );

  const memberships = await sql.query<Record<string, unknown>>(
    `select m.organisation_id, o.name as organisation_name, o.is_personal,
            m.role, m.created_at
       from public.memberships m
       join public.organisations o on o.id = m.organisation_id
      where m.user_id = $1
      order by m.created_at`,
    [subjectId],
  );

  const consents = await sql.query<Record<string, unknown>>(
    // The IP and user agent are in the row because they are evidence of the
    // acceptance, and they are about this person, so they are theirs to receive.
    `select document_type, document_version, document_sha256, action,
            ip::text as ip, user_agent, created_at
       from public.consents where user_id = $1
      order by created_at`,
    [subjectId],
  );

  const applications = await sql.query<Record<string, unknown>>(
    // Submitted by this person. The assessments of them are not here — see
    // `notIncluded`, and the promise in REQUEST_KINDS that this matches.
    `select id, organisation_id, name, slug, app_type, primary_url, description,
            intended_for_app_store, has_authentication, has_payments,
            processes_personal_data, screening_status, created_at
       from public.apps where created_by = $1
      order by created_at`,
    [subjectId],
  );

  const dataRequests = await sql.query<Record<string, unknown>>(
    `select id, request_type, status, details, response, refusal_basis,
            due_at, completed_at, created_at
       from public.data_requests where user_id = $1
      order by created_at`,
    [subjectId],
  );

  return {
    exportVersion: SUBJECT_EXPORT_VERSION,
    assembledAt: now.toISOString(),
    subjectId,
    account: account.rows[0] ?? null,
    memberships: memberships.rows,
    consents: consents.rows,
    applications: applications.rows,
    dataRequests: dataRequests.rows,
    notIncluded: NOT_INCLUDED,
    readMe: READ_ME,
  };
}

/** A stable, human-legible filename. The date is the assembly date, not today's. */
export function subjectExportFilename(subjectExport: SubjectExport): string {
  return `vibefycode-data-export-${subjectExport.assembledAt.slice(0, 10)}.json`;
}
