'use server';

import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { CONSENT_AT_SIGN_UP, consentPayload } from '@/lib/legal';

/**
 * Materialises the acceptance recorded at sign-up into the append-only consents
 * table.
 *
 * Acceptance happens before the account is confirmed, when there is no session
 * and therefore no row-level-security identity to write under. The accepted
 * document versions and hashes travel in the sign-up metadata and are written
 * here on the first authenticated request, keeping the original acceptance
 * timestamp. The consents table is append-only, so this runs at most once per
 * document version — a second call finds the record already there.
 */
export async function recordSignUpConsents(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const accepted = (user.user_metadata?.accepted_documents ?? []) as {
    documentType: string;
    version: string;
    sha256: string;
  }[];
  if (accepted.length === 0) return;

  const headerList = await headers();
  const forwardedFor = headerList.get('x-forwarded-for');
  const ip = forwardedFor?.split(',')[0]?.trim() ?? null;
  const userAgent = headerList.get('user-agent');
  const acceptedAt = (user.user_metadata?.accepted_at as string | undefined) ?? user.created_at;

  const expected = new Set(CONSENT_AT_SIGN_UP.map((entry) => entry.documentType));
  const current = consentPayload();

  for (const record of accepted) {
    if (!expected.has(record.documentType as (typeof CONSENT_AT_SIGN_UP)[number]['documentType'])) {
      continue;
    }
    // Only record what we can still show them. A hash we no longer publish would
    // be a consent record nobody can reproduce.
    if (!current.some((entry) => entry.sha256 === record.sha256)) continue;

    const { data: alreadyRecorded } = await supabase.rpc('has_current_consent', {
      target_user: user.id,
      document: record.documentType,
      required_version: record.version,
    });
    if (alreadyRecorded) continue;

    await supabase.from('consents').insert({
      user_id: user.id,
      document_type: record.documentType,
      document_version: record.version,
      document_sha256: record.sha256,
      action: 'accepted',
      occurred_at: acceptedAt,
      ip,
      user_agent: userAgent,
    });
  }
}
