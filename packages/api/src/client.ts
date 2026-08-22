/**
 * One client, two front ends.
 *
 * The mobile app talks to the same database, through the same anon key, under
 * the same row-level security as the console. There is no mobile API — a second
 * API surface is a second place for an authorisation rule to be forgotten, and
 * the rules here are the ones that decide who can read whose assessment.
 *
 * Every method below is a read or a narrowly-scoped write that a policy already
 * governs. If a query returns nothing, that is the answer: the caller is not a
 * member of that workspace.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  AlertSummary,
  AppSummary,
  AssessmentSummary,
  AuthorisationStatus,
  BadgeStatus,
  RequestSummary,
} from './types.ts';

export interface VibefyClientOptions {
  readonly url: string;
  readonly anonKey: string;
  /** Platform storage for the session. React Native passes AsyncStorage; the browser passes nothing. */
  readonly storage?: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
  };
}

export function createVibefyClient(options: VibefyClientOptions): SupabaseClient {
  return createClient(options.url, options.anonKey, {
    auth: {
      ...(options.storage ? { storage: options.storage } : {}),
      autoRefreshToken: true,
      persistSession: true,
      // A mobile app has no URL bar to read a session out of, and asking it to
      // look for one is how a deep link becomes a session-fixation vector.
      detectSessionInUrl: false,
    },
  });
}

interface PortfolioRow {
  app_id: string;
  organisation_id: string;
  name: string;
  primary_url: string | null;
  overall_score: string | null;
  assessment_id: string | null;
  assessed_at: string | null;
  certification_eligible: boolean | null;
  badge_status: BadgeStatus | null;
  badge_expires_at: string | null;
  authorisation_status: AuthorisationStatus | null;
  monitoring_enabled: boolean;
  unread_alerts: number;
}

export async function listApps(client: SupabaseClient): Promise<AppSummary[]> {
  const { data, error } = await client.from('portfolio').select('*').order('name');
  if (error) throw new Error(error.message);
  return ((data ?? []) as PortfolioRow[]).map((row) => ({
    appId: row.app_id,
    organisationId: row.organisation_id,
    name: row.name,
    primaryUrl: row.primary_url,
    latestScore: row.overall_score === null ? null : Number(row.overall_score),
    latestAssessmentId: row.assessment_id,
    assessedOn: row.assessed_at ? row.assessed_at.slice(0, 10) : null,
    certificationEligible: row.certification_eligible === true,
    badgeStatus: row.badge_status,
    badgeExpiresAt: row.badge_expires_at,
    authorisationStatus: row.authorisation_status,
    monitoringEnabled: row.monitoring_enabled,
    unreadAlerts: Number(row.unread_alerts ?? 0),
  }));
}

export async function listAssessments(
  client: SupabaseClient,
  appId: string,
): Promise<AssessmentSummary[]> {
  const { data, error } = await client
    .from('assessment_history')
    .select('assessment_id, status, overall_score, rubric_version, assessed_at, score_delta, material_regression')
    .eq('app_id', appId)
    .limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    assessmentId: String(row.assessment_id),
    status: String(row.status),
    score: row.overall_score === null ? null : Number(row.overall_score),
    rubricVersion: String(row.rubric_version),
    assessedOn: String(row.assessed_at).slice(0, 10),
    scoreDelta: row.score_delta === null ? null : Number(row.score_delta),
    materialRegression: Boolean(row.material_regression),
  }));
}

export async function listAlerts(client: SupabaseClient, limit = 50): Promise<AlertSummary[]> {
  const { data, error } = await client
    .from('alerts')
    .select('id, app_id, kind, severity, title, body, assessment_id, created_at, read_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    alertId: String(row.id),
    appId: row.app_id ? String(row.app_id) : null,
    kind: String(row.kind),
    severity: row.severity as AlertSummary['severity'],
    title: String(row.title),
    body: String(row.body),
    assessmentId: row.assessment_id ? String(row.assessment_id) : null,
    createdAt: String(row.created_at),
    readAt: row.read_at ? String(row.read_at) : null,
  }));
}

/** The only column a customer may write on an alert. The grant is column-level. */
export async function markAlertRead(client: SupabaseClient, alertId: string): Promise<void> {
  const { error } = await client
    .from('alerts')
    .update({ read_at: new Date().toISOString() })
    .eq('id', alertId)
    .is('read_at', null);
  if (error) throw new Error(error.message);
}

export async function listRequests(
  client: SupabaseClient,
  appId: string,
): Promise<RequestSummary[]> {
  const { data, error } = await client
    .from('assessment_requests')
    .select('id, status, depth, refusal_message, created_at, assessment_id')
    .eq('app_id', appId)
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    requestId: String(row.id),
    status: String(row.status),
    depth: String(row.depth),
    refusalMessage: row.refusal_message ? String(row.refusal_message) : null,
    createdAt: String(row.created_at),
    assessmentId: row.assessment_id ? String(row.assessment_id) : null,
  }));
}

export interface ReTestRefusal {
  readonly refused: true;
  readonly reason: string;
}

/**
 * Approving a re-test from a phone.
 *
 * This is the one write the mobile app makes that spends anything, so it does
 * the same two checks the console does *and* leaves the rest to the database:
 * the insert policy requires membership and `requested_by = auth.uid()`, the
 * partial unique index refuses a second live request for the same application,
 * and the worker re-checks the authorisation before it runs. Nothing here is
 * trusted because it came from a signed-in phone.
 */
export async function requestReTest(
  client: SupabaseClient,
  input: { appId: string; organisationId: string; userId: string; depth: string; plan: string; maxRunCostUsd: number },
): Promise<{ requestId: string } | ReTestRefusal> {
  const { data: authorised, error: authError } = await client.rpc(
    'app_is_authorised_for_testing',
    { target_app: input.appId },
  );
  if (authError) return { refused: true, reason: authError.message };
  if (authorised !== true) {
    return {
      refused: true,
      reason:
        'This application has no verified, unexpired authorisation to test. Complete ownership verification in the console first — it is not something to do from a phone.',
    };
  }

  const { data, error } = await client
    .from('assessment_requests')
    .insert({
      app_id: input.appId,
      organisation_id: input.organisationId,
      requested_by: input.userId,
      depth: input.depth,
      plan_at_request: input.plan,
      max_run_cost_usd: input.maxRunCostUsd,
    })
    .select('id')
    .single();

  if (error) {
    return {
      refused: true,
      reason: /assessment_requests_one_live_per_app|duplicate/i.test(error.message)
        ? 'An assessment of this application is already queued. Queueing it twice spends twice.'
        : error.message,
    };
  }
  return { requestId: String(data.id) };
}
