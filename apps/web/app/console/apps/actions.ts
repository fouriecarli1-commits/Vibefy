'use server';

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import {
  createChallenge,
  permittedScopeFor,
  screenIntake,
  verifyOwnership,
} from '@vibefycode/engine/authorisation';
import { RepositoryRefusedError, repositoryUrlOrRefuse } from '@vibefycode/engine';
import { decideAssessmentRequest, resolvePlan } from '@vibefycode/billing';
import { checkClaim } from '@vibefycode/shared';
import { createClient } from '@/lib/supabase/server';
import { readAsUser, writeAsService } from '@/lib/sql';

/**
 * The version and exact bytes of a legal document, at the moment it is accepted.
 * The hash goes into the consent record so that "which words did they agree to"
 * stays answerable years later, even if the file is edited.
 */
function documentFingerprint(file: string): { version: string; sha256: string } {
  const contents = readFileSync(join(process.cwd(), '..', '..', 'legal', file), 'utf8');
  return {
    version: /\*\*Version:\*\*\s*([^\s·]+)/.exec(contents)?.[1] ?? '0.0.0',
    sha256: createHash('sha256').update(contents).digest('hex'),
  };
}

async function requestContext() {
  const headerList = await headers();
  return {
    ip: headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: headerList.get('user-agent'),
  };
}

export interface ActionState {
  readonly error?: string;
  readonly notice?: string;
}

/**
 * Intake. Screening runs before the app row exists in any usable state — a
 * submission that falls under the Acceptable Use Policy is recorded as refused
 * with its stated ground, not quietly dropped.
 */
export async function createApp(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You are signed out.' };

  const name = String(formData.get('name') ?? '').trim();
  const primaryUrl = String(formData.get('primaryUrl') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  const organisationId = String(formData.get('organisationId') ?? '');

  if (!name || !primaryUrl || !organisationId) {
    return { error: 'Name, URL and workspace are all required.' };
  }
  if (!/^https:\/\//i.test(primaryUrl)) {
    return {
      error: 'The URL must start with https://. We do not assess applications over plain HTTP.',
    };
  }

  // Checked here with the same function the runner uses, so a repository the
  // console accepts is one the clone will take. Accepting it now and failing
  // in the runner an hour later would tell the customer their source was
  // assessed when it was not.
  const repositoryUrl = String(formData.get('repositoryUrl') ?? '').trim();
  if (repositoryUrl) {
    try {
      repositoryUrlOrRefuse(repositoryUrl);
    } catch (error) {
      return {
        error:
          error instanceof RepositoryRefusedError
            ? `That repository cannot be read: ${error.reason}. Public repositories on GitHub, GitLab, Bitbucket, Codeberg or sr.ht, over https, with no credentials in the address.`
            : 'That repository address could not be read.',
      };
    }
  }

  const screening = await screenIntake({
    appName: name,
    description,
    category: String(formData.get('category') ?? '') || null,
    targetAudience: String(formData.get('targetAudience') ?? '') || null,
    primaryUrl,
  });

  const slug = `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'app'
  }-${Math.random().toString(36).slice(2, 7)}`;

  const { data, error } = await supabase
    .from('apps')
    .insert({
      organisation_id: organisationId,
      name,
      slug,
      app_type: 'web_url',
      primary_url: primaryUrl,
      repository_url: repositoryUrl || null,
      description: description || null,
      category: String(formData.get('category') ?? '') || null,
      builder: String(formData.get('builder') ?? '') || null,
      target_audience: String(formData.get('targetAudience') ?? '') || null,
      processes_personal_data: formData.get('processesPersonalData') === 'on',
      has_authentication: formData.get('hasAuthentication') === 'on',
      has_payments: formData.get('hasPayments') === 'on',
      intended_for_app_store: formData.get('intendedForAppStore') === 'on',
      // Changes which stage runs and what it looks for. It changes nothing
      // about the rubric, the score or the badge — a game is held to the same
      // published criteria as everything else.
      is_game: formData.get('isGame') === 'on',
      created_by: user.id,
    })
    .select('id')
    .single();

  if (error) return { error: error.message };

  /*
   * The verdict, written by us rather than by the account it is about.
   *
   * This insert used to carry `screening_status`, `screening_notes` and
   * `screened_at`, which meant the Acceptable Use verdict was written by the
   * customer's own access token. Measured against a refused application, as a
   * workspace owner and nothing else: `update public.apps set screening_status
   * = 'cleared'` returned `UPDATE 1`. `screening_status` is the gate
   * `run-assessment.ts` reads before anything runs, so that was the path by
   * which a refused application gets assessed, scored and badged.
   *
   * `20261008030000` revokes those three columns from `authenticated`, so the
   * insert above now gets the default — `pending`, which is where an
   * unscreened submission belongs — and the verdict goes in here, on the
   * owner's connection, through the same kind of door the worker's sweep and
   * the reviewer already use.
   *
   * Not fatal if it fails. The application exists and is `pending`, which
   * means a reviewer sees it at /review/screening and nothing runs against it
   * until they do, which is the side of the gate to fail towards. Saying so is
   * still worth a line
   * in the log, because an intake screen that silently stops recording its
   * reasoning leaves every reviewer reading an empty note.
   */
  const verdict =
    screening.verdict === 'refused'
      ? 'refused'
      : screening.verdict === 'cleared'
        ? 'cleared'
        : 'pending';
  try {
    await writeAsService(async (client) => {
      await client.query('select public.record_intake_screening($1, $2, $3)', [
        data.id,
        verdict,
        `${screening.verdict} (${screening.source}, ${screening.confidence} confidence): ${screening.reasoning}`,
      ]);
    });
  } catch (screeningError) {
    console.error('intake screening was not recorded', {
      appId: data.id,
      verdict,
      error: screeningError instanceof Error ? screeningError.message : String(screeningError),
    });
  }

  /*
   * The refusal is logged by the database, inside the call above.
   *
   * It used to be logged here, and it was not: the insert ran as the customer,
   * the only insert policy on `audit_log` requires `is_platform_admin()`, and
   * the result was discarded. So row-level security refused it every time from
   * the day the admin console landed, and the comment above it said "Refusals
   * are logged with their ground, per the Acceptable Use Policy" while no
   * refusal at intake was being recorded at all.
   *
   * The table is right to be closed — a log its subject may write into is not
   * evidence — so the writer moved rather than the policy. It moved twice:
   * first to `apps_refusal_at_intake_is_written_down`, a trigger on an insert
   * that arrived already refused, and now to `record_intake_screening`, which
   * writes the same entry from the same sentence the customer is shown. The
   * trigger is still there and still correct; the insert above no longer
   * reaches it, because a customer may no longer write that column at all.
   */

  redirect(`/console/apps/${data.id}`);
}

/**
 * Step one of authorisation: the customer accepts the warranty and declares a
 * scope. This writes a *pending* authorisation carrying the ownership challenge.
 * Nothing may be tested against it yet.
 */
export async function startAuthorisation(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You are signed out.' };

  const appId = String(formData.get('appId') ?? '');
  if (formData.get('accepted') !== 'on') {
    return {
      error: 'The authorisation warranty has to be accepted before anything can be tested.',
    };
  }

  const { data: app, error: appError } = await supabase
    .from('apps')
    .select('id, organisation_id, primary_url, repository_url, screening_status')
    .eq('id', appId)
    .single();
  if (appError || !app) return { error: appError?.message ?? 'App not found.' };
  if (app.screening_status === 'refused') {
    return {
      error:
        'This application was refused under the Acceptable Use Policy. Appeal it rather than re-submitting.',
    };
  }

  /*
   * The repository, declared here rather than only at sign-up.
   *
   * It belongs in this form because this is the act it has to be part of: a
   * domain is proved by a DNS record and a public repository cannot be, so what
   * stands in its place is that the customer named it in the same breath as
   * accepting the warranty. It also means an application registered before any
   * of this existed can add one without starting again.
   */
  const declaredRepository =
    String(formData.get('repositoryUrl') ?? '').trim() ||
    ((app.repository_url as string | null) ?? '');
  if (declaredRepository) {
    try {
      repositoryUrlOrRefuse(declaredRepository);
    } catch (repositoryError) {
      return {
        error:
          repositoryError instanceof RepositoryRefusedError
            ? `That repository cannot be read: ${repositoryError.reason}. Public repositories on GitHub, GitLab, Bitbucket, Codeberg or sr.ht, over https, with no credentials in the address.`
            : 'That repository address could not be read.',
      };
    }
  }

  const host = new URL(app.primary_url as string).hostname;
  const challenge = createChallenge(host);
  const warranty = documentFingerprint('authorisation-to-test.md');
  const { ip, userAgent } = await requestContext();

  const declared = String(formData.get('scopeDomains') ?? host)
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const { allowed, refused } = permittedScopeFor(host, declared.length > 0 ? declared : [host]);

  const { error } = await supabase.from('authorisations').insert({
    app_id: app.id,
    organisation_id: app.organisation_id,
    status: 'pending',
    method: 'dns_txt',
    verification_token: challenge.token,
    verification_target: host,
    scope_domains: allowed,
    // Copied onto the authorisation, beside the hash of the words they
    // accepted. A domain is proved by a DNS record; a public repository cannot
    // be, so what stands in its place is that they declared it at the moment
    // they accepted the warranty. Changing it on the app afterwards does not
    // widen what we read.
    repository_url: declaredRepository || null,
    scope_exclusions: String(formData.get('exclusions') ?? '')
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
    third_parties: String(formData.get('thirdParties') ?? '')
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
    warranty_text_version: warranty.version,
    warranty_text_sha256: warranty.sha256,
    granted_by: user.id,
    accepted_ip: ip,
    accepted_user_agent: userAgent,
  });

  if (error) return { error: error.message };

  await supabase.from('consents').insert({
    user_id: user.id,
    organisation_id: app.organisation_id,
    document_type: 'authorisation_to_test',
    document_version: warranty.version,
    document_sha256: warranty.sha256,
    action: 'accepted',
    ip,
    user_agent: userAgent,
  });

  revalidatePath(`/console/apps/${appId}`);
  return {
    notice:
      refused.length > 0
        ? `Authorisation recorded. ${refused.join(', ')} ${refused.length === 1 ? 'was' : 'were'} removed from the scope: you can only authorise testing of the host you verify, its subdomains, and — when you verify a www host — the domain it sits on. To cover other subdomains, verify the domain itself rather than the www host.`
        : 'Authorisation recorded. Publish the challenge below, then verify.',
  };
}

/** Step two: check the challenge and, if it holds, write a verified authorisation. */
export async function verifyAuthorisation(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You are signed out.' };

  const appId = String(formData.get('appId') ?? '');
  const { data: pending, error } = await supabase
    .from('authorisations')
    .select('*')
    .eq('app_id', appId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !pending) return { error: error?.message ?? 'No authorisation to verify.' };
  if (pending.status === 'verified') return { notice: 'This application is already verified.' };

  /*
   * Who may grant one, asked as the caller.
   *
   * The row below is written on our own connection, because
   * `authorisations_are_verified_by_us` refuses a `verified` row from any role
   * a browser can reach — so the authority check that used to be the insert
   * policy's job has to be made here instead. It is the policy's own
   * predicate, evaluated against this request's claims, which is the nearest
   * thing to leaving it where it was.
   */
  const mayGrant = await readAsUser(user.id, async (client) => {
    const { rows } = await client.query<{ ok: boolean }>(
      `select public.has_org_role($1, array['owner', 'admin']::public.org_role[]) as ok`,
      [pending.organisation_id],
    );
    return rows[0]?.ok === true;
  });
  if (!mayGrant) {
    return { error: 'Only an owner or an admin of this workspace can authorise testing.' };
  }

  const outcome = await verifyOwnership(
    pending.verification_target as string,
    pending.verification_token as string,
  );
  if (!outcome.verified) return { error: outcome.detail };

  /*
   * The scope, re-derived from the host that was just proved.
   *
   * This carried `pending.scope_domains` forward unchanged, which was fine as
   * long as the pending row could only have come from the form — where step
   * one runs the same filter. It could not: a pending row written straight
   * through PostgREST could name a target the customer does own and a scope
   * they do not, and pressing Verify would then carry the forged scope into a
   * properly verified row. `authorisations_scope_within_verified_target` now
   * refuses such a row outright; this is the half that keeps the refusal from
   * being the first time anybody notices.
   */
  const { allowed } = permittedScopeFor(
    pending.verification_target as string,
    (pending.scope_domains as string[] | null) ?? [],
  );
  if (allowed.length === 0) {
    return {
      error:
        'None of the domains on this authorisation is covered by the host that was verified. Start the authorisation again and declare the host you proved, or a subdomain of it.',
    };
  }

  const { ip, userAgent } = await requestContext();
  const { error: insertError } = await writeAsService(async (client) => {
    try {
      await client.query(
        `insert into public.authorisations
           (app_id, organisation_id, supersedes_id, status, method, verification_token,
            verification_target, verified_at, scope_domains, scope_exclusions, third_parties,
            repository_url, warranty_text_version, warranty_text_sha256, granted_by,
            accepted_ip, accepted_user_agent, expires_at)
         values ($1, $2, $3, 'verified', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                 $16, now() + interval '365 days')`,
        [
          appId,
          pending.organisation_id,
          pending.id,
          outcome.method,
          pending.verification_token,
          pending.verification_target,
          outcome.checkedAt,
          allowed,
          pending.scope_exclusions ?? [],
          pending.third_parties ?? [],
          // Carried forward with the rest of the scope. The verified row
          // supersedes the pending one and is the row the runner reads, so
          // leaving this behind would authorise the domain and quietly drop
          // the repository — the static stage would then say the authorisation
          // does not cover a repository the customer had declared and accepted
          // the warranty for.
          pending.repository_url,
          pending.warranty_text_version,
          pending.warranty_text_sha256,
          user.id,
          ip,
          userAgent,
        ],
      );
      return { error: null as string | null };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : String(cause) };
    }
  });

  if (insertError) return { error: insertError };

  revalidatePath(`/console/apps/${appId}`);
  return { notice: `Verified — ${outcome.detail}` };
}

/** Withdrawal. Immediate, and recorded as a new row rather than an edit. */
export async function revokeAuthorisation(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You are signed out.' };

  const appId = String(formData.get('appId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (reason.length < 10)
    return { error: 'Please say why, in a sentence. The record is permanent.' };

  const { data: current, error } = await supabase
    .from('authorisations')
    .select('*')
    .eq('app_id', appId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error || !current) return { error: error?.message ?? 'No authorisation to withdraw.' };

  const { ip, userAgent } = await requestContext();
  const { error: insertError } = await supabase.from('authorisations').insert({
    app_id: appId,
    organisation_id: current.organisation_id,
    supersedes_id: current.id,
    status: 'revoked',
    method: current.method,
    scope_domains: [],
    scope_exclusions: current.scope_exclusions,
    warranty_text_version: current.warranty_text_version,
    warranty_text_sha256: current.warranty_text_sha256,
    granted_by: user.id,
    accepted_ip: ip,
    accepted_user_agent: userAgent,
    revocation_reason: reason,
  });

  if (insertError) return { error: insertError.message };

  revalidatePath(`/console/apps/${appId}`);
  return { notice: 'Authorisation withdrawn. Any run in flight stops, and no new run will start.' };
}

/**
 * Requesting an assessment.
 *
 * The entitlement decision is made here, recorded on the request row, and then
 * acted on — rather than recomputed later from a plan that may since have
 * changed. A refusal is stored with its reason so the customer can be told
 * exactly why, and so we can answer the same question in six months.
 *
 * Nothing here starts an assessment. It puts a row in a queue the customer can
 * watch; the worker does the rest, and re-checks the authorisation gate before
 * it does anything at all.
 */
export async function requestAssessment(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You are signed out.' };

  const appId = String(formData.get('appId') ?? '');

  const decision = await readAsUser(user.id, async (client) => {
    const app = await client.query<{
      organisation_id: string;
      screening_status: string;
      authorised: boolean;
    }>(
      `select a.organisation_id, a.screening_status,
              public.app_is_authorised_for_testing(a.id) as authorised
         from public.apps a where a.id = $1`,
      [appId],
    );
    const row = app.rows[0];
    if (!row) return null;

    const plan = await resolvePlan(client, { organisationId: row.organisation_id, appId });

    const history = await client.query<{ completed_at: string; paid: boolean }>(
      `select a.completed_at,
              exists (
                select 1 from public.invoices i
                 where i.app_id = $1 and i.status = 'paid'
                   and i.paid_at <= a.completed_at
              ) as paid
         from public.assessments a
        where a.app_id = $1 and a.completed_at is not null
        order by a.completed_at desc
        limit 10`,
      [appId],
    );

    const appCount = await client.query<{ n: number }>(
      `select count(*)::int as n from public.apps
        where organisation_id = $1 and archived_at is null`,
      [row.organisation_id],
    );

    const subscription = await client.query<{ status: string }>(
      `select status from public.subscriptions where organisation_id = $1
        order by case status when 'active' then 0 else 1 end limit 1`,
      [row.organisation_id],
    );

    return {
      organisationId: row.organisation_id,
      screening: row.screening_status,
      plan,
      verdict: decideAssessmentRequest({
        plan: plan.plan,
        subscriptionStatus: (subscription.rows[0]?.status ?? null) as never,
        appsInWorkspace: appCount.rows[0]?.n ?? 1,
        previousAssessments: history.rows.map((entry) => ({
          completedAt: new Date(entry.completed_at),
          paid: entry.paid,
        })),
        appIsAuthorised: row.authorised === true,
      }),
    };
  });

  if (!decision) return { error: 'Application not found.' };
  if (decision.screening === 'refused') {
    return {
      error:
        'This application was refused under the Acceptable Use Policy. Appeal it rather than re-submitting.',
    };
  }
  if (decision.screening === 'pending') {
    return {
      error:
        'This application is waiting on its human check. A reviewer looks at every submission before an assessment runs — you will see the outcome on this page.',
    };
  }

  const { verdict, plan } = decision;

  if (!verdict.allowed) {
    // The refusal is recorded, not just returned: a customer who asks why in six
    // months deserves the same answer they were given today.
    await supabase.from('assessment_requests').insert({
      app_id: appId,
      organisation_id: decision.organisationId,
      requested_by: user.id,
      depth: verdict.depth,
      status: 'refused',
      plan_at_request: plan.plan,
      max_run_cost_usd: verdict.maxRunCostUsd,
      refusal_code: verdict.refusal?.code,
      refusal_message: verdict.refusal?.message,
    });
    return { error: verdict.refusal?.message ?? 'This assessment cannot run right now.' };
  }

  const { error } = await supabase.from('assessment_requests').insert({
    app_id: appId,
    organisation_id: decision.organisationId,
    requested_by: user.id,
    depth: verdict.depth,
    plan_at_request: plan.plan,
    uses_retest_credit: verdict.usesReTestCredit,
    max_run_cost_usd: verdict.maxRunCostUsd,
  });

  if (error) {
    return {
      error: error.message.includes('one_live_per_app')
        ? 'An assessment of this application is already queued or running.'
        : error.message,
    };
  }

  revalidatePath(`/console/apps/${appId}`);
  return {
    notice: verdict.usesReTestCredit
      ? `Queued as a ${verdict.depth} assessment, using one of your free re-tests.`
      : `Queued as a ${verdict.depth} assessment. ${plan.because}`,
  };
}

/**
 * Accepting the Badge Licence.
 *
 * The last of the three things that must be true before a badge exists: a human
 * approved the assessment, the rubric gate passed, and the owner accepted the
 * trademark licence. Acceptance is recorded append-only with the version, a hash
 * of the exact wording, the time, the IP and the user agent — the same evidence
 * standard as the authorisation warranty, because the same kind of dispute is
 * possible.
 *
 * Nothing here issues a badge. The worker does that, because it holds the
 * signing key and the console deliberately does not.
 */
export async function acceptBadgeLicence(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You are signed out.' };

  const appId = String(formData.get('appId') ?? '');
  if (formData.get('accepted') !== 'on') {
    return { error: 'The Badge Licence has to be accepted before a badge can be issued.' };
  }

  const { data: app } = await supabase
    .from('apps')
    .select('id, organisation_id')
    .eq('id', appId)
    .single();
  if (!app) return { error: 'Application not found.' };

  const membership = await supabase
    .from('memberships')
    .select('role')
    .eq('organisation_id', app.organisation_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership.data || !['owner', 'admin'].includes(String(membership.data.role))) {
    return {
      error: 'Only an owner or an admin can accept a trademark licence for this workspace.',
    };
  }

  const licence = documentFingerprint('badge-licence.md');
  const { ip, userAgent } = await requestContext();

  const { error } = await supabase.from('consents').insert({
    user_id: user.id,
    organisation_id: app.organisation_id,
    document_type: 'badge_licence',
    document_version: licence.version,
    document_sha256: licence.sha256,
    action: 'accepted',
    ip,
    user_agent: userAgent,
  });
  if (error) return { error: error.message };

  revalidatePath(`/console/apps/${appId}`);
  return {
    notice:
      'Licence accepted. Your badge is issued shortly — the process that signs badges runs separately from the console, which is deliberate: it holds the signing key and the console never does.',
  };
}

// ---------------------------------------------------------------------------
// The public directory
// ---------------------------------------------------------------------------

/**
 * Listing an application, or removing it.
 *
 * Opting out takes effect on the next read: the directory is a view over the
 * live badge and this row, with no cache and no stored "is listed" flag to go
 * stale. Certification is untouched either way — the Badge Licence says you may
 * opt out entirely and stay certified, and this is the control that has to make
 * that true.
 */
export async function setDirectoryListing(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You are signed out.' };

  const appId = String(formData.get('appId') ?? '');
  const listed = formData.get('listed') === 'on';
  const tagline = String(formData.get('tagline') ?? '').trim();
  const category = String(formData.get('category') ?? '').trim();

  if (tagline && (tagline.length < 10 || tagline.length > 160)) {
    return { error: 'A tagline is between 10 and 160 characters, or leave it blank.' };
  }

  // A directory entry is a rating of ours with the owner's own words beside it,
  // which is the most persuasive place on the site for a claim we do not make.
  for (const [what, value] of [
    ['tagline', tagline],
    ['category', category],
  ] as const) {
    const verdict = checkClaim(value);
    if (!verdict.ok) return { error: `${verdict.reason} (in the ${what})` };
  }

  const { data: app } = await supabase
    .from('apps')
    .select('organisation_id')
    .eq('id', appId)
    .maybeSingle();
  if (!app) return { error: 'No such application.' };

  const now = new Date().toISOString();
  const { error } = await supabase.from('directory_listings').upsert(
    {
      app_id: appId,
      organisation_id: app.organisation_id,
      state: listed ? 'listed' : 'opted_out',
      tagline: tagline || null,
      category: category || null,
      opted_out_at: listed ? null : now,
      opted_out_by: listed ? null : user.id,
    },
    { onConflict: 'app_id' },
  );
  if (error) return { error: error.message };

  revalidatePath('/directory');
  revalidatePath(`/console/apps/${appId}`);
  return {
    notice: listed
      ? 'Listed. It appears in the directory for as long as the badge is live, and disappears the moment it is not.'
      : 'Removed from the directory. Your badge and its verification page are unaffected — you stay certified.',
  };
}
