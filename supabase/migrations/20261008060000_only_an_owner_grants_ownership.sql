-- audit-marker: exists (select 1 from pg_policy where polrelid = 'public.memberships'::regclass and polname = 'memberships_only_an_owner_grants_ownership')
--
-- An admin could promote themselves to owner.
--
-- Measured on the test database, in a workspace with an owner and an admin, as
-- the admin and nothing else:
--
--     update public.memberships set role = 'owner'
--      where organisation_id = '…' and user_id = '…';
--
--     SELF PROMOTION ALLOWED: owner
--     UPDATE 1
--
-- `memberships_manage_admins` has the right rule and has had it all along:
--
--     with check (has_org_role(organisation_id, ARRAY['owner','admin'])
--                 and (role <> 'owner' or has_org_role(organisation_id, ARRAY['owner'])))
--
-- Permissive policies are ORed, and this table carries two more:
-- `memberships_update_admins` and `memberships_insert_admins`, both of which
-- check only `has_org_role(organisation_id, ARRAY['owner','admin'])`. So the
-- guard in the first one has never applied to anything. An admin passes the
-- weaker policy and the stronger one is simply not consulted.
--
-- This is the trap `20260923110000_second_step_at_the_action` wrote down, in
-- those words, about this table:
--
--     Permissive policies are ORed. `public.memberships` already carries two
--     that permit an insert — `memberships_insert_admins` from the foundations
--     migration and `memberships_manage_admins` from the workspaces one — so
--     adding a condition to either of them would have achieved exactly nothing
--     while looking like a control.
--
-- It was written about a second factor. The sentence was equally true of the
-- ownership guard sitting a few lines above it, and nothing was looking.
--
-- Measured across the whole schema afterwards: `memberships` is the only table
-- with two permissive write policies whose conditions differ. The query is in
-- `tests/only-an-owner-grants-ownership.test.ts`, which now holds that as a
-- rule, with the one intended overlap named — `memberships_delete_admin_or_self`
-- against `memberships_manage_admins`, where leaving a workspace yourself and
-- removing somebody else are genuinely two different grants.
--
-- ## Why ownership is the boundary worth a policy of its own
--
-- The schema already treats it as one, in two places that both go through a
-- different door: `invitations_never_grant_ownership` refuses an invitation
-- that would grant it, and `sso_default_role_is_not_owner` refuses a single
-- sign-on connection that would hand it out automatically. Both of those held;
-- the one route that is a plain UPDATE did not. `sso_write_owners` is
-- owner-only, so an admin who promoted themselves could then claim an email
-- domain, which is the migration two before this one.
--
-- ## Restrictive, so the next policy cannot undo it
--
-- A restrictive policy is ANDed with every permissive one, including any added
-- later by somebody who has not read this. That is the whole point: the defect
-- here is not a missing condition, it is a condition in a place where another
-- policy could ignore it.
--
-- `with check` only, and no `using`: this is about the row being written, not
-- about which rows may be seen or targeted. An owner demoting another owner, an
-- admin changing somebody's role to `member`, an admin removing themselves —
-- all unchanged.

-- -----------------------------------------------------------------------------
-- The two weaker policies go, because they said nothing the strong one does not
-- -----------------------------------------------------------------------------
--
-- `memberships_manage_admins` is `for all` with the same
-- `has_org_role(organisation_id, ARRAY['owner','admin'])`, so these two grant
-- nothing it does not already grant — they only subtracted the guard. Leaving
-- them beside a restrictive policy would work, and would also leave the next
-- reader with three permissive policies to reconcile and no way to tell which
-- one is load-bearing.
--
-- `memberships_delete_admin_or_self` stays: removing yourself from a workspace
-- and removing somebody else are two different grants, and neither is a
-- weakened form of the other.
--
-- The inline guard in `memberships_manage_admins` stays too, now redundant. It
-- is the sentence somebody will read first when they come to this table, and a
-- correct rule written twice costs nothing.

drop policy memberships_insert_admins on public.memberships;
drop policy memberships_update_admins on public.memberships;

create policy memberships_only_an_owner_grants_ownership on public.memberships
  as restrictive for insert to authenticated
  with check (
    role <> 'owner'
    or public.has_org_role(organisation_id, array['owner']::public.org_role[])
  );

create policy memberships_only_an_owner_keeps_granting_ownership on public.memberships
  as restrictive for update to authenticated
  with check (
    role <> 'owner'
    or public.has_org_role(organisation_id, array['owner']::public.org_role[])
  );

comment on policy memberships_only_an_owner_grants_ownership on public.memberships is
  'Only an owner may create an owner. Restrictive, because the permissive policy that said so was ORed away by two that did not.';

comment on policy memberships_only_an_owner_keeps_granting_ownership on public.memberships is
  'Only an owner may promote anybody to owner. The update half of the same rule.';
