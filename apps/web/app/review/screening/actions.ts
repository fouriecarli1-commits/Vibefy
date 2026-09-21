'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { ActionState } from '@/app/console/apps/actions';

/**
 * Clearing or refusing a submission under the Acceptable Use Policy.
 *
 * The decision itself lives in `public.record_screening_decision`, not here.
 * That is deliberate: the rules it enforces — reviewer only, a reason in
 * writing, an audit line that cannot be omitted — are the kind that must hold
 * however the row is reached, and a check in a server action only holds for
 * callers that go through the server action.
 *
 * What this file adds is the sentence a person reads when they get it wrong.
 */
export async function recordScreeningDecision(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You are signed out.' };

  const appId = String(formData.get('appId') ?? '');
  const decision = String(formData.get('decision') ?? '');
  const note = String(formData.get('note') ?? '').trim();

  if (decision !== 'cleared' && decision !== 'refused') {
    return { error: 'A screening decision is either cleared or refused.' };
  }
  if (note.length < 10) {
    return {
      error:
        decision === 'refused'
          ? 'Say which part of the submission you are relying on. A refusal that cannot quote its ground is not one a person can appeal.'
          : 'Say in a sentence what you looked at. The customer sees this, and so does whoever reads the file in a year.',
    };
  }

  const { error } = await supabase.rpc('record_screening_decision', {
    target_app: appId,
    decision,
    note,
  });
  if (error) return { error: error.message };

  revalidatePath('/review/screening');
  revalidatePath(`/console/apps/${appId}`);
  return {
    notice:
      decision === 'cleared'
        ? 'Cleared. The customer can request an assessment now.'
        : 'Refused, with your reason on their application page and a free appeal open to them.',
  };
}
