'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { ActionState } from '@/app/console/apps/actions';

/**
 * Marking an alert read.
 *
 * `read_at` is the only column a customer may write on an alert — the grant is
 * column-level, so this action could not change the severity or the wording of
 * an alert even if it tried to. What we told someone, and when, is not theirs to
 * edit any more than it is ours.
 */
export async function markAlertRead(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You are signed out.' };

  const alertId = String(formData.get('alertId') ?? '');
  if (!alertId) return { error: 'No alert given.' };

  // no-op-is-fine: `.is('read_at', null)` means a second click changes
  // nothing, and "Marked read. It stays in the history." is still true of an
  // alert that was already read.
  const { error } = await supabase
    .from('alerts')
    .update({ read_at: new Date().toISOString() })
    .eq('id', alertId)
    .is('read_at', null);
  if (error) return { error: error.message };

  revalidatePath('/console/alerts');
  return { notice: 'Marked read. It stays in the history.' };
}

export async function markAllAlertsRead(
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You are signed out.' };

  // no-op-is-fine: nothing unread is exactly what "All caught up." describes.
  const { error } = await supabase
    .from('alerts')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);
  if (error) return { error: error.message };

  revalidatePath('/console/alerts');
  return { notice: 'All caught up.' };
}

/**
 * Turning monitoring on or off for one application.
 *
 * Off means we stop looking. It does not mean the badge stays up regardless —
 * an unmonitored badge simply runs to its expiry date, which is the difference
 * between a maintained claim and a photograph.
 */
export async function setMonitoring(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You are signed out.' };

  const appId = String(formData.get('appId') ?? '');
  const enabled = String(formData.get('enabled') ?? '') === 'on';

  // Asked for: "Monitoring is off. Your badge is not renewed by us and runs to
  // its expiry date" is a statement about what we will and will not do, and an
  // update that matched nothing is not an error.
  const { data: changed, error } = await supabase
    .from('apps')
    .update({ monitoring_enabled: enabled })
    .eq('id', appId)
    .select('id')
    .maybeSingle();
  if (error) return { error: error.message };
  if (!changed) return { error: 'That application was not changed.' };

  revalidatePath(`/console/apps/${appId}`);
  return {
    notice: enabled
      ? 'Monitoring is on. We re-assess on your plan’s cadence and check that the application is answering.'
      : 'Monitoring is off. Your badge is not renewed by us and runs to its expiry date.',
  };
}
