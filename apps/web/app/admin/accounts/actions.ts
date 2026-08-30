'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { PLAN_TIERS, entitlementFor, type PlanTier } from '@vibefycode/billing';
import { createClient } from '@/lib/supabase/server';
import type { ActionState } from '@/app/console/apps/actions';

/**
 * Operator actions on accounts.
 *
 * These exist because the alternative was the founder typing `update
 * public.subscriptions ...` into the Supabase SQL editor, twice against the
 * wrong organisation. An operator action that only exists as a hand-written
 * statement is an action with no permission check, no validation and no record
 * of who did it.
 *
 * Every function here re-checks the caller's platform role on the server. The
 * page also checks it before rendering, but a page check protects a screen and
 * these protect the data — a form can be submitted without ever loading the
 * page that carries it.
 */

/** The roles an operator may grant. Closed, so a typo cannot invent one. */
const GRANTABLE_ROLES = ['user', 'reviewer', 'admin'] as const;
type GrantableRole = (typeof GRANTABLE_ROLES)[number];

function isPlan(value: string): value is PlanTier {
  return (PLAN_TIERS as readonly string[]).includes(value);
}

function isRole(value: string): value is GrantableRole {
  return (GRANTABLE_ROLES as readonly string[]).includes(value);
}

async function requestContext() {
  const headerList = await headers();
  return {
    ip: headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: headerList.get('user-agent'),
  };
}

/**
 * The caller, if they are a platform administrator.
 *
 * Returns the reason rather than throwing, so a caller who is merely signed out
 * gets a sentence instead of a stack trace.
 */
async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Sign in first.' } as const;

  const { data: profile } = await supabase
    .from('users')
    .select('platform_role')
    .eq('id', user.id)
    .single();
  if (profile?.platform_role !== 'admin') {
    return { error: 'Only a VibefyCode administrator can change accounts.' } as const;
  }
  return { supabase, userId: user.id } as const;
}

/**
 * Puts a workspace on a plan.
 *
 * Until Stripe writes these rows from its webhook, this is how a plan is set —
 * and the row written here is the same shape the webhook will write, so nothing
 * has to be undone when billing arrives.
 *
 * The plan is not cosmetic. It decides how deep an assessment runs, how much
 * one may cost, and whether the workspace can hold a badge at all. So it is
 * logged, with what it was before.
 */
export async function setPlan(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  if ('error' in admin) return admin;
  const { supabase, userId } = admin;

  const organisationId = String(formData.get('organisationId') ?? '');
  const plan = String(formData.get('plan') ?? '');
  if (!organisationId) return { error: 'No workspace was named.' };
  if (!isPlan(plan)) return { error: `"${plan}" is not a plan.` };

  const { data: existing } = await supabase
    .from('subscriptions')
    .select('id, plan, status')
    .eq('organisation_id', organisationId)
    .maybeSingle();

  const previousPlan = existing ? String(existing.plan) : null;
  if (previousPlan === plan && String(existing?.status) === 'active') {
    return { notice: `That workspace is already on ${plan}.` };
  }

  const write = existing
    ? await supabase
        .from('subscriptions')
        .update({ plan, status: 'active' })
        .eq('id', existing.id as string)
    : await supabase
        .from('subscriptions')
        .insert({ organisation_id: organisationId, plan, status: 'active' });
  if (write.error) return { error: write.error.message };

  const entitlement = entitlementFor(plan);
  const { ip, userAgent } = await requestContext();
  await supabase.from('audit_log').insert({
    organisation_id: organisationId,
    actor_id: userId,
    actor_role: 'admin',
    action: 'account.plan_set',
    entity_type: 'organisation',
    entity_id: organisationId,
    summary: `Plan set to ${plan}${previousPlan ? ` from ${previousPlan}` : ''} by an operator.`,
    before_state: previousPlan ? { plan: previousPlan } : null,
    after_state: {
      plan,
      depth: entitlement.depth,
      maxRunCostUsd: entitlement.maxRunCostUsd,
      badgeEligible: entitlement.badgeEligible,
    },
    ip,
    user_agent: userAgent,
  });

  revalidatePath('/admin/accounts');
  return {
    notice: `${plan}: assessments run at ${entitlement.depth} depth, up to $${entitlement.maxRunCostUsd.toFixed(2)} a run, ${
      entitlement.badgeEligible ? 'badge-eligible' : 'not badge-eligible'
    }.`,
  };
}

/**
 * Grants or removes a platform role.
 *
 * The last administrator cannot demote themselves. It is a small guard against
 * a large problem: an empty administrator set can only be repaired with the
 * database credentials, which is precisely the situation these screens exist to
 * end.
 */
export async function setPlatformRole(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();
  if ('error' in admin) return admin;
  const { supabase, userId } = admin;

  const targetId = String(formData.get('userId') ?? '');
  const role = String(formData.get('role') ?? '');
  if (!targetId) return { error: 'No person was named.' };
  if (!isRole(role)) return { error: `"${role}" is not a platform role.` };

  const { data: target } = await supabase
    .from('users')
    .select('id, email, platform_role')
    .eq('id', targetId)
    .single();
  if (!target) return { error: 'That account does not exist.' };

  const previousRole = String(target.platform_role);
  if (previousRole === role) return { notice: `${String(target.email)} is already ${role}.` };

  // Through the function, not through the table. `platform_role` is not
  // writable from any session — that grant has never existed, and it stands
  // behind row-level security as a second defence. The function holds the
  // privilege, checks the caller, and refuses to leave the platform without an
  // administrator; all this has to do is report what it says.
  const { error } = await supabase.rpc('set_platform_role', {
    target_user: targetId,
    new_role: role,
  });
  if (error) return { error: error.message };

  const { ip, userAgent } = await requestContext();
  await supabase.from('audit_log').insert({
    actor_id: userId,
    actor_role: 'admin',
    action: 'account.platform_role_set',
    entity_type: 'user',
    entity_id: targetId,
    summary: `${String(target.email)} changed from ${previousRole} to ${role}.`,
    before_state: { platform_role: previousRole },
    after_state: { platform_role: role },
    ip,
    user_agent: userAgent,
  });

  revalidatePath('/admin/accounts');
  return { notice: `${String(target.email)} is now ${role}.` };
}
