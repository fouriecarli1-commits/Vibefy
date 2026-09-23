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

/**
 * The same acceptance record, for somebody who signed up through a provider.
 *
 * A password sign-up carries the accepted versions in the sign-up metadata,
 * because acceptance happens before there is a session to write under. An OAuth
 * sign-up has no such moment: the provider hands back a confirmed user and the
 * metadata is Google's, not ours. Without this, signing up with Google produced
 * an account with no consent record at all — and a consent record is the whole
 * reason that table is append-only.
 *
 * What is declared arrives in the callback URL and is therefore not trusted. It
 * does not need to be: every entry is checked against the registry we publish
 * right now, exactly as the password path checks it, so the only thing somebody
 * can do by forging it is record their own acceptance of documents we publish.
 * Anything that does not match is dropped rather than recorded, because a hash
 * we do not publish is a consent record nobody can reproduce.
 *
 * The button that sends this sits under the sentence saying that clicking it
 * records acceptance. That sentence is what makes the record true, and it is
 * why a sign-*in* button passes nothing and writes nothing.
 */
export async function recordProviderConsents(declared: string | null): Promise<void> {
  if (!declared) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const headerList = await headers();
  const forwardedFor = headerList.get('x-forwarded-for');
  const ip = forwardedFor?.split(',')[0]?.trim() ?? null;
  const userAgent = headerList.get('user-agent');
  const current = consentPayload();

  for (const entry of current) {
    // Named in what came back, and matching what we publish. Both, because the
    // first is a claim and the second is the fact.
    if (!declared.split('|').includes(`${entry.documentType}:${entry.version}:${entry.sha256}`)) {
      continue;
    }
    const { data: alreadyRecorded } = await supabase.rpc('has_current_consent', {
      target_user: user.id,
      document: entry.documentType,
      required_version: entry.version,
    });
    if (alreadyRecorded) continue;

    await supabase.from('consents').insert({
      user_id: user.id,
      document_type: entry.documentType,
      document_version: entry.version,
      document_sha256: entry.sha256,
      action: 'accepted',
      ip,
      user_agent: userAgent,
    });
  }
}

/** What a sign-up button puts in its callback URL, from the current registry. */
export async function declaredConsents(): Promise<string> {
  return consentPayload()
    .map((entry) => `${entry.documentType}:${entry.version}:${entry.sha256}`)
    .join('|');
}
