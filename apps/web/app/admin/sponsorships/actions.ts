'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { ActionState } from '@/app/console/apps/actions';

/**
 * Deciding on a paid placement.
 *
 * The database refuses to make a sponsorship live without a recorded reviewer,
 * so this is not the only lock — but it is the one a person uses, and the
 * reason it exists rather than a SQL statement is the same as everywhere else
 * here: a hand-written update has no permission check, no validation, and no
 * record of who decided.
 *
 * A refusal needs a written reason. Turning something down is the part of this
 * arrangement that makes the rest of it worth anything, and a refusal with no
 * ground recorded is one nobody can defend six months later.
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
    return { error: 'Only a VibefyCode administrator can decide on a placement.' } as const;
  }
  return { supabase, userId: user.id } as const;
}

export async function approveSponsorship(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();
  if ('error' in admin) return admin;
  const { supabase, userId } = admin;

  const id = String(formData.get('id') ?? '');
  const note = String(formData.get('note') ?? '').trim();
  if (!id) return { error: 'No placement was named.' };

  const { error } = await supabase
    .from('sponsorships')
    .update({
      status: 'live',
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      review_note: note || 'Approved.',
    })
    .eq('id', id);
  // The one-per-surface trigger speaks in English on purpose; a customer-facing
  // sentence about an overlapping period is more useful than "unique_violation".
  if (error) return { error: error.message };

  revalidatePath('/admin/sponsorships');
  return { notice: 'That placement is live.' };
}

export async function rejectSponsorship(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();
  if ('error' in admin) return admin;
  const { supabase, userId } = admin;

  const id = String(formData.get('id') ?? '');
  const note = String(formData.get('note') ?? '').trim();
  if (!id) return { error: 'No placement was named.' };
  if (note.length < 10) {
    return {
      error:
        'Say why, in a sentence. A refusal with no ground recorded is one nobody can defend later.',
    };
  }

  const { error } = await supabase
    .from('sponsorships')
    .update({
      status: 'rejected',
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      review_note: note,
    })
    .eq('id', id);
  if (error) return { error: error.message };

  revalidatePath('/admin/sponsorships');
  return { notice: 'Turned down, with the reason recorded.' };
}

export async function endSponsorship(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();
  if ('error' in admin) return admin;
  const { supabase } = admin;

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'No placement was named.' };

  const { error } = await supabase.from('sponsorships').update({ status: 'ended' }).eq('id', id);
  if (error) return { error: error.message };

  revalidatePath('/admin/sponsorships');
  return { notice: 'That placement has been taken down.' };
}
