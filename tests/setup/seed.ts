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

/**
 * A rubric version for a fixture to point at.
 *
 * The real ones — the versions the scoring code knows — come from migrations,
 * and `on conflict do nothing` leaves those exactly as published. Anything else
 * is invented by a test, and is inserted as a *historical* version: dated well
 * in the past and already superseded.
 *
 * That is not tidiness. "Which rubric is in force" is a single global fact
 * computed as the latest effective version that is not superseded, and this
 * used to insert fixtures as effective *now* — so one test reaching for a
 * throwaway version like 9.9.9 silently made it the standard in force for every
 * other test in the run, in every other file. A test-only version is by
 * definition not what the engine scores against, and now it cannot claim to be.
 */
export async function seedRubric(client: Client, version = '1.0.0'): Promise<void> {
  await client.query(
    `insert into public.rubric_versions (version, definition, checksum, changelog, published_at, effective_from, superseded_at)
     values ($1, $2, $3, $4, now() - interval '10 years', now() - interval '10 years',
             now() - interval '10 years')
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

/**
 * An application that has been through intake screening and cleared.
 *
 * `screening_status` defaults to `pending` in the schema, and a pending
 * application is one no assessment may run against — a reviewer looks at every
 * submission first. Almost every fixture here wants an application that is past
 * that point, so this seeds one, and a test about the gate itself says
 * `screening: 'pending'` and means it.
 */
export async function seedApp(
  client: Client,
  account: SeededAccount,
  name = 'Test App',
  options: {
    screening?: 'pending' | 'cleared' | 'refused';
    /** A repository the app declares, for the half of an assessment that reads source. */
    repositoryUrl?: string;
  } = {},
): Promise<string> {
  const slug = `app-${randomUUID().slice(0, 8)}`;
  const { rows } = await client.query<{ id: string }>(
    `insert into public.apps
       (organisation_id, name, slug, app_type, primary_url, repository_url, created_by,
        screening_status, screening_notes, screened_at)
     values ($1, $2, $3, 'web_url', $4, $5, $6, $7::public.screening_status,
             'Seeded fixture: cleared so the test can get to what it is about.', now())
     returning id`,
    [
      account.organisationId,
      name,
      slug,
      `https://${slug}.example.test`,
      options.repositoryUrl ?? null,
      account.userId,
      options.screening ?? 'cleared',
    ],
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
  options: {
    depth?: string;
    /** Reuse an existing application, so a test can build a history on one app. */
    appId?: string;
    authorisationId?: string;
    rubricVersion?: string;
  } = {},
): Promise<SeededAssessment> {
  const rubricVersion = options.rubricVersion ?? '1.0.0';
  await seedRubric(client, rubricVersion);
  const appId = options.appId ?? (await seedApp(client, account));
  const authorisationId =
    options.authorisationId ?? (await seedAuthorisation(client, account, appId));
  const { rows } = await client.query<{ id: string }>(
    `insert into public.assessments (app_id, organisation_id, authorisation_id, rubric_version, depth, requested_by)
     values ($1, $2, $3, $6, $4, $5) returning id`,
    [
      appId,
      account.organisationId,
      authorisationId,
      options.depth ?? 'limited',
      account.userId,
      rubricVersion,
    ],
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
    title?: string;
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
      overrides.title ?? 'Missing Content-Security-Policy header',
      'The application responds without a Content-Security-Policy header on any assessed route.',
      'Add a Content-Security-Policy header appropriate to the application, starting in report-only mode.',
    ],
  );
  const findingId = rows[0]!.id;

  if (overrides.withEvidence !== false) {
    const evidence = await client.query<{ id: string }>(
      `insert into public.evidence (assessment_id, organisation_id, kind, storage_path, sha256)
       values ($1, $2, 'header_scan', $3, $4) returning id`,
      [assessmentId, account.organisationId, `evidence/${findingId}.json`, sha256(findingId)],
    );
    await client.query(
      `insert into public.finding_evidence (finding_id, evidence_id, organisation_id)
       values ($1, $2, $3)`,
      [findingId, evidence.rows[0]!.id, account.organisationId],
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
     ) values ($1, $2, $3, $4, $5,
       -- Read from the assessment rather than written here: the database
       -- refuses a badge whose rubric version differs from the one the
       -- assessment was scored against, and a literal is a fixture that breaks
       -- the first time a test needs a different version.
       (select rubric_version from public.assessments where id = $3),
       82.5, now(), $6, $7, $8, 'key-2026-01',
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

/**
 * An application with a live badge, ready to have its verification page opened.
 *
 * Exists because the page a stranger actually lands on could not be
 * accessibility-scanned: it needs a real issued badge to render, so the crawl
 * had no URL to visit and the one page the whole product points outsiders at
 * was the one page nobody checked.
 *
 * It seeds the harder version of the page on purpose — a published finding so
 * the assurance list renders its "something was found" branch, and an exit
 * measurement so that panel renders too. A scan of the emptiest possible page
 * proves the least.
 */
export async function seedBadgedApp(
  client: Client,
  label = 'a11y',
): Promise<{ slug: string; appId: string; assessmentId: string }> {
  const owner = await seedAccount(client, label);
  const reviewer = await seedAccount(client, `${label}-reviewer`);
  await makeReviewer(client, reviewer.userId);

  const { assessmentId, appId } = await seedAssessment(client, owner, { depth: 'full' });
  await seedFinding(client, owner, assessmentId, {
    dimension: 'practicality_ux',
    ruleId: 'UX-02',
    severity: 'medium',
  });
  await client.query(`update public.assessments set exit_measurement = $2 where id = $1`, [
    assessmentId,
    JSON.stringify({
      routeFound: true,
      selfService: false,
      plainlyNamed: false,
      clicksToCancel: 3,
      clicksToSubscribe: 1,
      score: {
        percentage: 50,
        band: 'Hard',
        components: [
          {
            id: 'routeFound',
            label: 'There is a way to cancel that a visitor can find',
            weight: 40,
            earned: 40,
            detail: 'A route to cancelling was found on the public site.',
          },
          {
            id: 'selfService',
            label: 'You can do it yourself',
            weight: 25,
            earned: 0,
            detail: 'The route ends in asking a person to cancel for you.',
          },
          {
            id: 'symmetry',
            label: 'Leaving is no harder to reach than joining',
            weight: 20,
            earned: 10,
            detail: '1 click to join and 3 to reach the way out.',
          },
          {
            id: 'plainlyNamed',
            label: 'It is called what it is',
            weight: 15,
            earned: 0,
            detail: 'The route is named something other than cancelling.',
          },
        ],
      },
    }),
  ]);

  await approveAssessment(client, owner, assessmentId, reviewer.userId, { score: 82.4 });
  const consentId = await acceptBadgeLicence(client, owner);
  await issueBadge(client, owner, { appId, assessmentId, consentId });

  const { rows } = await client.query<{ slug: string }>(
    `select slug from public.badges where app_id = $1 order by issued_at desc limit 1`,
    [appId],
  );
  return { slug: rows[0]!.slug, appId, assessmentId };
}

/**
 * A published builder profile with one badged application on it.
 *
 * Used by the accessibility scan, which cannot visit `/b/<handle>` until a
 * profile exists — the same problem the verification page has, and the same
 * answer. Returns the handle so the scanner can build the address.
 */
export async function seedBuilderProfile(
  client: Client,
  label = 'a11y-profile',
): Promise<{ handle: string; appId: string }> {
  const { appId } = await seedBadgedApp(client, label);
  const { rows } = await client.query<{ organisation_id: string; created_by: string }>(
    'select organisation_id, created_by from public.apps where id = $1',
    [appId],
  );
  const app = rows[0]!;
  const handle = `builder-${randomUUID().slice(0, 8)}`;

  await client.query(
    `insert into public.builder_profiles (organisation_id, handle, display_name, tagline, published)
     values ($1, $2, 'A Builder', 'Builds things, has them checked.', true)`,
    [app.organisation_id, handle],
  );
  await client.query(
    `insert into public.builder_profile_apps (organisation_id, app_id, consented_by)
     values ($1, $2, $3)`,
    [app.organisation_id, appId, app.created_by],
  );

  return { handle, appId };
}

/**
 * A published trust page for a seeded badge.
 *
 * The verification page renders the owner's own section only when one exists,
 * so without this the branch is never loaded by anything — and a section that
 * has never been rendered is a section nobody has checked for contrast, for a
 * heading level, or for whether it reads as ours.
 */
export async function seedTrustPage(client: Client, appId: string): Promise<void> {
  const { rows } = await client.query<{ organisation_id: string }>(
    'select organisation_id from public.apps where id = $1',
    [appId],
  );
  await client.query(
    `insert into public.trust_pages
       (app_id, organisation_id, contact_email, security_contact, status_url,
        privacy_url, terms_url, note, published)
     values ($1, $2, 'help@kettle.example', 'security@kettle.example',
             'https://status.kettle.example', 'https://kettle.example/privacy',
             'https://kettle.example/terms',
             'We answer within one working day, and we are a team of two.', true)
     on conflict (app_id) do update set published = true`,
    [appId, rows[0]!.organisation_id],
  );
}
