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
