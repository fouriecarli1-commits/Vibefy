-- audit-marker: exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='session_passed_second_step')
-- =============================================================================
-- A second step, required at the action rather than at the door.
--
-- Anré's decision, asked for and given: enforce it server-side on the handful
-- of actions that matter, not on every sign-in. Requiring an authenticator app
-- of a solo builder trying a free assessment costs us the customer and buys
-- them nothing — their account holds one unassessed application. The actions
-- below are the ones where somebody else's reputation or somebody else's
-- findings are at stake.
--
-- ## Why this is in the database and not in a server action
--
-- `apps/web` already refuses these at the action, and that refusal is worth
-- having because it can explain itself. It is not the enforcement. Every one of
-- these writes goes through PostgREST with the anon key and a user's access
-- token, so anything the web layer decides can be skipped by not using the web
-- layer. The rule has to be true where the row is written.
--
-- ## Why `as restrictive`
--
-- Permissive policies are ORed. `public.memberships` already carries two that
-- permit an admin to insert — `memberships_insert_admins` from the foundations
-- migration and `memberships_manage_admins` from the workspaces one — so adding
-- a condition to either of them would have achieved exactly nothing while
-- looking like a control. A restrictive policy is ANDed with all of them, and
-- with any permissive policy somebody adds later without reading this comment.
-- That last part is the point: this is the shape of rule that must not quietly
-- stop applying.
--
-- ## What is deliberately NOT restricted
--
-- **Reading.** Every policy here touches writes only. A reviewer who has not
-- enrolled yet must be able to sign in, see where they are, and reach
-- `/console/security` to enrol — enrolment is in the `auth` schema and none of
-- these policies reach it, so the way out of the restriction is always open.
-- Restricting `select` would lock the operator out of the product on the day
-- this migration runs, which is not a security control, it is an outage.
--
-- **Leaving a workspace.** `delete` on `public.memberships` is untouched. A
-- member may always remove themselves, and requiring a second step to leave is
-- friction with nothing on the other side of it: removal grants no access.
--
-- **A customer reading their own report, submitting their own application, or
-- paying.** Those are the moments where friction costs us somebody and protects
-- nobody. If that judgement is wrong it is one more restrictive policy, and the
-- reasoning is in docs/OPEN_ITEMS.md rather than assumed here.
--
-- ## What happens on the day this runs
--
-- A reviewer or workspace admin whose session is at assurance level one can
-- still sign in and read everything they could read yesterday. The first write
-- below is refused until they enrol a factor at `/console/security`, which
-- upgrades the session in the same breath — Supabase issues a level-two token
-- when the enrolment code is verified. Nobody is locked out; the queue is
-- paused for one person for as long as it takes them to scan a QR code.
-- =============================================================================

-- `aal` is a claim Supabase puts in every access token: `aal1` for a password
-- alone, `aal2` once a factor has been answered. Read through `auth.jwt()` so
-- this says the same thing as the client library does.
--
-- Anything other than `aal2` is false, including a missing claim. A token whose
-- assurance we cannot read has not proved anything, and the whole failure this
-- file guards against is a missing answer counting as a good one.
create or replace function public.session_passed_second_step()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

comment on function public.session_passed_second_step is
  'True only where the current access token was issued after a second factor '
  'was answered. A missing or unreadable aal claim is false: a token whose '
  'assurance we cannot read has not proved anything.';

-- -----------------------------------------------------------------------------
-- The gate on every badge
-- -----------------------------------------------------------------------------
--
-- A badge cannot issue without an approved assessment, and an assessment cannot
-- be approved without a row in `public.reviews` — the transition trigger
-- refuses it. So this one policy stands in front of every mark this product
-- will ever put on somebody's website, which is the reason it is first.

create policy reviews_need_second_step on public.reviews
  as restrictive
  for insert to authenticated
  with check (public.session_passed_second_step());

-- Suspension, revocation and reinstatement are updates to a live badge, and
-- revocation is the one action here that is visible to the public within
-- minutes. Insert is included because `badges_write_reviewers` is `for all`.

create policy badges_need_second_step_insert on public.badges
  as restrictive
  for insert to authenticated
  with check (public.session_passed_second_step());

create policy badges_need_second_step_update on public.badges
  as restrictive
  for update to authenticated
  with check (public.session_passed_second_step());

-- -----------------------------------------------------------------------------
-- Letting another person see somebody's findings
-- -----------------------------------------------------------------------------
--
-- An invitation and a membership are the two ways a human who is not the
-- customer comes to read a customer's findings. A role change is the third: an
-- admin who can promote is an owner with an extra step.

create policy invitations_need_second_step_insert on public.invitations
  as restrictive
  for insert to authenticated
  with check (public.session_passed_second_step());

-- Update is restricted because a live invitation can be redirected: change the
-- address on one and a stolen password becomes a second account. Withdrawing
-- one is the exception and is deliberately left open — it reduces access, it is
-- what an admin does the moment they realise they invited the wrong person, and
-- a control that stands between somebody and undoing their own mistake is
-- working against the thing it is for. A revoked invitation is dead, so a row
-- that sets `revoked_at` may set anything else with it.
create policy invitations_need_second_step_update on public.invitations
  as restrictive
  for update to authenticated
  with check (public.session_passed_second_step() or revoked_at is not null);

create policy memberships_need_second_step_insert on public.memberships
  as restrictive
  for insert to authenticated
  with check (public.session_passed_second_step());

-- No equivalent exception here. A role change is the escalation, and working
-- out from inside a policy whether a particular change is a promotion or a
-- demotion is the kind of cleverness that is wrong once and silently. An admin
-- who wants to demote somebody in a hurry is an admin who can scan a QR code
-- first; the person they are demoting is not going anywhere.
create policy memberships_need_second_step_update on public.memberships
  as restrictive
  for update to authenticated
  with check (public.session_passed_second_step());
