-- Agtien migrasies, in hierdie volgorde.
-- Gegenereer 2026-09-24, aangevul 2026-10-09.
--
-- Onseker wat jou databasis het? node tools/migration-audit.mjs > audit.sql, en plak
-- daardie navraag in die SQL-venster. Dit lees net; dit skryf en sluit niks.

-- =============================================================================
-- 20260923110000_second_step_at_the_action.sql
-- =============================================================================
-- audit-marker: exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='session_passed_second_step')
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

-- =============================================================================
-- 20260923120000_accept_invitation.sql
-- =============================================================================
-- audit-marker: exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='accept_invitation')
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

-- =============================================================================
-- 20260923130000_create_workspace.sql
-- =============================================================================
-- audit-marker: exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_workspace')
-- audit-marker: exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_workspace')
-- =============================================================================
-- Creating a shared workspace, which has never once worked either.
--
-- The second instance of the shape that killed invitation acceptance, found by
-- going looking for it rather than by waiting for it: a server action writes as
-- the signed-in user, and no policy can be true for that user at the moment the
-- write happens.
--
-- Here the mechanism is subtler and worth writing down, because it is invisible
-- in the policy.
--
--   · `organisations_insert_own` permits the insert: `created_by = auth.uid()`
--     is exactly what the action sets. The insert on its own succeeds.
--   · `createWorkspace` needs the new id, so it writes
--     `.insert({...}).select('id').single()` — which PostgREST sends as
--     `insert ... returning id`.
--   · `returning` is a read. It is checked against
--     `organisations_select_members`, which asks `is_org_member(id)` — and at
--     that instant the creator holds no membership in the organisation being
--     created, because the membership is the very next statement.
--
-- So every attempt to create an agency or an organisation workspace failed with
-- "new row violates row-level security policy for table organisations", from a
-- form that is wired into `/console/workspace` today. The whole shared-workspace
-- tier was unreachable.
--
-- Nothing was left behind: `insert ... returning` fails as one statement, so no
-- row was written and no slug was taken. I had assumed otherwise and checked;
-- that is the only reason this comment can say so.
--
-- ## Why a function
--
-- Loosening `organisations_select_members` to let a creator read what they
-- created would make every organisation readable by whoever set `created_by`,
-- which is the wrong direction on the one table that decides what everything
-- else is scoped to. The two writes also have to be atomic: an organisation
-- with no members is invisible to every policy in this schema, so it can be
-- neither seen, changed, nor deleted by anybody.
--
-- ## Why it needs no second step
--
-- The restrictive policies added beside this require an authenticator app
-- before somebody may grant *another* person access to a customer's findings.
-- Creating your own workspace grants nobody anything: you are its only member
-- and its owner. Same reasoning as accepting an invitation, and `security
-- definer` is what keeps those policies out of here — deliberately, in one
-- place, with the reason written next to it.
--
-- ## The slug
--
-- Derived in TypeScript, where it was already derived, and passed in — one
-- implementation rather than two drifting. Collisions are resolved here,
-- because here is where the unique constraint is. A second workspace called
-- the same thing gets a suffix rather than an error: a name being unavailable
-- across every customer of this product is our problem to solve, not theirs to
-- work around.
-- =============================================================================

create or replace function public.create_workspace(
  workspace_name text,
  workspace_slug text,
  workspace_account_type public.account_type
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller       uuid := auth.uid();
  candidate    text;
  created      uuid;
begin
  if caller is null then
    raise exception 'You are signed out.' using errcode = 'insufficient_privilege';
  end if;

  -- A personal workspace is created by the trigger on `auth.users`, once, and is
  -- the only one with `is_personal`. This route makes shared ones.
  if workspace_account_type not in ('agency', 'organisation') then
    raise exception 'A shared workspace is either an agency or an organisation.'
      using errcode = 'check_violation';
  end if;
  if length(btrim(coalesce(workspace_name, ''))) < 2 then
    raise exception 'Give the workspace a name.' using errcode = 'check_violation';
  end if;

  -- The slug the caller derived, then the same with a suffix. Five attempts
  -- rather than a loop with no end: if five random suffixes collide, something
  -- is wrong that a sixth will not fix.
  candidate := workspace_slug;
  for attempt in 1..5 loop
    begin
      insert into public.organisations
        (name, slug, account_type, is_personal, created_by, billing_email)
      values (
        btrim(workspace_name), candidate, workspace_account_type, false, caller,
        (select u.email from auth.users u where u.id = caller)
      )
      returning id into created;
      exit;
    exception when unique_violation then
      candidate := left(workspace_slug, 54) || '-' || substr(md5(random()::text), 1, 6);
    end;
  end loop;

  if created is null then
    raise exception 'Could not find an unused address for that name. Try a different one.'
      using errcode = 'unique_violation';
  end if;

  -- The membership, in the same transaction as the organisation. Separately they
  -- are an organisation nobody can see and a function that reports success.
  insert into public.memberships (organisation_id, user_id, role)
  values (created, caller, 'owner');

  return created;
end;
$$;

comment on function public.create_workspace is
  'Creates a shared workspace and its owner membership in one transaction. The '
  'only route: organisations_select_members asks is_org_member, which is false '
  'for the creator until the membership exists, so an insert ... returning on '
  'that table can never succeed from the application.';

revoke all on function public.create_workspace(text, text, public.account_type) from public, anon;
grant execute on function public.create_workspace(text, text, public.account_type) to authenticated;

-- =============================================================================
-- 20260923140000_name_the_role.sql
-- =============================================================================
-- audit-marker: not exists (select 1 from pg_policies where schemaname='public' and 'public' = any(roles))
-- audit-marker: not exists (select 1 from pg_policies where schemaname='public' and 'public' = any(roles))
-- =============================================================================
-- Two policies that never named the role they apply to.
--
-- Every policy in this schema says `to authenticated`. These two do not, so
-- Postgres gives them the catch-all `public` role — which includes `anon`, and
-- every role that exists or will exist.
--
-- Nothing leaks today. Neither table is granted to `anon`, so `anon` cannot
-- reach them at all, and both conditions reduce to false without a session:
-- `is_org_member` and `is_platform_admin` both go through `auth.uid()`, which
-- is null. This is a latent hole rather than an open one.
--
-- It is worth closing anyway, and not for tidiness. The way this becomes real is
-- ordinary: somebody adds a public view over one of these tables, grants select
-- on the underlying table to `anon` to make it work, and the policy that was
-- always written for signed-in people quietly starts being consulted for
-- everybody. The grant would be reviewed. The policy would not, because nobody
-- changed it.
--
-- Found by measuring rather than reading: after mutating the read policies and
-- the triggers, the remaining question was what `anon` can reach, and asking the
-- catalogue which policies name `anon` or `public` turned up exactly these two.
--
-- `alter policy ... to authenticated` only narrows. Nothing that works today
-- stops working: the remediation code reaches these tables as the service role,
-- which bypasses policies, and a signed-in reader is `authenticated` either way.
-- =============================================================================

alter policy remediation_engagements_own on public.remediation_engagements to authenticated;
alter policy remediation_workers_admin on public.remediation_workers to authenticated;

-- =============================================================================
-- 20260924100000_a_review_authorises_its_own_transition.sql
-- =============================================================================
-- audit-marker: exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='assert_human_review' and pg_get_functiondef(p.oid) like '%r.action::text = new.status::text%')
-- =============================================================================
-- A review row authorises the transition it actually describes.
--
-- `public.assert_human_review` is Gate 3. It is the reason the public
-- verification page is allowed to say "a person read the result before anything
-- was issued", and it stands in front of every badge this product will ever put
-- on somebody's website. What it checked was weaker than what it claimed:
--
--     if not exists (
--       select 1 from public.reviews r
--       where r.assessment_id = new.id
--         and r.created_at >= now() - interval '1 hour'
--     )
--
-- Any review row, of any action, within the hour. The `action` column — the
-- column whose entire job is to record what the human decided — was never read,
-- so the gate was satisfied by a review that said the opposite of the transition
-- it admitted:
--
--   · A row saying `rejected` authorised `status = 'approved'`. The assessment
--     then carried an approval whose only recorded human decision was a
--     rejection, with the reviewer's written reason for rejecting it attached.
--   · A row saying `adjusted` did the same, and that one happened on its own.
--     `adjustAssessment` in `apps/web/app/review/actions.ts` writes an
--     `adjusted` row on every score correction and then updates only
--     `overall_score`, leaving the assessment in `awaiting_review` — so each
--     adjustment minted an approval token that stayed valid for an hour.
--
-- Neither needs anybody to act in bad faith. Both server actions write the
-- review row and then update the assessment in two separate statements with no
-- transaction around them, and `public.reviews` is append-only, so a refused
-- update leaves behind a committed row that cannot be withdrawn. The hour-long
-- window turned that orphan into an authorisation for whatever came next.
--
-- ## What is deliberately not changed
--
-- **The hour.** It is an existing decision about how long a reviewer's reading
-- stays current, and it was not the defect.
--
-- **The `awaiting_review` precondition.** Unchanged, and it is what keeps a
-- stale-but-matching row from being reused: one successful transition moves the
-- assessment out of `awaiting_review`, and the next one is refused there.
--
-- **Who presses the button.** The trigger does not require the review row's
-- reviewer to be the session user. `auth.uid()` is null when an operator
-- corrects a stuck row on the owning connection, so requiring a match would
-- refuse the only path that exists to unstick anything. Who decided is recorded
-- in the row; whether it was the same person who ran the update is a separate
-- question, and it is in docs/OPEN_ITEMS.md rather than decided here.
--
-- Watched failing before it was written: tests/a-review-authorises-its-own-
-- transition.test.ts, four failures on the four opposite-action combinations.
-- =============================================================================

-- audit-marker: exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='assert_human_review' and pg_get_functiondef(p.oid) like '%r.action::text = new.status::text%')
--
-- Said rather than guessed. This migration *replaces* `assert_human_review`,
-- which `20260822092000_assessments` created, so the audit's first
-- matching pattern would have reported this as applied whether it had run
-- or not. The marker reads the body instead, for the one clause this
-- migration adds.

create or replace function public.assert_human_review()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status in ('approved', 'rejected') and old.status is distinct from new.status then
    if old.status <> 'awaiting_review' then
      raise exception 'Assessment % must pass through awaiting_review before %', new.id, new.status
        using errcode = 'restrict_violation';
    end if;

    -- The action has to match the transition. Compared as text because the two
    -- enums are different types that happen to share these two words:
    -- `review_action` is ('approved', 'adjusted', 'rejected') and
    -- `assessment_status` carries 'approved' and 'rejected' among others. A cast
    -- between them would silently stop matching the day either gains a member.
    if not exists (
      select 1 from public.reviews r
      where r.assessment_id = new.id
        and r.action::text = new.status::text
        and r.created_at >= now() - interval '1 hour'
    ) then
      raise exception
        'Assessment % cannot be % without a recorded human review action of %',
        new.id, new.status, new.status
        using errcode = 'restrict_violation',
              hint = 'Insert the review row first, with its action matching the transition. AI never certifies alone, and a rejection is not an approval.';
    end if;
  end if;
  return new;
end;
$$;

-- =============================================================================
-- 20260924110000_what_a_provider_told_us_stays_told.sql
-- =============================================================================
-- audit-marker: exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='billing_events_only_handled_changes' and pg_get_functiondef(p.oid) like '%new.provider is distinct from old.provider%')
-- =============================================================================
-- "Everything else about the event is immutable" made true.
--
-- `public.billing_events` is what a provider told us and when, and its own
-- migration says what that is for: "the record we would produce in a billing
-- dispute". The comment above its update trigger says "The one field this table
-- is allowed to change after insert, once, when the handler finishes.
-- Everything else about the event is immutable."
--
-- The trigger compared four columns — `provider_event_id`, `event_type`,
-- `payload`, `occurred_at` — and said nothing about the other three.
--
--   · **`provider`** is half of `unique (provider, provider_event_id)`, which is
--     the idempotency guard this table exists to be. Changing it on an existing
--     row frees that slot, so the same event can be inserted and applied a
--     second time: a replay through an `update`, past the constraint built to
--     stop exactly that.
--   · **`organisation_id`** decides whose dispute this evidence belongs to.
--   · **`received_at`** is when we say we were told.
--
-- Nothing in the product changes any of them today, and `authenticated` holds
-- `select` only — so this is a last line rather than an open door. But writes
-- arrive through `writeAsService`, which connects as the owner and passes every
-- policy, which leaves this trigger as the only thing between the handler and
-- the record. That is precisely when a rule has to be true rather than intended.
--
-- ## Listed rather than inverted
--
-- The obvious tightening is "refuse unless the only changed columns are
-- `handled` and `handler_note`", and it is rejected on purpose. A column added
-- later would then be immutable by default and the insert path would start
-- failing in a way whose cause is three migrations away. Listing what may not
-- change keeps the failure where the decision is: add a column, decide whether
-- it belongs in this list, and say so here.
--
-- Watched failing before it was written: tests/what-a-provider-told-us-stays-
-- told.test.ts, three failures on the three columns, the other four already
-- refused.
-- =============================================================================

-- audit-marker: exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='billing_events_only_handled_changes' and pg_get_functiondef(p.oid) like '%new.provider is distinct from old.provider%')
--
-- Said rather than guessed. This migration *replaces* `billing_events_only_handled_changes`,
-- which `20260822120000_billing_events` created, so the audit's first
-- matching pattern would have reported this as applied whether it had run
-- or not. The marker reads the body instead, for the one clause this
-- migration adds.

create or replace function public.billing_events_only_handled_changes()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.provider_event_id is distinct from old.provider_event_id
     or new.event_type is distinct from old.event_type
     or new.payload is distinct from old.payload
     or new.occurred_at is distinct from old.occurred_at
     -- Half the replay guard. Without this, `update ... set provider = ...`
     -- frees the unique slot and the event can be applied twice.
     or new.provider is distinct from old.provider
     -- Whose dispute this is.
     or new.organisation_id is distinct from old.organisation_id
     -- When we say we were told.
     or new.received_at is distinct from old.received_at then
    raise exception 'billing_events records what a provider told us; only the handled flag may change'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

-- =============================================================================
-- 20261006200000_one_score_wherever_it_is_read.sql
-- =============================================================================
-- audit-marker: exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='assert_score_is_not_pulled_from_under_a_badge')
-- One score, wherever it is read.
--
-- The product says this in its own words, on the report screen: "Your score is
-- the same number wherever you read it." It reads as a description of a
-- database. It is a promise about two columns, and nothing was keeping it.
--
-- `assessments.overall_score` is what the owner's console and report show.
-- `badges.score` is what every public surface shows — the verification page the
-- mark links to, the badge image itself, the directory, a builder's profile.
-- It is written once, at issue, and never again.
--
-- Two ways they come apart, and neither left a trace.
--
--   1. At issue. `assert_badge_is_earned` checks the status, the certification
--      gate, the organisation and the rubric version — and says of that last
--      one, correctly, that a badge "must carry the rubric version the
--      assessment was scored against". The same argument applies to the score
--      and was never made, so a badge could be issued carrying any number
--      between 0 and 100. The test fixtures had in fact drifted apart by a
--      tenth without anything noticing, which is how this was found.
--
--   2. Afterwards. `adjustAssessment` exists so a reviewer can correct a score,
--      and places no restriction on the assessment's status. Adjusting one that
--      has already been badged moves the console's number and leaves the
--      public one, for ever. The direction that matters is downward: a mark
--      still claiming the higher figure after we decided it was wrong is the
--      product over-claiming on somebody else's website, which is the one
--      thing it exists not to do.
--
-- The second is a refusal rather than a cascade. The badge is a signed
-- attestation of a number at a moment; rewriting it under the signature would
-- make the signature meaningless, and silently reissuing would hide the
-- correction. Revoke, adjust, issue again — which is the process the product
-- already describes, now the only one available.

-- -----------------------------------------------------------------------------
-- 1. A badge carries its assessment's score
-- -----------------------------------------------------------------------------

-- audit-marker: exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='assert_score_is_not_pulled_from_under_a_badge')
--
-- Said rather than guessed. The first pattern that matches is
-- `create or replace function public.assert_badge_is_earned`, which has
-- existed since August — so the audit would have reported this migration
-- as already applied, to somebody about to run eight of them by hand.

create or replace function public.assert_badge_is_earned()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  a record;
  consent record;
begin
  select * into a from public.assessments where id = new.assessment_id;

  if a.id is null then
    raise exception 'Badge references a non-existent assessment' using errcode = 'restrict_violation';
  end if;
  if a.status <> 'approved' then
    raise exception 'Badge cannot issue: assessment % is %, not approved by a human reviewer', a.id, a.status
      using errcode = 'restrict_violation';
  end if;
  if not a.certification_eligible then
    raise exception 'Badge cannot issue: assessment % did not meet the certification gate', a.id
      using errcode = 'restrict_violation';
  end if;
  if a.app_id <> new.app_id or a.organisation_id <> new.organisation_id then
    raise exception 'Badge, app and assessment must belong to the same organisation'
      using errcode = 'restrict_violation';
  end if;
  if new.rubric_version <> a.rubric_version then
    raise exception 'Badge must carry the rubric version the assessment was scored against (%)', a.rubric_version
      using errcode = 'restrict_violation';
  end if;

  -- The number on the mark is the number in the report. Said here rather than
  -- trusted to the one caller that writes badges, because the caller that
  -- writes them today is not the only caller there will ever be, and this is
  -- the figure the whole product is about.
  if a.overall_score is null then
    raise exception 'Badge cannot issue: assessment % has no score', a.id
      using errcode = 'restrict_violation';
  end if;
  if new.score <> a.overall_score then
    raise exception
      'Badge must carry the score its assessment was given (% , not %)', a.overall_score, new.score
      using errcode = 'restrict_violation';
  end if;

  select * into consent from public.consents where id = new.licence_consent_id;
  if consent.id is null
     or consent.document_type <> 'badge_licence'
     or consent.action <> 'accepted'
     or consent.organisation_id is distinct from new.organisation_id then
    raise exception 'Badge cannot issue without an accepted Badge Licence for this organisation'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. A score cannot move out from under a mark that is still standing
-- -----------------------------------------------------------------------------

create or replace function public.assert_score_is_not_pulled_from_under_a_badge()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  standing integer;
begin
  if new.overall_score is not distinct from old.overall_score then
    return new;
  end if;

  -- A revoked badge makes no claim and may be left behind. Everything else
  -- still speaks: suspended is reinstatable, and expired is what a reader of
  -- the verification page is being shown the history of.
  select count(*) into standing
  from public.badges b
  where b.assessment_id = new.id
    and b.status <> 'revoked';

  if standing > 0 then
    raise exception
      'Assessment % carries % badge(s) that still show its score, so changing it here would leave the mark and the report disagreeing. Revoke the badge, adjust, and issue again.',
      new.id, standing
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists assessments_score_is_not_pulled_from_under_a_badge on public.assessments;
create trigger assessments_score_is_not_pulled_from_under_a_badge
  before update of overall_score on public.assessments
  for each row execute function public.assert_score_is_not_pulled_from_under_a_badge();

comment on function public.assert_score_is_not_pulled_from_under_a_badge() is
  'The badge is a signed attestation of a number at a moment. Rewriting the '
  'number under the signature would make the signature meaningless, and '
  'reissuing silently would hide the correction, so this refuses instead and '
  'names the three steps that are the published process anyway.';

-- =============================================================================
-- 20261006210000_a_refusal_is_written_down.sql
-- =============================================================================
-- audit-marker: exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='record_a_refusal_at_intake')
-- A refusal at intake is written down, by the database.
--
-- `apps/web/app/console/apps/actions.ts` carried this, above an insert into
-- `audit_log`:
--
--     // Refusals are logged with their ground, per the Acceptable Use Policy.
--
-- That is a commitment the published policy makes on our behalf. The insert ran
-- as the customer who submitted the application, and the only insert policy on
-- that table is `audit_log_insert_platform_admin`, which requires
-- `is_platform_admin()`. So row-level security refused it, every time, since the
-- day the admin console landed. The action discarded the result and redirected.
-- No refusal at intake has ever been recorded, and nothing anywhere said so.
--
-- The table is right to be closed. A log that the subject of an entry may write
-- into is not evidence, and the three other things a customer might try there
-- are all still refused.
--
-- So the writer moves rather than the policy. The two screening decisions that
-- already work are written by `security definer` functions — the reviewer's in
-- `record_screening_decision`, the sweep's in `record_automated_screening` —
-- and this is the third door into the same state, the deterministic filter that
-- refuses at submission. It refuses by creating the row already refused, which
-- no update trigger would see and which the other two never do, so an `after
-- insert` trigger covers exactly the gap and overlaps neither.
--
-- Being in the database rather than in the action is the usual reason: a second
-- path that creates an application gets this without anybody remembering, and a
-- refusal cannot be recorded without its ground because the column it reads is
-- the one the customer is shown.

-- audit-marker: exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='record_a_refusal_at_intake')
--
-- Said rather than guessed. The first pattern that matches is
-- `create or replace function public.assert_badge_is_earned`, which has
-- existed since August — so the audit would have reported this migration
-- as already applied, to somebody about to run eight of them by hand.

create or replace function public.record_a_refusal_at_intake()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.screening_status <> 'refused' then
    return new;
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, actor_role, action, entity_type, entity_id, summary,
     before_state, after_state)
  values
    (new.organisation_id,
     -- Who submitted it. The decision was ours, which is what `actor_role`
     -- says; the account it was decided about is what makes the entry useful
     -- when somebody asks why an application never appeared.
     new.created_by,
     'deterministic intake filter',
     'app.screening_refused',
     'app',
     new.id,
     new.screening_notes,
     null,
     jsonb_build_object('screening_status', 'refused'));

  return new;
end
$$;

drop trigger if exists apps_refusal_at_intake_is_written_down on public.apps;
create trigger apps_refusal_at_intake_is_written_down
  after insert on public.apps
  for each row execute function public.record_a_refusal_at_intake();

comment on function public.record_a_refusal_at_intake is
  'The third door into a refused screening status, and the one that refuses by '
  'creating the row already refused. The other two are updates and write their '
  'own entries, so this fires on insert only and overlaps neither.';

-- =============================================================================
-- 20261008000000_a_statutory_record_is_not_cascaded_away.sql
-- =============================================================================
-- audit-marker: exists (select 1 from pg_constraint where conname = 'cost_records_organisation_id_fkey' and confdeltype = 'r')
--
-- A seven-year record that a workspace deletion would have taken with it.
--
-- `RETENTION_SCHEDULE` in `@vibefycode/governance` publishes 2555 days for
-- `cost_record`, with the rationale a customer reads on /console/privacy:
-- "Cost records are financial records with a statutory retention period."
--
-- Every other long-lived table is written to survive. `audit_log`,
-- `billing_events` and `retention_deletions` null the organisation and keep the
-- row; `consents`, `authorisations` and `invoices` refuse the delete outright.
-- `cost_records` cascaded — the only one of the seven — so the single path by
-- which a workspace could be removed would have destroyed the financial records
-- the schedule says we must keep, and nothing anywhere would have said so.
--
-- It is latent today: there is no delete policy on `organisations` and nothing
-- in the product deletes one, so this would only fire for an operator running
-- the delete by hand — which is exactly the circumstance in which they would
-- least expect the accounts to go with it.
--
-- `restrict` rather than `set null`, because `organisation_id` is not nullable
-- here. That is the same answer `invoices` already gives, and `invoices` is this
-- table's structural twin: a not-null organisation and a statutory retention.
--
-- The two assessment links are nullable, so they take the other half of the same
-- rule: the cost record outlives what it describes, with the link removed.

alter table public.cost_records
  drop constraint cost_records_organisation_id_fkey,
  add constraint cost_records_organisation_id_fkey
    foreign key (organisation_id) references public.organisations(id) on delete restrict;

alter table public.cost_records
  drop constraint cost_records_assessment_id_fkey,
  add constraint cost_records_assessment_id_fkey
    foreign key (assessment_id) references public.assessments(id) on delete set null;

alter table public.cost_records
  drop constraint cost_records_assessment_run_id_fkey,
  add constraint cost_records_assessment_run_id_fkey
    foreign key (assessment_run_id) references public.assessment_runs(id) on delete set null;



-- =============================================================================
-- 20261008010000_a_grant_nobody_wrote.sql
-- =============================================================================
-- audit-marker: not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'spend_since' and has_function_privilege('anon', p.oid, 'execute'))
--
-- A grant nobody wrote, on the figure a reviewer may not see.
--
-- `cost_records` carries RLS restricting select to platform admins, and
-- `tests/money.test.ts` holds that rule under the heading "is invisible to
-- customers and to reviewers alike". The reason is written down in the costs
-- dashboard: a reviewer who can see what an assessment cost us is a reviewer
-- with a commercial signal in front of them.
--
-- Measured on the test database, as the `anon` role, over PostgREST's own
-- entry point:
--
--     spend_since        = 2.310345
--     free_tier_spend    = 122.310345
--     spending_is_paused = false
--
-- Not a bug in a policy. Postgres grants EXECUTE on a new function to PUBLIC
-- by default, and PostgREST publishes every `public`-schema function as
-- `/rpc/<name>`. A `security definer` function therefore arrives on the
-- internet, reading its tables as the owner, unless a migration takes the
-- grant away. Every other sensitive one here does:
--
--     revoke all on function public.sso_routing(text) from public;
--     revoke all on function public.accept_invitation(text) from public, anon;
--     revoke all on function public.assistant_spend_since(uuid, timestamptz) from public, anon;
--     revoke all on function public.record_screening_decision(...) from public, anon;
--     revoke all on function public.set_platform_role(...) from public, anon;
--
-- Seven did not. `spending_is_paused` is the clearest case of how it
-- happens: `20260822180000_governance_operations` ends with
--
--     grant execute on function public.spending_is_paused() to authenticated;
--
-- and nothing else. A grant written on its own line reads like the whole
-- story — as though naming who may call it also said who may not.
--
-- ## Why six of the seven need no grant back
--
-- The spend trio has exactly one caller, `apps/worker/src/governance.ts`, and
-- it holds a `pg` PoolClient on `SUPABASE_DB_URL` — the owner role, which has
-- EXECUTE by ownership and not by grant. `assistant_spend_since` is the one
-- the customer-facing copilot route calls, and it is already revoked and
-- already granted to `authenticated`, scoped to the caller's own
-- organisation. The platform-wide figure has no customer-facing caller at all.
--
-- `seats_used` and `seats_for_organisation` are called only from inside
-- `assert_seat_available`, `accept_invitation` and `create_workspace`, all
-- three `security definer`; a nested call inside a definer function is checked
-- against the owner, not the caller.
--
-- `platform_role_of` is called only from inside `is_reviewer` and
-- `is_platform_admin`. A nested call inside a `security definer` function is
-- checked against that function's owner, measured: with `platform_role_of`
-- revoked, `anon` still evaluates both wrappers exactly as before.
--
-- Measured rather than argued: with these six revoked, `anon` still reads
-- every public view, `authenticated` still evaluates `is_platform_admin` and
-- `is_reviewer` identically to before, the whole test suite passes, and the
-- owner still gets `spend_since = 2.310345`.
--
-- ## What is deliberately left alone
--
-- `is_org_member`, `has_org_role`, `is_platform_admin`, `is_reviewer` and
-- `shares_org_with` stay callable by `anon`. RLS policy expressions are
-- evaluated as the current role, and these appear in 37, 17, 18, 25 and 1
-- policies respectively — revoking them would break every anon-facing read in
-- the product. What was checked before leaving them: each reads only
-- `memberships` or `users`, each answers only about the caller, and for an
-- unauthenticated caller — `auth.uid()` null — the answer is false or null,
-- both of which exclude the row.
--
-- `sso_routing` stays granted to `anon` on purpose: the sign-in form has to
-- ask where to send an email address before anyone is signed in.
--
-- `app_has_remediation` stays too, and it was in this list until the
-- accessibility scan caught it. `badge_verification` projects it as
-- `owner_has_remediation`, and a view declared `security_invoker = false`
-- shields the privileges on its underlying *tables* — not EXECUTE on a
-- function in its own select list, which is still checked against whoever is
-- asking. So revoking it turned every public verification page into an HTTP
-- 500: `permission denied for function app_has_remediation`.
--
-- The reason that is acceptable to leave granted, rather than a hole to patch
-- another way: the boolean it returns is published content. The brief requires
-- a remediation client to be disclosed on the very page that reads it, and the
-- view hands the same value to every visitor. Calling it directly tells you
-- nothing the page does not, for any application whose id you already have.
--
-- Worth recording how the wrong answer survived three measurements: the first
-- two asked `select count(*) from public.badge_verification`, and Postgres
-- prunes a column nobody projected, so the function was never evaluated. The
-- third asked `select count(*) from (select * from ... limit 50) s`, and the
-- planner prunes through a subquery too. Only `select owner_has_remediation
-- from public.badge_verification limit 1` actually runs the function. A
-- measurement that cannot fail is not a measurement.
--
-- The trigger functions — `assert_seat_available`, `handle_new_auth_user`,
-- `record_a_refusal_at_intake`, `record_badge_event`, `record_listing_event`,
-- `reject_review_by_remediation_worker` — keep their default grant because
-- Postgres refuses a direct call regardless: "trigger functions can only be
-- called as triggers", measured.

revoke all on function public.spend_since(timestamptz) from public, anon, authenticated;
revoke all on function public.free_tier_spend_since(timestamptz) from public, anon, authenticated;
revoke all on function public.spending_is_paused() from public, anon, authenticated;
revoke all on function public.seats_used(uuid) from public, anon, authenticated;
revoke all on function public.seats_for_organisation(uuid) from public, anon, authenticated;
revoke all on function public.platform_role_of(uuid) from public, anon, authenticated;

-- =============================================================================
-- 20261008020000_a_customer_may_not_write_their_own_score.sql
-- =============================================================================
-- audit-marker: not exists (select 1 from pg_policy where polrelid = 'public.assessments'::regclass and polname = 'assessments_insert_members')
--
-- A customer could write their own score.
--
-- Measured on the test database, as `authenticated` with a real member's
-- access token and nothing else — no web page involved, just PostgREST:
--
--     insert into public.assessments
--       (app_id, organisation_id, authorisation_id, status, rubric_version,
--        depth, scope_statement, overall_score, dimension_scores,
--        certification_eligible, completed_at)
--     values (… their own app …, 'awaiting_review', '1.1.0', 'full',
--             'This is the scope statement a customer wrote for themselves. …',
--             100, '[{"dimension":"security_privacy","score":100, …}]', true, now());
--
--     SELF-SCORED: dbf93072-… status=awaiting_review score=100.00 cert=true
--
-- And on a real, engine-written assessment of theirs sitting in the queue at
-- 39.00:
--
--     update public.assessments set overall_score = 99, gate_failures = '{}',
--            dimension_scores = '[… 99 …]' where id = '63f6da7d-…';
--
--     AFTER: score=99.00 status=awaiting_review
--
-- `awaiting_review` is exactly the status `/review` lists, so either row goes
-- in front of a reviewer, and the approve action checks nothing about the
-- score, the findings or the stage records. PART 11 of the brief forbids any
-- path by which a payment, plan, discount or marketing purchase can influence
-- a score. This is the customer writing the score directly, which is the same
-- rule and a shorter path.
--
-- ## Why the policies said yes
--
-- `20260822092000_assessments` grants `select, insert, update` on
-- `public.assessments` to `authenticated` and carries:
--
--     assessments_insert_members  insert  with check (is_org_member(organisation_id))
--     assessments_update_members  update  using  (status not in ('approved','rejected')
--                                                  and is_org_member(organisation_id)
--                                                or is_reviewer())
--
-- Both read as "a workspace owns its own assessments", which is true of
-- reading them. Neither names a column, so both also permit the three columns
-- the engine alone is entitled to write: `overall_score`, `dimension_scores`
-- and `gate_failures`, plus the status that moves a row into the queue.
--
-- ## Why removing them breaks nothing
--
-- Measured across the repository: `apps/worker/src/persist.ts` holds the only
-- `insert into public.assessments`, and it runs on the worker's own connection
-- as the owner, which RLS does not apply to. Every other reference —
-- `review/actions.ts`, `review/[id]`, `review/page`, `console/billing`,
-- `console/apps/[id]`, `console/privacy/actions.ts`, the mobile report screen —
-- is a select, except the three review actions, which are reviewer-only and
-- keep their half of the update policy.
--
-- A customer asks for an assessment by inserting into
-- `public.assessment_requests`, which has its own policies and no score
-- column. That is the whole customer-facing write path, and it is untouched.
--
-- ## Why the grant goes too, not just the policy
--
-- A table-level grant with no permissive policy already refuses the
-- statement, so the revoke is redundant today. It is here because the next
-- person to add a policy to this table will write it against the grants they
-- find: `grant insert` left standing is an invitation to re-permit this by
-- accident, and the thing being guarded is the one rule the product cannot be
-- wrong about.
--
-- The findings behind a score were never writable — `public.findings` carries
-- a select policy and nothing else — so a self-scored row arrives in the queue
-- with whatever findings the engine filed, or none at all.

drop policy assessments_insert_members on public.assessments;
revoke insert on public.assessments from authenticated;

-- The reviewer half of the old policy, with the member half removed. Named for
-- who it is for, so the next reader does not have to work out that "members"
-- stopped including members.
drop policy assessments_update_members on public.assessments;

create policy assessments_update_reviewers on public.assessments
  for update to authenticated
  using (public.is_reviewer())
  with check (public.is_reviewer());

comment on table public.assessments is
  'One assessment of one application. Written by the engine on the owner''s '
  'connection; customers read their own and reviewers update status. No role '
  'reachable through PostgREST may write a score.';

-- =============================================================================
-- 20261008030000_the_acceptable_use_verdict_is_ours.sql
-- =============================================================================
-- audit-marker: not has_column_privilege('authenticated', 'public.apps', 'screening_status', 'UPDATE')
--
-- A workspace owner could clear their own application under the Acceptable
-- Use Policy.
--
-- Measured on the test database, as `authenticated` with a real workspace
-- owner's access token, against an application a reviewer had marked
-- `refused`:
--
--     update public.apps
--        set screening_status = 'cleared', screened_at = now(),
--            screening_notes = 'Looks fine to me.'
--      where id = 'c3384c82-…';
--
--     AFTER: screening=cleared notes=Looks fine to me.
--     UPDATE 1
--
-- `screening_status` is the Acceptable Use gate. `apps/worker/src/
-- run-assessment.ts` refuses to run against `refused` and refuses to run
-- against `pending` — "no assessment runs before that" — so clearing it is
-- how a refused application gets assessed, scored and badged.
--
-- `apps_update_admins` permits it: `has_org_role(organisation_id,
-- ['owner','admin'])`, which is right for the name, the URL and the intake
-- answers, and names no column, so it also covers the three the decision is
-- recorded in. The insert policy is the same shape, so a first submission
-- could arrive already `cleared` and never pass the filter at all.
--
-- ## The monitoring columns go with them
--
-- `last_seen_at`, `last_liveness_status`, `consecutive_liveness_failures` and
-- `last_reassessed_at` are written by `apps/worker/src/monitoring.ts` on the
-- owner's connection and are read-only in every console and mobile screen.
-- The counter is what suspends a badge for an application that has stopped
-- answering; its subject being able to set it back to zero is the same defect
-- with a slower consequence.
--
-- ## Why a column grant and not a policy
--
-- Postgres has no per-column RLS. It does have per-column INSERT and UPDATE
-- privileges, and they are checked before any policy: a statement naming a
-- column the role has no privilege on is refused outright, and a statement
-- that omits it gets the column's default. `screening_status` defaults to
-- `'pending'`, which is the state the queue at /review/screening lists, so a
-- submission that no longer carries a verdict lands exactly where an
-- unscreened submission should.
--
-- It has to be written as a revoke of the whole privilege and a grant of the
-- columns, not as a revoke of the columns. A column-level revoke cannot
-- subtract from a table-level grant: Postgres answers "no privileges could be
-- revoked for column ..." as a warning and changes nothing. The first version
-- of this migration did exactly that, applied without error, and left every
-- column writable — the test that caught it is the one that reads
-- `information_schema.column_privileges` rather than trying a statement.
--
-- So the list below is the owner's own fields, enumerated. A column added to
-- this table later is not writable through PostgREST until a migration says
-- so, which is the right default for a table where the dangerous columns are
-- the ones we author — and is the cost of it: somebody adding an intake
-- question has to add it here too, and the console will tell them plainly,
-- with `permission denied for column`.
--
-- `organisation_id` is deliberately absent from the update list. Nothing in
-- the product moves an application between workspaces, and if that ever
-- becomes a feature it needs its own thought: the badge, the authorisation and
-- the invoices all hang off the organisation this column names.
--
-- ## Where the verdict is written instead
--
-- `record_intake_screening` below, on the owner's connection through
-- `writeAsService`, which is the same door `record_automated_screening` (the
-- worker's sweep) and `record_screening_decision` (the reviewer) already use.
-- The pattern was already here; intake was the one step still writing the
-- column as the customer.
--
-- Only ever moves an application out of `pending`, like the sweep: a verdict a
-- reviewer has already recorded is not something an intake screen may undo.

revoke insert, update on public.apps from authenticated;

grant insert (organisation_id, name, slug, app_type, primary_url, repository_url,
              mobile_build_reference, category, description, builder, target_audience,
              processes_personal_data, has_authentication, has_payments,
              intended_for_app_store, directory_opt_in, is_game, monitoring_enabled,
              policy_profile_id, created_by)
  on public.apps to authenticated;

grant update (name, slug, primary_url, repository_url, mobile_build_reference,
              category, description, builder, target_audience,
              processes_personal_data, has_authentication, has_payments,
              intended_for_app_store, directory_opt_in, is_game, monitoring_enabled,
              policy_profile_id, archived_at)
  on public.apps to authenticated;

-- -----------------------------------------------------------------------------
-- The intake screen's own door
-- -----------------------------------------------------------------------------
--
-- Takes a verdict, unlike `record_automated_screening`, because the
-- deterministic filter in `screenIntake` may refuse outright — it matches
-- phrases specific enough that their presence is the finding, which is a rule
-- rather than a judgement. That is why this one is granted to nobody: the
-- caller is our own server, never the customer, and a function that accepts
-- `'cleared'` from whoever calls it must not be reachable by the account it
-- would be clearing.
--
-- `pending` is a real verdict here and not a no-op: the screen read the
-- submission, could not settle it, and the sentence it got to is what the
-- reviewer at /review/screening reads. So the note is written either way.
create or replace function public.record_intake_screening(
  target_app uuid,
  verdict public.screening_status,
  note text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_org uuid;
  submitted_by uuid;
begin
  if length(btrim(coalesce(note, ''))) < 10 then
    raise exception 'An intake screening must say what it read, in a sentence';
  end if;

  select organisation_id, created_by into target_org, submitted_by
    from public.apps
   where id = target_app and screening_status = 'pending';

  -- Not an error, for the same reason the sweep's is not: between the insert
  -- and this call a reviewer may have decided, and theirs stands.
  if target_org is null then
    return false;
  end if;

  update public.apps
     set screening_status = verdict,
         screening_notes = note,
         screened_at = now()
   where id = target_app and screening_status = 'pending';

  -- A submission left pending is not a decision, so there is nothing to record
  -- beyond the note the reviewer is about to read.
  if verdict = 'pending' then
    return true;
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, actor_role, action, entity_type, entity_id, summary,
     before_state, after_state)
  values
    (target_org,
     -- Who submitted it. The decision was ours, which is what `actor_role`
     -- says; the account it was decided about is what makes the entry useful
     -- when somebody asks why an application never appeared.
     submitted_by,
     'intake screen',
     case verdict when 'refused' then 'app.screening_refused' else 'app.screening_cleared' end,
     'app', target_app, note,
     jsonb_build_object('screening_status', 'pending'),
     jsonb_build_object('screening_status', verdict));

  return true;
end
$$;

revoke all on function public.record_intake_screening(uuid, public.screening_status, text)
  from public, anon, authenticated;

comment on function public.record_intake_screening is
  'What the intake screen read, written by our server and never by the account '
  'it is about. Clears, refuses or leaves pending, and only from pending.';

-- =============================================================================
-- 20261008040000_a_verified_authorisation_is_ours_to_record.sql
-- =============================================================================
-- audit-marker: exists (select 1 from pg_trigger where tgname = 'authorisations_are_verified_by_us' and tgrelid = 'public.authorisations'::regclass)
--
-- A customer could write their own verified authorisation, for a domain they
-- do not own.
--
-- PART 11: "Do not run any assessment step against a target that lacks a
-- verified authorisation record." `apps/worker/src/run-assessment.ts` calls it
-- the hard gate, and the gate is one function:
--
--     select public.app_is_authorised_for_testing(a.id) as authorised
--
-- Measured on the test database, as `authenticated` with a real workspace
-- owner's access token and nothing else:
--
--     insert into public.authorisations
--       (organisation_id, app_id, granted_by, method, status, verified_at,
--        verification_target, scope_domains, …)
--     values (…, 'dns_txt', 'verified', now(),
--             'competitor.example', array['competitor.example'], …);
--
--     SELF_VERIFIED_AUTH: status=verified verified_at_set=true target=competitor.example
--     app_is_authorised_for_testing: true
--
-- An application's `primary_url` is the customer's to set, so the target can
-- be anybody's. The DNS-TXT proof in `verifyOwnership` is real and it was
-- simply not on the path: `verifyAuthorisation` runs the check and then writes
-- the result through the customer's own client, so the check was a step in a
-- server action rather than a property of the row.
--
-- That is the shape of the two before it — a customer writing their own score,
-- a customer clearing their own Acceptable Use verdict — and this is the one
-- where the person harmed is not the customer. It is whoever owns the domain
-- we would have scanned.
--
-- ## The second half: scope that was never proved
--
-- Measured as well: nothing tied `scope_domains` to `verification_target`.
-- `permittedScopeFor` enforces it — a requested host is allowed when it is the
-- verified host, a subdomain of it, or its apex where the verified host is
-- `www.` — and it is enforced at step one, in the action. Step two carries the
-- pending row's scope forward unchanged. So even with the status locked, a
-- pending row written straight through PostgREST could name a target the
-- customer does own and a scope they do not, press Verify in the browser, and
-- have the forged scope carried into a properly verified row.
--
-- Both halves are now properties of the table.

-- -----------------------------------------------------------------------------
-- You may ask, and you may withdraw. Only we may say it was proved.
-- -----------------------------------------------------------------------------
--
-- Deliberately not `security definer`: this needs `current_user` to be the role
-- that actually sent the statement. `authenticated` for anything through
-- PostgREST or a server action on the caller's identity, the table's owner for
-- the worker and for `writeAsService`. A definer function would see its own
-- owner every time and permit everything.
--
-- `pending` and `revoked` are the customer's own acts: asking to be assessed,
-- and withdrawing. `verified` and `expired` are findings about the world, and
-- `revokeAuthorisation` already writes a withdrawal as a new row rather than an
-- edit, so nothing legitimate needs more than this.
create or replace function public.an_authorisation_is_verified_by_us()
returns trigger
language plpgsql
as $$
begin
  if pg_has_role(
       current_user,
       (select relowner from pg_class where oid = 'public.authorisations'::regclass),
       'member') then
    return new;
  end if;

  if new.status not in ('pending', 'revoked') then
    raise exception
      'An authorisation is recorded as % by VibefyCode after the ownership check, not by the account it is about',
      new.status;
  end if;

  if new.verified_at is not null then
    raise exception 'When an authorisation was verified is ours to record, not yours to declare';
  end if;

  return new;
end
$$;

drop trigger if exists authorisations_are_verified_by_us on public.authorisations;
create trigger authorisations_are_verified_by_us
  before insert or update on public.authorisations
  for each row execute function public.an_authorisation_is_verified_by_us();

comment on function public.an_authorisation_is_verified_by_us is
  'The hard gate, held where the row is written. A customer may ask and may '
  'withdraw; whether ownership was proved is ours to record.';

-- -----------------------------------------------------------------------------
-- A verified scope lies under the host that was proved
-- -----------------------------------------------------------------------------
--
-- The SQL half of `permittedScopeFor`, in the same three cases: the host
-- itself, a subdomain of it, or its apex where what was proved is a `www.`
-- host. `right(d, length(target) + 1) = '.' || target` rather than `like`,
-- because an underscore is legal in a hostname and `like` would read it as a
-- wildcard.
--
-- `not valid` and then validated, on purpose. If a database somewhere already
-- holds a verified authorisation whose scope was never proved, the constraint
-- is in place for every new row before the validation runs, and the validation
-- then names the row rather than silently leaving the rule off. Should that
-- happen, this finds them:
--
--     select id, verification_target, scope_domains from public.authorisations
--      where status = 'verified'
--        and not public.scope_is_within_verified_target(verification_target, scope_domains);
--
-- and each one is a row worth reading, because it authorised more than it
-- proved.

-- A CHECK constraint may not contain a subquery, and mapping over an array
-- needs `unnest`, so the predicate is an immutable function and the constraint
-- calls it. It is the same three cases, and being a function it can also be
-- read on its own: `select public.scope_is_within_verified_target('mine.example',
-- array['api.mine.example'])`.
create or replace function public.scope_is_within_verified_target(
  verified_host text,
  domains text[]
)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  -- The null check is inside `bool_and`, not in front of it, so that a row with
  -- nothing to check passes rather than failing on a missing host. An empty
  -- scope on a verified row is already `authorisations_verified_needs_scope`'s
  -- rule and its message says so in those words; two constraints refusing the
  -- same row in an order Postgres does not promise is how a clear error becomes
  -- a coin toss.
  select coalesce(
           bool_and(
             verified_host is not null
             and (
               d = lower(verified_host)
               or right(d, length(verified_host) + 1) = '.' || lower(verified_host)
               or (lower(verified_host) like 'www.%'
                   and d = substring(lower(verified_host) from 5))
             )
           ),
           true)
    from unnest(coalesce(domains, '{}'::text[])) as d;
$$;

comment on function public.scope_is_within_verified_target is
  'Whether every domain is the verified host, a subdomain of it, or its apex where the host is a www one. The SQL half of permittedScopeFor.';

alter table public.authorisations
  add constraint authorisations_scope_within_verified_target
  check (
    status <> 'verified'
    or public.scope_is_within_verified_target(verification_target, scope_domains)
  ) not valid;

alter table public.authorisations
  validate constraint authorisations_scope_within_verified_target;

comment on constraint authorisations_scope_within_verified_target on public.authorisations is
  'A verified authorisation covers the host it proved, its subdomains, and its apex. Nothing else.';

-- =============================================================================
-- 20261008050000_a_verified_domain_is_ours_to_record.sql
-- =============================================================================
-- audit-marker: exists (select 1 from pg_trigger where tgname = 'sso_domains_are_verified_by_us' and tgrelid = 'public.sso_connections'::regclass)
--
-- A workspace owner could claim any email domain and mark it verified, which
-- locks every address at that domain out of sign-in.
--
-- Measured on the test database, as `authenticated` with a real workspace
-- owner's access token:
--
--     insert into public.sso_connections
--       (organisation_id, provider, email_domain, enforced,
--        domain_challenge, domain_verified_at, created_by, default_role)
--     values (…, 'oidc', 'gmail.com', true, 'x', now(), …, 'member');
--
--     SELF_VERIFIED_SSO: domain=gmail.com enforced=true
--
--     select provider from public.sso_routing('victim@gmail.com');  -- oidc
--
-- `auth-form.tsx` asks `sso_routing` before it accepts a password, for a good
-- reason written down beside it: "a workspace that has enforced SSO has done
-- so precisely so that a password cannot be an alternative route in." So a
-- `required` answer refuses the password and calls `signInWithSSO`. Registering
-- the identity provider itself is still a manual step on our side, so the
-- redirect would fail today — which makes the effect of the row above simply
-- that nobody with a Gmail address can sign in to VibefyCode at all, by the
-- act of one customer, with no step required of us.
--
-- ## What was already right
--
-- `sso_enforced_needs_verified_domain` already holds that `enforced` requires
-- `domain_verified_at`, and `sso_routing` already reads only enforced,
-- domain-verified rows. The constraint is the reason this needs one trigger
-- rather than a column list: with the timestamp ours to write, `enforced` can
-- stay the owner's to set, because the constraint will not let them set it
-- before we have verified the domain.
--
-- `verifySsoDomain` does check the DNS TXT record, with `verifyDnsTxt`, and
-- the challenge is generated when the domain is claimed. The check was real
-- and simply not on the path: the action ran it and then wrote the result
-- through the customer's own client, so it was a step in a server action
-- rather than a property of the row. The same sentence as
-- `20261008040000`, one table over.

-- Deliberately not `security definer`: this needs `current_user` to be the
-- role that actually sent the statement. `authenticated` for anything through
-- PostgREST or a server action on the caller's identity, the table's owner for
-- `writeAsService`. A definer function would see its own owner every time and
-- permit everything.
create or replace function public.an_sso_domain_is_verified_by_us()
returns trigger
language plpgsql
as $$
begin
  if pg_has_role(
       current_user,
       (select relowner from pg_class where oid = 'public.sso_connections'::regclass),
       'member') then
    return new;
  end if;

  if new.domain_verified_at is not null
     and (tg_op = 'INSERT' or old.domain_verified_at is distinct from new.domain_verified_at) then
    raise exception
      'Whether a domain is yours is ours to verify. Claim it, publish the DNS record, and press verify';
  end if;

  return new;
end
$$;

drop trigger if exists sso_domains_are_verified_by_us on public.sso_connections;
create trigger sso_domains_are_verified_by_us
  before insert or update on public.sso_connections
  for each row execute function public.an_sso_domain_is_verified_by_us();

comment on function public.an_sso_domain_is_verified_by_us is
  'A workspace may claim a domain and may enforce one we have verified. Whether '
  'the DNS record was there is ours to record.';

-- =============================================================================
-- 20261008060000_only_an_owner_grants_ownership.sql
-- =============================================================================
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

-- =============================================================================
-- 20261008070000_our_side_of_a_record_is_ours.sql
-- =============================================================================
-- audit-marker: not has_column_privilege('authenticated', 'public.appeals', 'resolution', 'INSERT')
--
-- Four more records whose own subject could write our half of them.
--
-- The same sweep that found the score, the Acceptable Use verdict, the
-- ownership proof and the verified email domain, run over every remaining
-- table a request-facing role may write. None of these four is an exploit the
-- way those were; each is a record that exists to show what *we* did, and each
-- could be written by the party it is about. A record its subject can write is
-- not evidence of anything, which is the whole reason the tables exist.
--
-- Measured first, in each case, that nothing in the product writes the column:
-- the four insert paths are `requestAppeal`, `requestMyData`, the audit-export
-- route and `create_workspace`, and what each one actually sends is listed
-- below beside what it is now allowed to send.
--
-- Postgres has no per-column RLS, so these are per-column INSERT and UPDATE
-- privileges, checked before any policy. As in `20261008030000`, the rule has
-- to be written as a revoke of the whole privilege and a grant of the
-- permitted columns: a column-level revoke cannot subtract from a table-level
-- grant, and Postgres says so in a warning rather than an error.

-- -----------------------------------------------------------------------------
-- appeals: the customer writes the grounds, we write the answer
-- -----------------------------------------------------------------------------
--
-- `appeals_insert_members` names no column, so an appeal could arrive with
-- `status = 'upheld'`, a `resolution` the appellant wrote, `resolved_by`
-- pointing at a reviewer who never saw it, and a `due_at` of their choosing.
-- `/review/appeals` lists what is open, so a self-resolved appeal is also an
-- appeal no reviewer is ever shown.
--
-- `requestAppeal` sends `assessment_id`, `organisation_id`, `finding_id`,
-- `submitted_by` and `grounds`, and nothing else. `status` defaults to `'open'`
-- and `due_at` to fourteen days, which is the published turnaround. Resolving
-- one is an update, and `appeals_update_reviewers` already requires
-- `is_reviewer()`.
revoke insert on public.appeals from authenticated;

grant insert (assessment_id, organisation_id, finding_id, submitted_by, grounds)
  on public.appeals to authenticated;

-- -----------------------------------------------------------------------------
-- data_requests: the statutory clock is not the subject's to set
-- -----------------------------------------------------------------------------
--
-- `data_requests_insert_own` names no column either, so a request could arrive
-- `completed`, with a `response` and a `handled_by` and a `refusal_basis`, or
-- with `due_at` set years out. The response deadline is the thing the whole
-- table exists to evidence — `apps/worker/src/governance.ts` sweeps for
-- overdue ones — and a record that says we answered when we did not is worse
-- than no record.
--
-- `requestMyData` sends `user_id`, `organisation_id`, `request_type` and
-- `details`. `status` defaults to `'received'` and `due_at` to thirty days.
-- Answering one is an update, and `data_requests_update_admin` already
-- requires `is_platform_admin()`.
revoke insert on public.data_requests from authenticated;

grant insert (user_id, organisation_id, request_type, details)
  on public.data_requests to authenticated;

-- -----------------------------------------------------------------------------
-- audit_exports: a hash the holder wrote is not a hash
-- -----------------------------------------------------------------------------
--
-- `packages/workspace/src/audit-export.ts` says why the row is kept: the table
-- is append-only "so that a file produced in a dispute can be" checked against
-- it. `row_count` and `sha256` are what makes that possible, and
-- `recordAuditExport` ran on `writeAsUser` — the caller's own identity — so
-- the figure and the digest were written by the party who would be producing
-- the file.
--
-- Nothing else writes this table, so the privilege goes rather than a column
-- list, and the route records on our own connection instead. The policy goes
-- with it: a policy permitting an insert nobody may perform is a line that
-- reads like a control and is not one.
drop policy audit_exports_insert_admins on public.audit_exports;
revoke insert on public.audit_exports from authenticated;

-- -----------------------------------------------------------------------------
-- organisations: a marketing relationship we have to disclose
-- -----------------------------------------------------------------------------
--
-- `is_marketing_client` is a disclosure. `MARKETING_CLIENT_DISCLOSURE` is
-- rendered on the public verification page, because a company that pays us for
-- marketing and also holds a badge from us is a conflict a reader is entitled
-- to know about. Measured as a workspace owner:
--
--     update public.organisations set is_marketing_client = true,
--            marketing_client_since = now() where id = '…';
--     MARKETING_CLIENT: true
--     UPDATE 1
--
-- Which means the same statement with `false` would have removed the
-- disclosure from their own badge page.
--
-- `is_personal` and `account_type` are beside it and decide how seats and
-- plans are counted; `deleted_at` is a lifecycle flag nothing in the product
-- sets.
--
-- Measured across the repository: nothing in `apps/` updates or inserts this
-- table at all. Creation goes through `create_workspace`, a `security definer`
-- function owned by `postgres`, which holds `bypassrls` and so is unaffected
-- by any of this. So both policies have no caller, and a rename or a settings
-- page — which does not exist yet — will need a policy written for exactly
-- what it changes. That is the right way round: the columns here are either
-- identity or commercial status, and neither should be edited by accident.
drop policy organisations_insert_own on public.organisations;
drop policy organisations_update_admins on public.organisations;
revoke insert, update on public.organisations from authenticated;

-- =============================================================================
-- 20261008080000_the_plan_is_not_the_customers_to_declare.sql
-- =============================================================================
-- audit-marker: not exists (select 1 from pg_policy where polrelid = 'public.assessment_requests'::regclass and polname = 'assessment_requests_insert_members')
--
-- A customer could declare their own plan, depth and spending ceiling.
--
-- (The marker above names the policy rather than the privilege on purpose. A
-- marker mentioning the privilege has to spell the word, and
-- `migration-audit.test.ts` holds that the generated audit query contains no
-- write verb — which is the right rule and caught exactly this once already,
-- in decision 898.)
--
-- Measured on the test database, as `authenticated` with a real member's
-- access token:
--
--     insert into public.assessment_requests
--       (app_id, organisation_id, requested_by, depth, plan_at_request,
--        max_run_cost_usd, uses_retest_credit, status)
--     values (…, 'continuous', 'certified', 999.00, false, 'queued');
--
--     SELF_PLANNED_REQUEST: plan=certified ceiling=999.0000 depth=continuous
--
-- `decideAssessmentRequest` is the function that decides all four, and it is
-- the one place where the free tier's cooldown, the re-test credit and the
-- per-plan depth live. `requestAssessment` calls it and then writes the answer
-- through the customer's own client, so the decision was a step in a server
-- action rather than a property of the row — the sixth table tonight with that
-- same sentence true of it.
--
-- ## What it costs
--
-- `COST_CEILING_BY_DEPTH` is `limited: 0.50`, `continuous: 2.00`, `full: 4.00`,
-- and `run-assessment.ts` reads it by depth. So a free-tier customer naming
-- `full` gets eight times the model spend their tier pays for, with
-- `uses_retest_credit = false` so no credit is consumed and the cooldown — which
-- `decideAssessmentRequest` enforces and nothing else does — simply not
-- applied. `assessment_requests_one_live_per_app` keeps it to one at a time,
-- which bounds the rate and not the entitlement.
--
-- PART 11: no payment, plan, discount or marketing purchase may influence a
-- score. This is the same rule read the other way round — the plan deciding
-- what runs is ours to determine, because it is the one that says what a
-- customer is owed.
--
-- ## Why the privilege and not a column list
--
-- Every column on the row except `app_id` is ours: `depth`, `plan_at_request`,
-- `max_run_cost_usd` and `uses_retest_credit` come from the verdict, `status`
-- is the queue's own state, and `attempts`, `claimed_at`, `completed_at`,
-- `assessment_id`, `last_error`, `refusal_code` and `refusal_message` are
-- written by the worker as it goes. A grant naming the one column they do
-- choose would be a grant of nothing, so the privilege goes and
-- `requestAssessment` writes on our connection — both rows it writes, the
-- queued one and the refusal, which is recorded "not just returned: a customer
-- who asks why in six months deserves the same answer they were given today".
--
-- `assessment_requests_cancel_members` and the UPDATE privilege stay. Changing
-- your mind is the customer's own act, and that policy already permits exactly
-- one transition and no other: `status = 'cancelled'`.
--
-- The monitoring sweep in `apps/worker/src/monitoring.ts` also inserts here,
-- on the worker's own connection as the owner, and is unaffected.

drop policy assessment_requests_insert_members on public.assessment_requests;
revoke insert on public.assessment_requests from authenticated;


-- =============================================================================
-- 20261009210000_badge_expired_alert.sql
-- =============================================================================
-- audit-marker: exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'alert_kind' and e.enumlabel = 'badge_expired')
-- =============================================================================
-- "Your badge expired, and nothing told you."
--
-- `sweepBadgeLifecycle` does two things fifteen lines apart. It suspends a badge
-- whose subscription lapsed, and it expires a badge that reached its date. The
-- suspension branch carries this comment, about the defect it was written to
-- close:
--
--     The same event from a liveness failure raises `badge_suspended`; this one
--     raised nothing. A customer's mark came down on their own website — which
--     the licence obliges them to then remove — and the only way to find out was
--     to open the console and look.
--
-- Every word of that applies to the branch above it, which still raises nothing.
--
-- Measured on 2026-10-09 against the test database. A badge twenty-five days
-- from expiry raises one `badge_expiring` alert at severity `info`, and neither
-- delivery channel carries `info` — both filter to warning and critical — so it
-- reaches only somebody who happens to log in. At three days a second one is
-- raised at `warning`, and that one is delivered. Then the badge expires: the
-- status changes, and the alert count goes from two to two.
--
-- So one delivered notice, inside the last week, and silence at the moment the
-- Badge Licence creates the obligation to take the mark down.
--
-- Its own kind, not `badge_suspended` reused. A suspension is something we did
-- because the facts changed; an expiry is a date arriving, and it has a
-- different remedy — a re-assessment renews it. Telling somebody their badge
-- was suspended when it expired would be a notice that says the wrong thing,
-- which the migration that added `monitoring_blocked` already settled is worse
-- than no notice at all.
-- =============================================================================

do $$
begin
  if not exists (
    select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'alert_kind'
       and e.enumlabel = 'badge_expired'
  ) then
    alter type public.alert_kind add value 'badge_expired';
  end if;
end
$$;
