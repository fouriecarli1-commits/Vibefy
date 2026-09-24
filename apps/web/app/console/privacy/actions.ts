'use server';

import { revalidatePath } from 'next/cache';
import { REQUEST_KINDS, refusalIsAnswerable, type RequestType } from '@vibefycode/governance';
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

  /*
   * The personal workspace, asked for by name.
   *
   * This read twenty memberships with no `order by` and then looked for
   * `is_personal` in JavaScript — the thing being searched for, never told to
   * the database — falling back to `rows[0]` when the search found nothing. A
   * caller in more than twenty workspaces could have their personal one outside
   * that window, and the request was then filed against an arbitrary
   * organisation; the accounts with that many memberships are exactly the
   * agencies and consultants, so the arbitrary one is somebody's client.
   *
   * It matters beyond the row. `organisation_id` grants nobody access here —
   * `data_requests_select_own` is `user_id = auth.uid() or is_platform_admin()`
   * — but `review/requests/[id]/export` copies it onto the audit row when a
   * reviewer exports the subject's data, and `audit_log_select_members` scopes
   * reads by exactly that column. Every member of the wrong workspace could then
   * read that this person made a data-subject request, which kind, and how much
   * data it covered.
   */
  const { data: personal } = await supabase
    .from('memberships')
    .select('organisation_id, organisations!inner(is_personal)')
    .eq('organisations.is_personal', true)
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from('data_requests').insert({
    user_id: user.id,
    // Null rather than a guess. Every account gets a personal workspace at
    // signup, so this should not happen — which is the reason the fallback must
    // not invent one. An unknown workspace recorded as unknown is true; an
    // unknown workspace recorded as somebody's client is not, and it is written
    // into the record that exists to show the process was followed.
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

/**
 * Choosing which alerts arrive by email.
 *
 * There is deliberately no "none". A badge suspension is a notice we are obliged
 * to give under the Badge Licence, and a notice a customer can switch off is not
 * one — so the quiet setting silences everything except the critical ones, and
 * says so.
 */
export async function setAlertEmailLevel(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You are signed out.' };

  const level = String(formData.get('alertEmailLevel') ?? '');
  if (!['all', 'critical_only'].includes(level)) return { error: 'Unknown setting.' };

  // The grant on public.users is column-level, so this action could not change
  // anyone's platform role or email even if it tried to.
  const { error } = await supabase
    .from('users')
    .update({ alert_email_level: level })
    .eq('id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/console/privacy');
  return {
    notice:
      level === 'all'
        ? 'You will get an email for anything that needs a look, and anything that needs action.'
        : 'Only alerts that need action will be emailed. Everything else waits for you in the console.',
  };
}
