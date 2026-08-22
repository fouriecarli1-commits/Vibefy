/**
 * Seed helpers.
 *
 * These run as the database superuser, which bypasses row-level security — the
 * point of the tests is to check what an *authenticated customer* can see, so
 * the fixtures must be created outside those policies. Every trigger still
 * fires, so a fixture that the schema would refuse in production is refused here.
 */
import type { Client } from 'pg';
import { createHash, randomUUID } from 'node:crypto';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export interface SeededAccount {
  readonly userId: string;
  readonly organisationId: string;
  readonly email: string;
}

export async function seedRubric(client: Client, version = '1.0.0'): Promise<void> {
  await client.query(
    `insert into public.rubric_versions (version, definition, checksum, changelog, published_at, effective_from)
     values ($1, $2, $3, $4, now(), now())
     on conflict (version) do nothing`,
    [version, JSON.stringify({ version }), sha256(version), 'Test fixture'],
  );
}

export async function seedAccount(client: Client, label: string): Promise<SeededAccount> {
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const { rows } = await client.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [email, JSON.stringify({ full_name: label })],
  );
  const userId = rows[0]!.id;
  const org = await client.query<{ organisation_id: string }>(
    `select organisation_id from public.memberships where user_id = $1`,
    [userId],
  );
  return { userId, organisationId: org.rows[0]!.organisation_id, email };
}

export async function makeReviewer(client: Client, userId: string): Promise<void> {
  await client.query(`update public.users set platform_role = 'reviewer' where id = $1`, [userId]);
}

export async function seedApp(
  client: Client,
  account: SeededAccount,
  name = 'Test App',
): Promise<string> {
  const slug = `app-${randomUUID().slice(0, 8)}`;
  const { rows } = await client.query<{ id: string }>(
    `insert into public.apps (organisation_id, name, slug, app_type, primary_url, created_by)
     values ($1, $2, $3, 'web_url', $4, $5) returning id`,
    [account.organisationId, name, slug, `https://${slug}.example.test`, account.userId],
  );
  return rows[0]!.id;
}

export async function seedAuthorisation(
  client: Client,
  account: SeededAccount,
  appId: string,
  overrides: { status?: string; scopeDomains?: string[]; expiresAt?: string | null } = {},
): Promise<string> {
  const status = overrides.status ?? 'verified';
  const { rows } = await client.query<{ id: string }>(
    `insert into public.authorisations (
       app_id, organisation_id, status, method, verification_target, verified_at,
       scope_domains, warranty_text_version, warranty_text_sha256, granted_by, expires_at
     ) values ($1, $2, $3::text::public.authorisation_status, 'dns_txt', 'example.test',
       case when $3::text = 'verified' then now() else null end,
       $4, '1.0.0', $5, $6, $7)
     returning id`,
    [
      appId,
      account.organisationId,
      status,
      overrides.scopeDomains ?? ['example.test'],
      sha256('authorisation-warranty-1.0.0'),
      account.userId,
      overrides.expiresAt ?? null,
    ],
  );
  return rows[0]!.id;
}

export interface SeededAssessment {
  readonly assessmentId: string;
  readonly appId: string;
  readonly authorisationId: string;
}

export async function seedAssessment(
  client: Client,
  account: SeededAccount,
  options: { depth?: string } = {},
): Promise<SeededAssessment> {
  await seedRubric(client);
  const appId = await seedApp(client, account);
  const authorisationId = await seedAuthorisation(client, account, appId);
  const { rows } = await client.query<{ id: string }>(
    `insert into public.assessments (app_id, organisation_id, authorisation_id, rubric_version, depth, requested_by)
     values ($1, $2, $3, '1.0.0', $4, $5) returning id`,
    [appId, account.organisationId, authorisationId, options.depth ?? 'limited', account.userId],
  );
  return { assessmentId: rows[0]!.id, appId, authorisationId };
}

export async function seedFinding(
  client: Client,
  account: SeededAccount,
  assessmentId: string,
  overrides: {
    dimension?: string;
    severity?: string;
    confidence?: string;
    ruleId?: string;
    withEvidence?: boolean;
  } = {},
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.findings
       (assessment_id, organisation_id, dimension, severity, confidence, rubric_rule_id, title, description, remediation)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [
      assessmentId,
      account.organisationId,
      overrides.dimension ?? 'security_posture',
      overrides.severity ?? 'medium',
      overrides.confidence ?? 'high',
      overrides.ruleId ?? 'SEC-02',
      'Missing Content-Security-Policy header',
      'The application responds without a Content-Security-Policy header on any assessed route.',
      'Add a Content-Security-Policy header appropriate to the application, starting in report-only mode.',
    ],
  );
  const findingId = rows[0]!.id;

  if (overrides.withEvidence !== false) {
    await client.query(
      `insert into public.evidence (finding_id, assessment_id, organisation_id, kind, storage_path, sha256)
       values ($1, $2, $3, 'header_scan', $4, $5)`,
      [
        findingId,
        assessmentId,
        account.organisationId,
        `evidence/${findingId}.json`,
        sha256(findingId),
      ],
    );
  }
  return findingId;
}

/** Drives an assessment all the way to approved, through the human review gate. */
export async function approveAssessment(
  client: Client,
  account: SeededAccount,
  assessmentId: string,
  reviewerId: string,
  options: { certificationEligible?: boolean; score?: number } = {},
): Promise<void> {
  await client.query(`update public.assessments set status = 'awaiting_review' where id = $1`, [
    assessmentId,
  ]);
  await client.query(
    `insert into public.reviews (assessment_id, organisation_id, reviewer_id, action, reason)
     values ($1, $2, $3, 'approved', $4)`,
    [
      assessmentId,
      account.organisationId,
      reviewerId,
      'Findings and evidence checked against the rubric.',
    ],
  );
  await client.query(
    `update public.assessments
        set status = 'approved',
            certification_eligible = $2,
            overall_score = $3,
            reviewed_at = now()
      where id = $1`,
    [assessmentId, options.certificationEligible ?? true, options.score ?? 82.5],
  );
}

export async function acceptBadgeLicence(client: Client, account: SeededAccount): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.consents (user_id, organisation_id, document_type, document_version, document_sha256, action)
     values ($1, $2, 'badge_licence', '1.0.0', $3, 'accepted') returning id`,
    [account.userId, account.organisationId, sha256('badge-licence-1.0.0')],
  );
  return rows[0]!.id;
}

export async function issueBadge(
  client: Client,
  account: SeededAccount,
  input: { appId: string; assessmentId: string; consentId: string; expiresInMonths?: number },
): Promise<string> {
  const slug = `badge-${randomUUID().slice(0, 8)}`;
  const { rows } = await client.query<{ id: string }>(
    `insert into public.badges (
       app_id, organisation_id, assessment_id, slug, public_id, rubric_version, score,
       assessed_at, certified_origin, payload, signature, signing_key_id,
       licence_consent_id, expires_at
     ) values ($1, $2, $3, $4, $5, '1.0.0', 82.5, now(), $6, $7, $8, 'key-2026-01',
       $9, now() + make_interval(months => $10))
     returning id`,
    [
      input.appId,
      account.organisationId,
      input.assessmentId,
      slug,
      slug.replace(/-/g, '_') + '_publicid',
      'https://app.example.test',
      JSON.stringify({ slug, score: 82.5 }),
      'signature-placeholder',
      input.consentId,
      input.expiresInMonths ?? 12,
    ],
  );
  return rows[0]!.id;
}

export { sha256 };
