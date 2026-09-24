-- Ses migrasies, in hierdie volgorde.
-- Gegenereer 2026-09-24.
--
-- Onseker wat jou databasis het? node tools/migration-audit.mjs > audit.sql, en plak
-- daardie navraag in die SQL-venster. Dit lees net; dit skryf en sluit niks.

-- =============================================================================
-- 20260923110000_second_step_at_the_action.sql
-- =============================================================================
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
-- audit-marker: exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='billing_events_only_handled_changes' and pg_get_functiondef(p.oid) like '%new.received_at is distinct from old.received_at%')
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
