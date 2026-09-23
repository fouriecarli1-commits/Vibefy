-- audit-marker: exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='accept_invitation')
-- =============================================================================
-- Accepting an invitation, which has never once worked.
--
-- Found while putting a second step in front of the actions that grant somebody
-- access to a customer's findings: the invitation flow was already refused by
-- the policies it goes through, and had been since the workspaces migration.
--
-- Proved against the database rather than read off the page. As the invited
-- user:
--
--   · `select ... from public.invitations where token_sha256 = $1` returns
--     **zero rows**. The only policy on that table is
--     `invitations_manage_admins`, which wants `owner` or `admin` on the
--     organisation — and somebody who has not joined yet holds no role in it.
--   · `insert into public.memberships ...` is refused outright. Both policies
--     that permit an insert want that same role.
--
-- So `acceptInvitation` read nothing, passed `null` to `canAccept`, and told the
-- person "That invitation link is not valid." An agency could invite a
-- colleague, the colleague could click the link, and the answer was that their
-- link was bad — which is the worst available shape for this bug, because it
-- sends them to check the thing that was fine and never mentions us.
--
-- ## Why a function and not two more policies
--
-- A policy letting somebody read invitations addressed to them would make the
-- token hash readable by its holder, and the table stores only a hash precisely
-- because an invitation link is a credential. A policy letting somebody insert
-- their own membership would have to re-check the invitation inside the policy,
-- where a mistake is invisible.
--
-- So the whole exchange is one `security definer` function: hand it the token,
-- it decides, and it either creates the membership and marks the invitation used
-- in a single statement pair, or it raises with the reason. Nothing about the
-- invitation is ever returned to the caller — not the hash, not the
-- organisation, not who invited them. A caller with a token learns only whether
-- it worked and why not.
--
-- ## Why it does not need a second step
--
-- The restrictive policies added alongside this require an authenticator app
-- before somebody may grant another person access to a customer's findings.
-- This is the other side of that: a brand-new colleague, minutes old, who has
-- been granted access rather than granting it. Requiring a factor here would
-- mean the only way into a workspace is to set up an authenticator app first,
-- which is the friction that was explicitly not wanted — and `security definer`
-- means those policies do not apply inside this function, deliberately and in
-- one place where it can be read.
--
-- ## The refusals say the same words the TypeScript did
--
-- `canAccept` in `packages/workspace` still exists and still produces the
-- sentences a person reads. These messages match it deliberately, so the two
-- cannot drift into telling somebody two different things about one link, and a
-- test holds them to each other.
-- =============================================================================

create or replace function public.accept_invitation(token text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller       uuid := auth.uid();
  caller_email citext;
  invitation   record;
begin
  if caller is null then
    raise exception 'Sign in with the address the invitation was sent to.'
      using errcode = 'insufficient_privilege';
  end if;

  -- `auth.users` rather than `public.users`: the address the invitation was
  -- sent to is the one the account authenticates with, and that is the column
  -- Supabase keeps it in.
  select u.email into caller_email from auth.users u where u.id = caller;

  -- `for update` because two clicks on one link arriving together would
  -- otherwise both pass the checks below. The unique index on a live invitation
  -- would catch the second membership, but with a constraint error rather than
  -- a sentence, and the whole point of this function is the sentence.
  select * into invitation
    from public.invitations
   -- Built-in `sha256`, not pgcrypto's `digest`. pgcrypto lives in `public`
   -- locally and in `extensions` on hosted Supabase, and this function pins its
   -- search_path — so `digest` would resolve here and fail there, which is the
   -- worst place to find out.
   where token_sha256 = encode(sha256(convert_to(token, 'utf8')), 'hex')
   for update;

  -- Every branch below is one of `canAccept`'s, in its words.
  --
  -- The *order* is deliberately not `canAccept`'s, and the difference is the
  -- point of these two comments. A forwarded link must teach whoever received
  -- it nothing about the invitation, so the address is checked before any of
  -- its state; and somebody who is already a member is answered calmly before
  -- we start refusing, because the honest cause of a second click is a second
  -- click.
  if invitation.id is null then
    raise exception 'That invitation link is not valid.' using errcode = 'no_data_found';
  end if;

  if lower(btrim(invitation.email::text)) <> lower(btrim(coalesce(caller_email::text, ''))) then
    -- Deliberately does not name the address it was sent to. A forwarded link
    -- would otherwise tell whoever received it who else is in the workspace,
    -- and it is checked first so that it tells them nothing about the state of
    -- the invitation either.
    raise exception 'That invitation was sent to a different address. Sign in with the address it was sent to.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Already a member: answered rather than refused, and answered before the
  -- three refusals below. Somebody who joined and clicked the link again — or
  -- whose browser sent the form twice — has done nothing wrong, and telling
  -- them their invitation "has already been used" is true and useless.
  if exists (
    select 1 from public.memberships
     where organisation_id = invitation.organisation_id and user_id = caller
  ) then
    update public.invitations
       set accepted_at = coalesce(accepted_at, now()), accepted_by = coalesce(accepted_by, caller)
     where id = invitation.id;
    return invitation.organisation_id;
  end if;

  if invitation.revoked_at is not null then
    raise exception 'That invitation was withdrawn.' using errcode = 'restrict_violation';
  end if;
  if invitation.expires_at <= now() then
    raise exception 'That invitation expired on %. Ask for a new one.',
      to_char(invitation.expires_at, 'YYYY-MM-DD') using errcode = 'restrict_violation';
  end if;
  -- Last, because by here the caller is the addressee and is not a member: the
  -- link was used by somebody else, or used and then the membership removed.
  if invitation.accepted_at is not null then
    raise exception 'That invitation has already been used.' using errcode = 'restrict_violation';
  end if;

  -- The seat trigger on `memberships` still applies: this function has the
  -- privilege to write the row, not the privilege to exceed what was bought.
  insert into public.memberships (organisation_id, user_id, role, invited_by)
  values (invitation.organisation_id, caller, invitation.role, invitation.invited_by);

  update public.invitations
     set accepted_at = now(), accepted_by = caller
   where id = invitation.id;

  return invitation.organisation_id;
end;
$$;

comment on function public.accept_invitation is
  'Exchanges an invitation token for a membership. The only route by which an '
  'invited person can join: the policies on invitations and memberships both '
  'want a role in the organisation, which somebody who has not joined does not '
  'have. Returns the organisation joined, and nothing about the invitation.';

revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;
