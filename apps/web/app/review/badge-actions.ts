'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
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
    return { error: 'Only a Vibefy reviewer can act on a badge.' as const };
  }
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

  const { error } = await context.supabase
    .from('badges')
    .update({ status: 'revoked', revoked_at: new Date().toISOString(), revocation_reason: reason })
    .eq('id', badgeId);
  if (error) return { error: error.message };

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

  const { error } = await context.supabase
    .from('badges')
    .update({
      status: 'suspended',
      suspended_at: new Date().toISOString(),
      suspension_reason: reason,
    })
    .eq('id', badgeId);
  if (error) return { error: error.message };

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
  const { error } = await context.supabase
    .from('badges')
    .update({ status: 'active', suspended_at: null, suspension_reason: null })
    .eq('id', badgeId);
  if (error) return { error: error.message };

  revalidatePath('/review/badges');
  return {
    notice:
      'Reinstated. The reinstatement is recorded as its own event; the suspension stays in the history.',
  };
}
