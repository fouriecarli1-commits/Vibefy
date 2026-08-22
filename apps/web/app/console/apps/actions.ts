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
} from '@vibefy/engine/authorisation';
import { decideAssessmentRequest, resolvePlan } from '@vibefy/billing';
import { createClient } from '@/lib/supabase/server';
import { readAsUser } from '@/lib/sql';

const WARRANTY_FILE = 'authorisation-to-test.md';

function warrantyFingerprint(): { version: string; sha256: string } {
  const path = join(process.cwd(), '..', '..', 'legal', WARRANTY_FILE);
  const contents = readFileSync(path, 'utf8');
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
      description: description || null,
      category: String(formData.get('category') ?? '') || null,
      builder: String(formData.get('builder') ?? '') || null,
      target_audience: String(formData.get('targetAudience') ?? '') || null,
      processes_personal_data: formData.get('processesPersonalData') === 'on',
      has_authentication: formData.get('hasAuthentication') === 'on',
      has_payments: formData.get('hasPayments') === 'on',
      intended_for_app_store: formData.get('intendedForAppStore') === 'on',
      screening_status:
        screening.verdict === 'refused'
          ? 'refused'
          : screening.verdict === 'cleared'
            ? 'cleared'
            : 'pending',
      screening_notes: `${screening.verdict} (${screening.source}, ${screening.confidence} confidence): ${screening.reasoning}`,
      screened_at: new Date().toISOString(),
      created_by: user.id,
    })
    .select('id')
    .single();

  if (error) return { error: error.message };

  if (screening.verdict === 'refused') {
    // Refusals are logged with their ground, per the Acceptable Use Policy.
    await supabase.from('audit_log').insert({
      organisation_id: organisationId,
      actor_id: user.id,
      action: 'app.screening_refused',
      entity_type: 'app',
      entity_id: data.id,
      summary: screening.reasoning,
      after_state: screening,
    });
  }

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
    .select('id, organisation_id, primary_url, screening_status')
    .eq('id', appId)
    .single();
  if (appError || !app) return { error: appError?.message ?? 'App not found.' };
  if (app.screening_status === 'refused') {
    return {
      error:
        'This application was refused under the Acceptable Use Policy. Appeal it rather than re-submitting.',
    };
  }

  const host = new URL(app.primary_url as string).hostname;
  const challenge = createChallenge(host);
  const warranty = warrantyFingerprint();
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
        ? `Authorisation recorded. ${refused.join(', ')} ${refused.length === 1 ? 'was' : 'were'} removed from the scope: you can only authorise testing of the host you verify and its subdomains.`
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

  const outcome = await verifyOwnership(
    pending.verification_target as string,
    pending.verification_token as string,
  );
  if (!outcome.verified) return { error: outcome.detail };

  const { ip, userAgent } = await requestContext();
  const { error: insertError } = await supabase.from('authorisations').insert({
    app_id: appId,
    organisation_id: pending.organisation_id,
    supersedes_id: pending.id,
    status: 'verified',
    method: outcome.method,
    verification_token: pending.verification_token,
    verification_target: pending.verification_target,
    verified_at: outcome.checkedAt,
    scope_domains: pending.scope_domains,
    scope_exclusions: pending.scope_exclusions,
    third_parties: pending.third_parties,
    warranty_text_version: pending.warranty_text_version,
    warranty_text_sha256: pending.warranty_text_sha256,
    granted_by: user.id,
    accepted_ip: ip,
    accepted_user_agent: userAgent,
    // Twelve months is the outside limit; a stale authorisation is as much of a
    // liability as a stale badge.
    expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  });

  if (insertError) return { error: insertError.message };

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
