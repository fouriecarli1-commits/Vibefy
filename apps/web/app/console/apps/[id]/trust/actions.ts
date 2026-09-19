'use server';

import { revalidatePath } from 'next/cache';
import { checkClaim } from '@vibefycode/shared';
import { createClient } from '@/lib/supabase/server';
import type { ActionState } from '@/app/console/apps/actions';

/**
 * The owner's own words, saved onto a page that carries our mark.
 *
 * Everything the customer types here is checked against the same copy rules
 * this repository applies to itself, at the moment of typing. Somebody who has
 * just earned a badge, writing about their own application beside our seal,
 * will reach for exactly the words the mark does not support. Most of them mean
 * no harm, and all of them produce a page saying we made a claim we did not.
 *
 * Refused with a sentence rather than silently, because a refusal with no
 * reason is a form people work around instead of a rule they understand.
 */
export async function saveTrustPage(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You are signed out.' };

  const appId = String(formData.get('appId') ?? '');
  const organisationId = String(formData.get('organisationId') ?? '');

  const text = (name: string) => String(formData.get(name) ?? '').trim();
  const fields = {
    contact_email: text('contactEmail'),
    security_contact: text('securityContact'),
    status_url: text('statusUrl'),
    privacy_url: text('privacyUrl'),
    terms_url: text('termsUrl'),
    note: text('note'),
  };

  for (const [name, value] of Object.entries(fields)) {
    const verdict = checkClaim(value);
    if (!verdict.ok) {
      return { error: `${verdict.reason} (in ${name.replace(/_/g, ' ')})` };
    }
  }

  for (const url of [fields.status_url, fields.privacy_url, fields.terms_url]) {
    if (url && !url.startsWith('https://')) {
      return {
        error:
          'Links here have to be https. A plain-HTTP link on this page is not one we will publish.',
      };
    }
  }

  const { error } = await supabase.from('trust_pages').upsert(
    {
      app_id: appId,
      organisation_id: organisationId,
      contact_email: fields.contact_email || null,
      security_contact: fields.security_contact || null,
      status_url: fields.status_url || null,
      privacy_url: fields.privacy_url || null,
      terms_url: fields.terms_url || null,
      note: fields.note || null,
    },
    { onConflict: 'app_id' },
  );

  if (error) return { error: `That could not be saved: ${error.message}` };

  revalidatePath(`/console/apps/${appId}/trust`);
  return { notice: 'Saved. It appears on your verification page once you publish it.' };
}

/** Publishing and unpublishing are one control, and both take effect now. */
export async function setTrustPagePublished(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You are signed out.' };

  const appId = String(formData.get('appId') ?? '');
  const published = String(formData.get('published') ?? '') === 'true';

  const { error } = await supabase.from('trust_pages').update({ published }).eq('app_id', appId);

  if (error) return { error: `That could not be changed: ${error.message}` };

  revalidatePath(`/console/apps/${appId}/trust`);
  return {
    notice: published
      ? 'Live on your verification page.'
      : 'Taken off your verification page. Only what the assessment found is shown there now.',
  };
}
