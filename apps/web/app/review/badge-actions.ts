'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { SECOND_STEP_REQUIRED, sessionPassedSecondStep } from '@/lib/second-step-server';
import type { ActionState } from '@/app/console/apps/actions';

/**
 * Suspending and revoking a badge.
 *
 * A reviewer action, not a customer one — a customer who could revoke their own
 * badge could also un-revoke it. Every transition writes an append-only badge
 * event automatically, by database trigger, so the history cannot be edited
 * afterwards; that history is what a licence dispute turns on.
 *
 * Both require a stated reason. The database refuses a revocation without one.
 */
async function reviewerClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You are signed out.' as const };

  const { data: profile } = await supabase
    .from('users')
    .select('platform_role')
    .eq('id', user.id)
    .single();
  if (profile?.platform_role !== 'reviewer' && profile?.platform_role !== 'admin') {
    return { error: 'Only a VibefyCode reviewer can act on a badge.' as const };
  }
  // Revocation is the one action in this product that is visible to the public
  // within minutes. A restrictive policy refuses it without a second step; this
  // is the sentence that says so.
  if (!(await sessionPassedSecondStep())) return { error: SECOND_STEP_REQUIRED };
  return { supabase };
}

export async function revokeBadge(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await reviewerClient();
  if ('error' in context) return { error: context.error };

  const badgeId = String(formData.get('badgeId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (reason.length < 10) {
    return {
      error:
        'Say why, in a sentence. The reason is published on the verification page and cannot be edited later.',
    };
  }

  /*
   * The changed row, asked for.
   *
   * An update that matches nothing is not an error — row-level security
   * filters the rows the statement can see rather than refusing it — and the
   * sentence below is the most consequential this product can say to a
   * reviewer: that a mark has stopped reading as verified everywhere it is
   * displayed. Said about a badge that was not touched, it leaves a live mark
   * on somebody's website and a reviewer who believes it is gone.
   */
  const { data: revoked, error } = await context.supabase
    .from('badges')
    .update({ status: 'revoked', revoked_at: new Date().toISOString(), revocation_reason: reason })
    .eq('id', badgeId)
    .select('id')
    .maybeSingle();
  if (error) return { error: error.message };
  if (!revoked)
    return {
      error:
        'That badge was not changed. It may already be revoked, or it is not one you can act on.',
    };

  revalidatePath('/review/badges');
  return {
    notice:
      'Revoked. Because we serve the image, every embedded instance stops reading as verified within minutes — there is no cached copy anywhere that says otherwise.',
  };
}

export async function suspendBadge(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await reviewerClient();
  if ('error' in context) return { error: context.error };

  const badgeId = String(formData.get('badgeId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (reason.length < 10) return { error: 'Say why, in a sentence.' };

  const { data: suspended, error } = await context.supabase
    .from('badges')
    .update({
      status: 'suspended',
      suspended_at: new Date().toISOString(),
      suspension_reason: reason,
    })
    .eq('id', badgeId)
    .select('id')
    .maybeSingle();
  if (error) return { error: error.message };
  if (!suspended)
    return {
      error:
        'That badge was not changed. It may already be suspended, or it is not one you can act on.',
    };

  revalidatePath('/review/badges');
  return {
    notice: 'Suspended. The mark now renders as "not currently verified" wherever it is displayed.',
  };
}

export async function reinstateBadge(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await reviewerClient();
  if ('error' in context) return { error: context.error };

  const badgeId = String(formData.get('badgeId') ?? '');
  const { data: reinstated, error } = await context.supabase
    .from('badges')
    .update({ status: 'active', suspended_at: null, suspension_reason: null })
    .eq('id', badgeId)
    .select('id')
    .maybeSingle();
  if (error) return { error: error.message };
  if (!reinstated)
    return {
      error:
        'That badge was not changed. It may already be active, or it is not one you can act on.',
    };

  revalidatePath('/review/badges');
  return {
    notice:
      'Reinstated. The reinstatement is recorded as its own event; the suspension stays in the history.',
  };
}
