'use server';

import { headers } from 'next/headers';
import { consentPayload } from '@/lib/legal';
import { createClient } from '@/lib/supabase/server';

/**
 * Records the acceptance, for an account that reached us without one.
 *
 * Writes the versions and hashes as they stand at this moment, which is what the
 * page showed. Nothing is taken from the caller: a client that could name the
 * version it accepted could name an older one.
 */
export async function acceptDocuments(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You are signed out.' };

  const headerList = await headers();
  const forwardedFor = headerList.get('x-forwarded-for');
  const ip = forwardedFor?.split(',')[0]?.trim() ?? null;
  const userAgent = headerList.get('user-agent');

  for (const entry of consentPayload()) {
    const { data: alreadyRecorded } = await supabase.rpc('has_current_consent', {
      target_user: user.id,
      document: entry.documentType,
      required_version: entry.version,
    });
    if (alreadyRecorded === true) continue;

    const { error } = await supabase.from('consents').insert({
      user_id: user.id,
      document_type: entry.documentType,
      document_version: entry.version,
      document_sha256: entry.sha256,
      action: 'accepted',
      ip,
      user_agent: userAgent,
    });
    // Said rather than swallowed. An acceptance we failed to write is an account
    // that carries on looking accepted, which is the thing this whole path
    // exists to prevent.
    if (error) return { error: `Your acceptance could not be recorded: ${error.message}` };
  }

  return {};
}
