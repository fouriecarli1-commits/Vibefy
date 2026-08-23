'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { ActionState } from '@/app/console/apps/actions';

/**
 * The three review actions.
 *
 * Each writes an append-only review row *before* moving the assessment, because
 * the database refuses the transition without one. That ordering is not a
 * convenience — it is what makes "AI never certifies alone" a fact rather than a
 * policy, and it is why an adjustment cannot be recorded without a reason.
 */
async function reviewerContext() {
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
    return { error: 'Only a VibefyCode reviewer can act on the queue.' as const };
  }
  return { supabase, user };
}

export async function approveAssessment(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await reviewerContext();
  if ('error' in context) return { error: context.error };
  const { supabase, user } = context;

  const assessmentId = String(formData.get('assessmentId') ?? '');
  const certificationEligible = formData.get('certificationEligible') === 'on';
  const reason = String(formData.get('reason') ?? '').trim();

  const { data: assessment } = await supabase
    .from('assessments')
    .select('id, organisation_id, dimension_scores')
    .eq('id', assessmentId)
    .single();
  if (!assessment) return { error: 'Assessment not found.' };

  const { error: reviewError } = await supabase.from('reviews').insert({
    assessment_id: assessmentId,
    organisation_id: assessment.organisation_id,
    reviewer_id: user.id,
    action: 'approved',
    reason: reason || null,
    previous_scores: assessment.dimension_scores,
    new_scores: assessment.dimension_scores,
  });
  if (reviewError) return { error: reviewError.message };

  const { error } = await supabase
    .from('assessments')
    .update({
      status: 'approved',
      certification_eligible: certificationEligible,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', assessmentId);

  // The certification gate is enforced in the database too, so a reviewer who
  // ticks the box on an assessment carrying a critical security finding is
  // refused rather than trusted.
  if (error) return { error: error.message };

  revalidatePath('/review');
  return { notice: 'Approved. The customer can see the report now.' };
}

export async function adjustAssessment(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await reviewerContext();
  if ('error' in context) return { error: context.error };
  const { supabase, user } = context;

  const assessmentId = String(formData.get('assessmentId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (reason.length < 20) {
    return {
      error:
        'An adjustment needs a written reason of at least twenty characters. The database refuses one without.',
    };
  }
  const newScore = Number(formData.get('overallScore'));
  if (!Number.isFinite(newScore) || newScore < 0 || newScore > 100) {
    return { error: 'The adjusted score must be between 0 and 100.' };
  }

  const { data: assessment } = await supabase
    .from('assessments')
    .select('id, organisation_id, dimension_scores, overall_score')
    .eq('id', assessmentId)
    .single();
  if (!assessment) return { error: 'Assessment not found.' };

  const { error: reviewError } = await supabase.from('reviews').insert({
    assessment_id: assessmentId,
    organisation_id: assessment.organisation_id,
    reviewer_id: user.id,
    action: 'adjusted',
    reason,
    previous_scores: { overall: assessment.overall_score, dimensions: assessment.dimension_scores },
    new_scores: { overall: newScore, dimensions: assessment.dimension_scores },
  });
  if (reviewError) return { error: reviewError.message };

  const { error } = await supabase
    .from('assessments')
    .update({ overall_score: newScore, reviewed_at: new Date().toISOString() })
    .eq('id', assessmentId);
  if (error) return { error: error.message };

  revalidatePath(`/review/${assessmentId}`);
  return { notice: 'Adjustment recorded, with your reason, permanently.' };
}

export async function rejectAssessment(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await reviewerContext();
  if ('error' in context) return { error: context.error };
  const { supabase, user } = context;

  const assessmentId = String(formData.get('assessmentId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (reason.length < 20)
    return { error: 'A rejection needs a written reason of at least twenty characters.' };

  const { data: assessment } = await supabase
    .from('assessments')
    .select('id, organisation_id, dimension_scores')
    .eq('id', assessmentId)
    .single();
  if (!assessment) return { error: 'Assessment not found.' };

  const { error: reviewError } = await supabase.from('reviews').insert({
    assessment_id: assessmentId,
    organisation_id: assessment.organisation_id,
    reviewer_id: user.id,
    action: 'rejected',
    reason,
    previous_scores: assessment.dimension_scores,
  });
  if (reviewError) return { error: reviewError.message };

  const { error } = await supabase
    .from('assessments')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
    .eq('id', assessmentId);
  if (error) return { error: error.message };

  revalidatePath('/review');
  return { notice: 'Rejected, with your reason recorded. The customer can appeal.' };
}
