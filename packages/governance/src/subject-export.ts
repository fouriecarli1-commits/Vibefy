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
  readonly account: Record<string, unknown>;
  readonly memberships: readonly Record<string, unknown>[];
  readonly consents: readonly Record<string, unknown>[];
  readonly applications: readonly Record<string, unknown>[];
  /**
   * Decisions this person took to show an application on a public page.
   *
   * Each row is a moment somebody chose to publish something about their own
   * work, with their name against it. That is a record of an act by this
   * person, which makes it theirs to receive — the same reasoning that puts
   * consents in this export rather than leaving them to the workspace.
   */
  readonly publicationDecisions: readonly Record<string, unknown>[];
  readonly dataRequests: readonly Record<string, unknown>[];
  /**
   * Appeals this person submitted, and the answer they were given.
   *
   * The appeals policy promises *them* written reasons within fourteen days,
   * whether the appeal succeeds or not. A promise made to a person is a record
   * addressed to that person, which is the same reasoning that puts
   * `dataRequests` here.
   */
  readonly appeals: readonly Record<string, unknown>[];
  /**
   * The moment they accepted an authorisation-to-test warranty.
   *
   * Text version, hash, timestamp, IP and user agent — the same fields as a
   * consent and theirs for the same reason. The scope the authorisation grants
   * belongs to the workspace and is not here.
   */
  readonly authorisationsAccepted: readonly Record<string, unknown>[];
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
    category: 'The contents of a public page — a builder profile, or a trust page',
    reason:
      'The handle, the name shown, the line about the team and the contact details on a verification page belong to the workspace that publishes them, and every one of them is already public at its own address. The record of *who chose* to put an application on such a page is in this export, because that is an act by a person rather than a property of the page.',
  },
  {
    category: 'Analytics and behavioural records',
    reason: 'Not held. We do not record which pages you opened, which emails you read, or when.',
  },
  {
    category: 'Workspace and platform records that name you as the person who acted',
    reason:
      'A review decision, a workspace or policy profile you created, an invitation you sent, an assessment somebody requested, a badge or listing event, a spending pause somebody lifted: each is a record about a workspace resource that happens to say who acted. A workspace owner exports these from the workspace audit export. Handing them out here would disclose a colleague’s records, and an invitation carries somebody else’s email address.',
  },
  {
    category: 'Push notification device tokens',
    reason:
      'Held only while a device is signed in, and deleted when it signs out. The token is a key for sending to that device rather than anything about you — the same reasoning as a password hash: exporting it would tell you nothing you do not know and make one more copy of something worth stealing. Sign the device out to remove it, or ask and we will remove it for you.',
  },
  {
    category: 'Remediation worker assignments',
    reason:
      'Where you do remediation work for us, the record of which jobs you are assigned to is an operational record of ours rather than a profile of you. Ask and we will tell you what it says.',
  },
];

/**
 * Every table that holds a reference to a person, and where it ends up.
 *
 * `'exported'` means a query in `assembleSubjectExport` reads it. Anything else
 * is the `NOT_INCLUDED` category the person is shown instead.
 *
 * This map exists because the rule at the top of this file — "every export
 * names the categories that were considered and left out" — had nothing holding
 * it. Measured against the live schema: twenty-four tables carry a foreign key
 * to `public.users`, the export read six, and eighteen were neither read nor
 * covered by anything the person is told about. The rule was true of the
 * categories somebody had thought of.
 *
 * `tests/the-table-the-export-never-looked-at.test.ts` reads the foreign keys
 * from the database and fails on a table that is in neither column, so a table
 * added next month is accounted for deliberately or the suite says so.
 */
export const ACCOUNTED_FOR: Readonly<Record<string, string>> = {
  users: 'exported',
  memberships: 'exported',
  consents: 'exported',
  apps: 'exported',
  builder_profile_apps: 'exported',
  data_requests: 'exported',
  // Their own grounds, in their own words, and the written outcome the appeals
  // policy promises them. `data_requests` is exported for that reason and this
  // is the same shape.
  appeals: 'exported',
  // The acceptance record: text version, hash, timestamp, IP, user agent — the
  // same fields as a consent, exported for the same reason, and listed in the
  // Privacy Policy as held about this person for ten years. The scope of the
  // authorisation belongs to the workspace and is not here.
  authorisations: 'exported',
  // A decision about publication, which is what `publicationDecisions` is for.
  directory_listings: 'exported',

  audit_log: 'Workspace and platform records that name you as the person who acted',
  audit_exports: 'Workspace and platform records that name you as the person who acted',
  assessments: 'Assessment results, findings, reports and badges',
  assessment_requests: 'Assessment results, findings, reports and badges',
  reviews: 'Workspace and platform records that name you as the person who acted',
  badge_events: 'Workspace and platform records that name you as the person who acted',
  listing_events: 'Workspace and platform records that name you as the person who acted',
  invitations: 'Workspace and platform records that name you as the person who acted',
  organisations: 'Workspace and platform records that name you as the person who acted',
  policy_profiles: 'Workspace and platform records that name you as the person who acted',
  sso_connections: 'Workspace and platform records that name you as the person who acted',
  spend_pauses: 'Workspace and platform records that name you as the person who acted',
  sponsorships: 'Workspace and platform records that name you as the person who acted',
  device_tokens: 'Push notification device tokens',
  remediation_workers: 'Remediation worker assignments',
};

/** The tables a query in `assembleSubjectExport` reads. Held against the map above. */
export const EXPORTED_TABLES: readonly string[] = [
  'users',
  'memberships',
  'consents',
  'apps',
  'builder_profile_apps',
  'data_requests',
  'appeals',
  'authorisations',
  'directory_listings',
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
  '`publicationDecisions` is each time you chose to show one of your applications on',
  'a public page. The page itself is not here — it belongs to the workspace and it is',
  'already public — but the decision, with your name against it, is yours.',
  '',
  '`appeals` is any appeal you filed about an assessment, with your grounds and the',
  'written answer you were given. `authorisationsAccepted` is each time you accepted an',
  'authorisation-to-test warranty, with the version and hash of the text as it stood,',
  'so you can prove what you warranted the same way you can prove what you consented to.',
  '',
  '`notIncluded` lists what was considered and left out, and why. Read it. An export',
  'that silently omits a category looks complete, and leaves you with no way to know',
  'what to ask for next.',
].join('\n');

export class NoSuchSubjectError extends Error {
  constructor(subjectId: string) {
    super(
      `There is no account ${subjectId}, so there is nothing to export. An export assembled anyway would say every category is empty, which reads as "we hold nothing about you" rather than as "we looked up the wrong person" — and it would be handed over as the answer to a statutory request.`,
    );
    this.name = 'NoSuchSubjectError';
  }
}

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

  /*
   * No account, no subject.
   *
   * `account.rows[0] ?? null` assembled the export anyway, with every array
   * empty and `notIncluded` still listing what we deliberately left out — a
   * document that reads as "we hold nothing about you" and is handed over as the
   * answer to an access request. A platform admin can read every user, so the
   * only way this happens is that the id is wrong, and a wrong id is a mistake
   * to report rather than a fact to publish.
   *
   * It is the same rule as this file's second one, one step earlier: an export
   * that silently omits something looks complete. So does an export that omits
   * everything.
   */
  if (account.rows.length === 0) throw new NoSuchSubjectError(subjectId);

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

  const publicationDecisions = await sql.query<Record<string, unknown>>(
    // Not the page, which is the workspace's and is public anyway — the
    // decision, which is this person's and is not recorded anywhere else.
    // Both kinds of decision, because both are an act by this person and
    // neither is recorded anywhere else they can reach. Showing an application
    // on a builder profile was already here; taking one out of the public
    // directory is the same kind of act and was in no column of this export.
    `select 'shown on a builder profile' as decision,
            c.organisation_id, c.app_id, a.name as app_name, c.consented_at as decided_at
       from public.builder_profile_apps c
       join public.apps a on a.id = c.app_id
      where c.consented_by = $1
      union all
     select 'opted out of the public directory' as decision,
            d.organisation_id, d.app_id, a.name as app_name, d.opted_out_at as decided_at
       from public.directory_listings d
       join public.apps a on a.id = d.app_id
      where d.opted_out_by = $1
      order by decided_at`,
    [subjectId],
  );

  const dataRequests = await sql.query<Record<string, unknown>>(
    `select id, request_type, status, details, response, refusal_basis,
            due_at, completed_at, created_at
       from public.data_requests where user_id = $1
      order by created_at`,
    [subjectId],
  );

  const appeals = await sql.query<Record<string, unknown>>(
    // Their words and the answer they were given. The assessment the appeal is
    // about is not here — see `notIncluded`.
    `select id, status, grounds, resolution, due_at, resolved_at, created_at
       from public.appeals where submitted_by = $1
      order by created_at`,
    [subjectId],
  );

  const authorisationsAccepted = await sql.query<Record<string, unknown>>(
    // The acceptance, not the authorisation. `scope_domains`, `third_parties`
    // and the rest describe what the workspace authorised us to test and are
    // workspace records; these columns are the record of this person agreeing.
    `select a.id, p.name as app_name, a.method, a.warranty_text_version,
            a.warranty_text_sha256, a.accepted_ip::text as accepted_ip,
            a.accepted_user_agent, a.created_at
       from public.authorisations a
       join public.apps p on p.id = a.app_id
      where a.granted_by = $1
      order by a.created_at`,
    [subjectId],
  );

  return {
    exportVersion: SUBJECT_EXPORT_VERSION,
    assembledAt: now.toISOString(),
    subjectId,
    account: account.rows[0]!,
    memberships: memberships.rows,
    consents: consents.rows,
    applications: applications.rows,
    publicationDecisions: publicationDecisions.rows,
    dataRequests: dataRequests.rows,
    appeals: appeals.rows,
    authorisationsAccepted: authorisationsAccepted.rows,
    notIncluded: NOT_INCLUDED,
    readMe: READ_ME,
  };
}

/** A stable, human-legible filename. The date is the assembly date, not today's. */
export function subjectExportFilename(subjectExport: SubjectExport): string {
  return `vibefycode-data-export-${subjectExport.assembledAt.slice(0, 10)}.json`;
}
