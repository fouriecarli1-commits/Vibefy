'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { verifyDnsTxt, DNS_RECORD_PREFIX } from '@vibefy/engine/authorisation';
import { canAccept, createInvitationToken, hashInvitationToken } from '@vibefy/workspace';
import { createClient } from '@/lib/supabase/server';
import type { ActionState } from '@/app/console/apps/actions';

async function signedIn() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${base || 'workspace'}-${randomBytes(3).toString('hex')}`;
}

/**
 * A shared workspace, as opposed to the personal one every account gets on sign-up.
 *
 * The creator becomes its owner in the same statement that creates it. An
 * organisation with no owner strands every app, badge and subscription beneath
 * it, and a trigger in the database refuses to let that happen.
 */
export async function createWorkspace(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user } = await signedIn();
  if (!user) return { error: 'You are signed out.' };

  const name = String(formData.get('name') ?? '').trim();
  const accountType = String(formData.get('accountType') ?? 'agency');
  if (name.length < 2) return { error: 'Give the workspace a name.' };
  if (!['agency', 'organisation'].includes(accountType)) {
    return { error: 'A shared workspace is either an agency or an organisation.' };
  }

  const { data: organisation, error } = await supabase
    .from('organisations')
    .insert({
      name,
      slug: slugify(name),
      account_type: accountType,
      is_personal: false,
      created_by: user.id,
      billing_email: user.email,
    })
    .select('id')
    .single();
  if (error || !organisation) return { error: error?.message ?? 'Could not create the workspace.' };

  const { error: membershipError } = await supabase.from('memberships').insert({
    organisation_id: organisation.id,
    user_id: user.id,
    role: 'owner',
  });
  if (membershipError) return { error: membershipError.message };

  revalidatePath('/console');
  return { notice: `${name} created. You are its owner.` };
}

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

/**
 * Invites someone by email.
 *
 * There is no email sender yet, so the link is returned once, here, for the
 * inviter to pass on. That is stated plainly rather than hidden: an invitation
 * the customer thinks was emailed and was not is worse than one they know they
 * have to send themselves.
 */
export async function inviteMember(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user } = await signedIn();
  if (!user) return { error: 'You are signed out.' };

  const organisationId = String(formData.get('organisationId') ?? '');
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const role = String(formData.get('role') ?? 'member');

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'That is not an email address.' };
  if (!['member', 'admin'].includes(role)) {
    return { error: 'Invite someone as a member or an admin. Ownership is granted, not invited.' };
  }

  const { token, tokenSha256, expiresAt } = createInvitationToken();
  const { error } = await supabase.from('invitations').insert({
    organisation_id: organisationId,
    email,
    role,
    token_sha256: tokenSha256,
    invited_by: user.id,
    expires_at: expiresAt.toISOString(),
  });
  if (error) return { error: error.message };

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  revalidatePath(`/console/workspace/${organisationId}/team`);
  return {
    notice:
      `Invitation created for ${email}, valid until ${expiresAt.toISOString().slice(0, 10)}. ` +
      `We do not send the email yet, so send them this link yourself — it is shown once and we cannot show it again: ${origin}/invite/${token}`,
  };
}

export async function revokeInvitation(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user } = await signedIn();
  if (!user) return { error: 'You are signed out.' };

  const invitationId = String(formData.get('invitationId') ?? '');
  const { data, error } = await supabase
    .from('invitations')
    .update({ revoked_at: new Date().toISOString(), revoked_by: user.id })
    .eq('id', invitationId)
    .is('accepted_at', null)
    .select('organisation_id')
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: 'That invitation has already been used or withdrawn.' };

  revalidatePath(`/console/workspace/${data.organisation_id}/team`);
  return { notice: 'Withdrawn. The link stops working immediately and the seat is free again.' };
}

/**
 * Accepting an invitation.
 *
 * Both halves are checked: the token, in constant time against its stored hash,
 * and the signed-in address against the address it was sent to. A forwarded link
 * is a link that works for the wrong person.
 */
export async function acceptInvitation(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user } = await signedIn();
  if (!user?.email) return { error: 'Sign in with the address the invitation was sent to.' };

  const token = String(formData.get('token') ?? '');
  if (!token) return { error: 'That invitation link is not valid.' };

  const { data: invitation } = await supabase
    .from('invitations')
    .select('id, organisation_id, email, role, accepted_at, revoked_at, expires_at')
    .eq('token_sha256', hashInvitationToken(token))
    .maybeSingle();

  const verdict = canAccept(
    invitation
      ? {
          email: String(invitation.email),
          acceptedAt: invitation.accepted_at ? new Date(invitation.accepted_at) : null,
          revokedAt: invitation.revoked_at ? new Date(invitation.revoked_at) : null,
          expiresAt: new Date(invitation.expires_at),
        }
      : null,
    user.email,
  );
  if (!verdict.ok) return { error: verdict.message };

  const { error: membershipError } = await supabase.from('memberships').insert({
    organisation_id: invitation!.organisation_id,
    user_id: user.id,
    role: invitation!.role,
    invited_by: null,
  });
  if (membershipError) return { error: membershipError.message };

  const { error } = await supabase
    .from('invitations')
    .update({ accepted_at: new Date().toISOString(), accepted_by: user.id })
    .eq('id', invitation!.id);
  if (error) return { error: error.message };

  revalidatePath('/console');
  return { notice: 'You are in. The workspace is on your console.' };
}

export async function changeRole(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await signedIn();
  if (!user) return { error: 'You are signed out.' };

  const membershipId = String(formData.get('membershipId') ?? '');
  const role = String(formData.get('role') ?? '');
  if (!['owner', 'admin', 'member'].includes(role)) return { error: 'Unknown role.' };

  const { data, error } = await supabase
    .from('memberships')
    .update({ role })
    .eq('id', membershipId)
    .select('organisation_id')
    .maybeSingle();
  // The policy refuses an admin promoting anyone to owner, so this can fail
  // legitimately. Say what happened rather than showing a raw database error.
  if (error) {
    return {
      error:
        role === 'owner'
          ? 'Only an owner can make someone else an owner.'
          : error.message,
    };
  }
  if (!data) return { error: 'You are not permitted to change that membership.' };

  revalidatePath(`/console/workspace/${data.organisation_id}/team`);
  return { notice: `Role changed to ${role}.` };
}

export async function removeMember(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user } = await signedIn();
  if (!user) return { error: 'You are signed out.' };

  const membershipId = String(formData.get('membershipId') ?? '');
  const { data: membership } = await supabase
    .from('memberships')
    .select('organisation_id')
    .eq('id', membershipId)
    .maybeSingle();

  const { error } = await supabase.from('memberships').delete().eq('id', membershipId);
  // The database refuses to remove the last owner. That message is the useful one.
  if (error) {
    return {
      error: /owner/i.test(error.message)
        ? 'A workspace must keep at least one owner. Make someone else an owner first.'
        : error.message,
    };
  }

  if (membership) revalidatePath(`/console/workspace/${membership.organisation_id}/team`);
  return { notice: 'Removed. Their access ends immediately.' };
}

// ---------------------------------------------------------------------------
// Policy profiles
// ---------------------------------------------------------------------------

const DIMENSIONS = [
  'functional_integrity',
  'security_posture',
  'data_privacy_practice',
  'practicality_ux',
  'production_readiness',
  'store_distribution_readiness',
] as const;

function optionalScore(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
  return parsed;
}

/**
 * Saving a policy profile.
 *
 * Every field here is a floor the organisation requires. There is deliberately
 * no field that raises anything: a profile can fail an application the rubric
 * passed, and the type in `@vibefy/policy` structurally cannot express the
 * reverse.
 */
export async function savePolicyProfile(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user } = await signedIn();
  if (!user) return { error: 'You are signed out.' };

  const organisationId = String(formData.get('organisationId') ?? '');
  const profileId = String(formData.get('profileId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (name.length < 2) return { error: 'Give the profile a name your team will recognise.' };

  const floors: Record<string, number> = {};
  for (const dimension of DIMENSIONS) {
    const value = optionalScore(formData.get(`floor_${dimension}`));
    if (value !== null) floors[dimension] = value;
  }

  const maxOpenSeverity = String(formData.get('maxOpenSeverity') ?? '').trim();
  const row = {
    organisation_id: organisationId,
    name,
    description: String(formData.get('description') ?? '').trim() || null,
    min_overall_score: optionalScore(formData.get('minOverallScore')),
    dimension_floors: floors,
    max_open_severity: ['critical', 'high', 'medium', 'low', 'info'].includes(maxOpenSeverity)
      ? maxOpenSeverity
      : null,
    require_certification: formData.get('requireCertification') === 'on',
    require_store_readiness: formData.get('requireStoreReadiness') === 'on',
    is_default: formData.get('isDefault') === 'on',
    created_by: user.id,
  };

  const { error } = profileId
    ? await supabase.from('policy_profiles').update(row).eq('id', profileId)
    : await supabase.from('policy_profiles').insert(row);
  if (error) return { error: error.message };

  revalidatePath(`/console/workspace/${organisationId}/policies`);
  return {
    notice:
      'Saved. This profile is applied over scores that were computed without knowing it exists — it can fail an application the rubric passed, and it never changes a score.',
  };
}

export async function deletePolicyProfile(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user } = await signedIn();
  if (!user) return { error: 'You are signed out.' };

  const profileId = String(formData.get('profileId') ?? '');
  const organisationId = String(formData.get('organisationId') ?? '');
  const { error } = await supabase.from('policy_profiles').delete().eq('id', profileId);
  if (error) return { error: error.message };

  revalidatePath(`/console/workspace/${organisationId}/policies`);
  return { notice: 'Deleted. Applications that used it are no longer measured against any profile.' };
}

export async function assignPolicyProfile(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user } = await signedIn();
  if (!user) return { error: 'You are signed out.' };

  const appId = String(formData.get('appId') ?? '');
  const profileId = String(formData.get('profileId') ?? '');
  const { error } = await supabase
    .from('apps')
    .update({ policy_profile_id: profileId || null })
    .eq('id', appId);
  if (error) return { error: error.message };

  revalidatePath(`/console/apps/${appId}`);
  return { notice: profileId ? 'Profile applied.' : 'Profile removed.' };
}

// ---------------------------------------------------------------------------
// White-label
// ---------------------------------------------------------------------------

const MAX_LOGO_BYTES = 128 * 1024;

/**
 * An agency's cover block.
 *
 * Two guardrails are enforced here rather than trusted: the logo is small enough
 * to embed in a PDF that must render with no network, and the accent colour is
 * only used by the renderer if it is legible on the report surface. Neither the
 * badge nor the Vibefy wordmark is touched by any of this — the report always
 * says who performed the assessment.
 */
export async function saveBranding(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user } = await signedIn();
  if (!user) return { error: 'You are signed out.' };

  const organisationId = String(formData.get('organisationId') ?? '');
  const displayName = String(formData.get('displayName') ?? '').trim();
  if (displayName.length < 2) return { error: 'Give the name your clients will recognise.' };

  const accentColour = String(formData.get('accentColour') ?? '').trim();
  if (accentColour && !/^#[0-9a-fA-F]{6}$/.test(accentColour)) {
    return { error: 'The accent colour must be a six-digit hex value, like #123456.' };
  }

  const logo = formData.get('logo');
  let logoDataUri: string | null | undefined;
  if (logo instanceof File && logo.size > 0) {
    if (logo.size > MAX_LOGO_BYTES) {
      return { error: 'The logo must be under 128 KB — it is embedded in every PDF you hand out.' };
    }
    if (!['image/png', 'image/jpeg', 'image/svg+xml'].includes(logo.type)) {
      return { error: 'Upload a PNG, JPEG or SVG.' };
    }
    const bytes = Buffer.from(await logo.arrayBuffer());
    logoDataUri = `data:${logo.type};base64,${bytes.toString('base64')}`;
  }

  const { error } = await supabase.from('workspace_branding').upsert(
    {
      organisation_id: organisationId,
      display_name: displayName,
      accent_colour: accentColour || null,
      contact_line: String(formData.get('contactLine') ?? '').trim() || null,
      footer_note: String(formData.get('footerNote') ?? '').trim() || null,
      ...(logoDataUri === undefined ? {} : { logo_data_uri: logoDataUri }),
    },
    { onConflict: 'organisation_id' },
  );
  if (error) return { error: error.message };

  revalidatePath(`/console/workspace/${organisationId}/branding`);
  return {
    notice:
      'Saved. Reports for this workspace now carry your cover block, and still state that Vibefy carried out the assessment against the published rubric.',
  };
}

// ---------------------------------------------------------------------------
// Single sign-on
// ---------------------------------------------------------------------------

/**
 * Claiming an email domain for single sign-on.
 *
 * The domain is verified by DNS TXT, the same way an application's ownership is,
 * and for a stronger reason: an unverified domain claim would let anyone route
 * another company's staff logins through their own identity provider. The claim
 * is unique across the platform, enforced by the database.
 */
export async function saveSsoConnection(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user } = await signedIn();
  if (!user) return { error: 'You are signed out.' };

  const organisationId = String(formData.get('organisationId') ?? '');
  const emailDomain = String(formData.get('emailDomain') ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '');
  const provider = String(formData.get('provider') ?? 'saml');
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(emailDomain)) {
    return { error: 'That is not a domain. Enter something like acme.example.' };
  }
  if (!['saml', 'oidc'].includes(provider)) return { error: 'Choose SAML or OIDC.' };

  const { error } = await supabase.from('sso_connections').insert({
    organisation_id: organisationId,
    email_domain: emailDomain,
    provider,
    domain_challenge: `${DNS_RECORD_PREFIX}${randomBytes(16).toString('hex')}`,
    default_role: String(formData.get('defaultRole') ?? 'member') === 'admin' ? 'admin' : 'member',
    created_by: user.id,
  });
  if (error) {
    return {
      error: /unique|duplicate/i.test(error.message)
        ? 'That domain is already claimed. If it is yours, contact us — two workspaces cannot both own one domain.'
        : error.message,
    };
  }

  revalidatePath(`/console/workspace/${organisationId}/sso`);
  return { notice: 'Claimed. Publish the DNS record shown below, then verify it.' };
}

export async function verifySsoDomain(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user } = await signedIn();
  if (!user) return { error: 'You are signed out.' };

  const connectionId = String(formData.get('connectionId') ?? '');
  const { data: connection } = await supabase
    .from('sso_connections')
    .select('id, organisation_id, email_domain, domain_challenge')
    .eq('id', connectionId)
    .maybeSingle();
  if (!connection) return { error: 'No such connection.' };

  const token = String(connection.domain_challenge).replace(DNS_RECORD_PREFIX, '');
  const outcome = await verifyDnsTxt(String(connection.email_domain), token);
  if (!outcome.verified) {
    return { error: outcome.detail };
  }

  const { error } = await supabase
    .from('sso_connections')
    .update({ domain_verified_at: new Date().toISOString() })
    .eq('id', connectionId);
  if (error) return { error: error.message };

  revalidatePath(`/console/workspace/${connection.organisation_id}/sso`);
  return {
    notice:
      'Domain verified. Registering the identity provider itself is still a manual step on our side — see docs/OPEN_ITEMS.md. Nothing changes for your users until it is done.',
  };
}

export async function setSsoEnforcement(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user } = await signedIn();
  if (!user) return { error: 'You are signed out.' };

  const connectionId = String(formData.get('connectionId') ?? '');
  const enforced = formData.get('enforced') === 'on';
  const { data, error } = await supabase
    .from('sso_connections')
    .update({ enforced })
    .eq('id', connectionId)
    .select('organisation_id')
    .maybeSingle();
  if (error) {
    return {
      error: /sso_enforced_needs_verified_domain/.test(error.message)
        ? 'Verify the domain before enforcing single sign-on. Enforcing an unverified domain would lock out the people who own it.'
        : error.message,
    };
  }
  if (!data) return { error: 'You are not permitted to change that connection.' };

  revalidatePath(`/console/workspace/${data.organisation_id}/sso`);
  return {
    notice: enforced
      ? 'Enforced. Password sign-in is refused for addresses at this domain.'
      : 'No longer enforced. Password sign-in works again for this domain.',
  };
}
