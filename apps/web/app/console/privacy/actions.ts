'use server';

import { revalidatePath } from 'next/cache';
import { REQUEST_KINDS, refusalIsAnswerable, type RequestType } from '@vibefy/governance';
import { createClient } from '@/lib/supabase/server';
import type { ActionState } from '@/app/console/apps/actions';

const TYPES = new Set(REQUEST_KINDS.map((kind) => kind.type));

/**
 * Submitting a data-subject request.
 *
 * PART 8.2 asks for working in-product flows, not an email address. The
 * difference that makes in practice is a clock: a request submitted here has a
 * due date from the moment it exists — set by a database trigger, not by this
 * action — and appears in a queue that can be shown to be empty.
 */
export async function submitDataRequest(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You are signed out.' };

  const requestType = String(formData.get('requestType') ?? '') as RequestType;
  if (!TYPES.has(requestType)) return { error: 'Choose what you are asking for.' };

  const details = String(formData.get('details') ?? '').trim();
  if (requestType === 'correction' && details.length < 10) {
    return { error: 'Say what is wrong, so we can correct the right thing.' };
  }
  if (requestType === 'objection' && details.length < 10) {
    return { error: 'Say which processing you are objecting to.' };
  }

  const { data: membership } = await supabase
    .from('memberships')
    .select('organisation_id, organisations (is_personal)')
    .limit(20);
  const rows = (membership ?? []) as unknown as {
    organisation_id: string;
    organisations: { is_personal: boolean } | null;
  }[];
  const personal = rows.find((row) => row.organisations?.is_personal) ?? rows[0];

  const { error } = await supabase.from('data_requests').insert({
    user_id: user.id,
    organisation_id: personal?.organisation_id ?? null,
    request_type: requestType,
    details: details || null,
  });
  if (error) {
    return {
      error: /duplicate|unique/i.test(error.message)
        ? 'You already have a request of that kind open. It is in the list below with its due date.'
        : error.message,
    };
  }

  revalidatePath('/console/privacy');
  return {
    notice:
      'Received. It is in the list below with the date we have to answer by. You will not be asked to email anyone.',
  };
}

/**
 * Appealing a finding or a score.
 *
 * The appeals policy is published and linked from every report. This is what
 * makes it a route rather than a document: the appeal has a fourteen-day
 * deadline set by the database, and the reviewer queue shows it.
 */
export async function submitAppeal(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You are signed out.' };

  const assessmentId = String(formData.get('assessmentId') ?? '');
  const findingId = String(formData.get('findingId') ?? '');
  const grounds = String(formData.get('grounds') ?? '').trim();
  if (grounds.length < 30) {
    return {
      error:
        'Please set out the grounds in a few sentences. An appeal we cannot understand is one we cannot answer properly.',
    };
  }

  const { data: assessment } = await supabase
    .from('assessments')
    .select('id, organisation_id')
    .eq('id', assessmentId)
    .maybeSingle();
  if (!assessment) return { error: 'No such assessment.' };

  const { error } = await supabase.from('appeals').insert({
    assessment_id: assessmentId,
    organisation_id: assessment.organisation_id,
    finding_id: findingId || null,
    submitted_by: user.id,
    grounds,
  });
  if (error) return { error: error.message };

  revalidatePath(`/console/reports/${assessmentId}`);
  return {
    notice:
      'Appeal recorded. A reviewer who did not work on this assessment answers it within fourteen days, in writing, whether it succeeds or not.',
  };
}

/** Reviewer side: resolving a data-subject request. A refusal must name its basis. */
export async function resolveDataRequest(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You are signed out.' };

  const requestId = String(formData.get('requestId') ?? '');
  const status = String(formData.get('status') ?? '');
  const response = String(formData.get('response') ?? '').trim();
  const refusalBasis = String(formData.get('refusalBasis') ?? '').trim();

  if (!['verifying', 'in_progress', 'completed', 'refused'].includes(status)) {
    return { error: 'Unknown status.' };
  }
  if (status === 'refused' && !refusalIsAnswerable(refusalBasis)) {
    return {
      error:
        'A refusal has to name its lawful basis in a sentence. "Request refused" with no stated ground is the behaviour the right exists to prevent.',
    };
  }
  if (status === 'completed' && response.length < 20) {
    return { error: 'Say what was done, in a sentence they can hold us to.' };
  }

  const { error } = await supabase
    .from('data_requests')
    .update({
      status,
      response: response || null,
      refusal_basis: status === 'refused' ? refusalBasis : null,
      handled_by: user.id,
      completed_at: ['completed', 'refused'].includes(status) ? new Date().toISOString() : null,
    })
    .eq('id', requestId);
  if (error) return { error: error.message };

  revalidatePath('/review/requests');
  return { notice: 'Recorded.' };
}

/** Reviewer side: resolving an appeal. Every outcome needs written reasons. */
export async function resolveAppeal(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You are signed out.' };

  const appealId = String(formData.get('appealId') ?? '');
  const status = String(formData.get('status') ?? '');
  const resolution = String(formData.get('resolution') ?? '').trim();

  if (!['under_review', 'upheld', 'partially_upheld', 'rejected'].includes(status)) {
    return { error: 'Unknown outcome.' };
  }
  if (status !== 'under_review' && resolution.length < 20) {
    return {
      error:
        'Every outcome needs written reasons — including a rejection, which is the one nobody wants to write.',
    };
  }

  const { error } = await supabase
    .from('appeals')
    .update({
      status,
      resolution: resolution || null,
      resolved_by: user.id,
      resolved_at: status === 'under_review' ? null : new Date().toISOString(),
    })
    .eq('id', appealId);
  if (error) return { error: error.message };

  revalidatePath('/review/appeals');
  return { notice: 'Recorded, with the reasons, permanently.' };
}
