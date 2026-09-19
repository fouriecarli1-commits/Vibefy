'use server';

import { revalidatePath } from 'next/cache';
import { checkClaim } from '@vibefycode/shared';
import { createClient } from '@/lib/supabase/server';
import type { ActionState } from '@/app/console/apps/actions';

/**
 * The controls for a page about a person.
 *
 * Every one of these is deliberately small and deliberately reversible. A
 * profile is the first thing here that says something about somebody rather
 * than about an application, and the whole defence of it is that they switched
 * each fact on themselves and can switch it off again in one action without
 * asking us.
 *
 * Nothing here can add an application somebody else owns: a trigger in the
 * database refuses that row, so a bug in this file cannot turn into a claim
 * about another organisation's work under your name.
 */
async function signedIn() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

const HANDLE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

export async function saveBuilderProfile(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user } = await signedIn();
  if (!user) return { error: 'You are signed out.' };

  const organisationId = String(formData.get('organisationId') ?? '');
  const handle = String(formData.get('handle') ?? '')
    .trim()
    .toLowerCase();
  const displayName = String(formData.get('displayName') ?? '').trim();
  const tagline = String(formData.get('tagline') ?? '').trim();

  if (!HANDLE.test(handle)) {
    return {
      error:
        'A handle is 3 to 32 characters, lowercase letters, numbers and hyphens, starting and ending with a letter or number.',
    };
  }
  if (displayName.length < 2) return { error: 'Give the page a name to show at the top.' };

  // The same gate the rest of the site is held to. This page sits under a list
  // of badges, which is exactly where a sentence claiming the badge means more
  // than it does would be most believed.
  for (const [what, value] of [
    ['name', displayName],
    ['line about you', tagline],
  ] as const) {
    const verdict = checkClaim(value);
    if (!verdict.ok) return { error: `${verdict.reason} (in the ${what})` };
  }

  const { error } = await supabase.from('builder_profiles').upsert(
    {
      organisation_id: organisationId,
      handle,
      display_name: displayName,
      tagline: tagline || null,
    },
    { onConflict: 'organisation_id' },
  );

  if (error) {
    // The unique constraint is the common one, and the message a database
    // gives for it is not a sentence anybody should have to read.
    return {
      error: error.message.includes('builder_profiles_handle_key')
        ? 'Somebody already has that handle. Try another.'
        : `That could not be saved: ${error.message}`,
    };
  }

  revalidatePath('/console/profile');
  return { notice: 'Saved.' };
}

/** Publishing and unpublishing are the same control, and both take effect now. */
export async function setBuilderProfilePublished(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user } = await signedIn();
  if (!user) return { error: 'You are signed out.' };

  const organisationId = String(formData.get('organisationId') ?? '');
  const published = String(formData.get('published') ?? '') === 'true';

  const { error } = await supabase
    .from('builder_profiles')
    .update({ published })
    .eq('organisation_id', organisationId);

  if (error) return { error: `That could not be changed: ${error.message}` };

  revalidatePath('/console/profile');
  return {
    notice: published
      ? 'Your page is live. Anybody with the address can read it.'
      : 'Your page is down. Nobody can read it, including anybody holding the address.',
  };
}

/**
 * One application, on or off.
 *
 * A row is a decision about one application, and deleting it is how that
 * decision is withdrawn. There is no "list everything" switch on purpose: a
 * switch like that is how an application somebody had forgotten about ends up
 * on a page they are showing to a client.
 */
export async function setAppOnProfile(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user } = await signedIn();
  if (!user) return { error: 'You are signed out.' };

  const organisationId = String(formData.get('organisationId') ?? '');
  const appId = String(formData.get('appId') ?? '');
  const shown = String(formData.get('shown') ?? '') === 'true';

  const { error } = shown
    ? await supabase.from('builder_profile_apps').insert({
        organisation_id: organisationId,
        app_id: appId,
        consented_by: user.id,
      })
    : await supabase
        .from('builder_profile_apps')
        .delete()
        .eq('organisation_id', organisationId)
        .eq('app_id', appId);

  if (error) return { error: `That could not be changed: ${error.message}` };

  revalidatePath('/console/profile');
  return { notice: shown ? 'Added to your page.' : 'Removed from your page.' };
}
