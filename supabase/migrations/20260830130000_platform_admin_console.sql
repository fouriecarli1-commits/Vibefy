-- =============================================================================
-- 0016 — The administrator's own screens
--
-- Written after a day in which the founder was asked to run seven hand-written
-- statements in the Supabase SQL editor to do things the product should have
-- offered: promote a reviewer, put a workspace on a plan, and find out which
-- account owns which application. Two of those statements hit the wrong
-- organisation, because nobody could see the answer without writing a join for
-- it.
--
-- A product whose operator has to be a database administrator has not shipped
-- its admin surface; it has outsourced it. This is the half that lives in the
-- database, and it is deliberately small: the first draft added five read
-- policies before the tests showed that four of them already existed.
-- `is_reviewer()` returns true for administrators too, so organisations,
-- memberships, users and applications have been readable by this role since M1.
--
-- What is actually new:
--   1. The founding administrator, promoted once.
--   2. Reading subscriptions — the one account fact reviewers must not see.
--   3. Setting a plan, and setting a platform role, each through one door.
--   4. Both of those written to the audit log.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The founding administrator
-- -----------------------------------------------------------------------------
--
-- Every later administrator is promoted from the screen by an existing one. The
-- first cannot be, so it happens here, once, in the open — which is better than
-- a hand-typed update nobody can audit afterwards.
--
-- If the account does not exist yet this is a no-op and says so. It does not
-- install a trigger that would promote whoever later claims that address: an
-- email-shaped back door into platform administration is a worse problem than
-- an operator having to run one statement on a fresh database.
do $$
declare
  promoted integer;
begin
  update public.users set platform_role = 'admin' where email = 'anrefourie@gmail.com';
  get diagnostics promoted = row_count;
  if promoted = 0 then
    raise notice 'No account exists for the founding administrator yet. Sign up first, then promote from the admin screen or re-run this update.';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Reading plans
-- -----------------------------------------------------------------------------
--
-- The one account fact a reviewer may not have. A reviewer who can see that
-- this customer is on the most expensive plan has a commercial signal sitting
-- beside a scoring decision, which is the single thing the independence policy
-- exists to prevent. So this is gated on `is_platform_admin()` and not on
-- `is_reviewer()` — the same distinction `cost_records` has drawn since M1.
create policy subscriptions_select_platform_admin on public.subscriptions
  for select to authenticated
  using (public.is_platform_admin());

-- -----------------------------------------------------------------------------
-- 3. Setting a plan
-- -----------------------------------------------------------------------------
--
-- Until Stripe writes these rows from its webhook, this is how a plan is set,
-- and the row written here is the same shape the webhook will write — so
-- nothing has to be undone when billing arrives.
--
-- Customers still cannot touch it. `subscriptions_select_members` lets them
-- read their own plan and there is no member write policy, so a workspace
-- cannot promote itself. That matters: the plan decides assessment depth, what
-- one run may cost, and whether a badge can be held at all.
create policy subscriptions_write_platform_admin on public.subscriptions
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

grant insert, update on public.subscriptions to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Setting a platform role
-- -----------------------------------------------------------------------------
--
-- Through a function rather than a policy, and that is the whole point.
--
-- `public.users` grants `update (full_name)` and `update (alert_email_level)`
-- to authenticated and nothing else. `platform_role` has never been writable
-- from a session at all, which is a second defence standing behind row-level
-- security: even a policy written wrongly one day cannot let somebody promote
-- themselves, because the privilege to write that column does not exist.
--
-- Granting the column to make an admin screen work would spend that defence to
-- buy a form. A security-definer function keeps it: the privilege stays with
-- the function's owner, the check is inside, and there is exactly one door.
create or replace function public.set_platform_role(
  target_user uuid,
  new_role public.platform_role
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  previous public.platform_role;
  remaining integer;
begin
  if not public.is_platform_admin() then
    raise exception 'Only a VibefyCode administrator can change a platform role'
      using errcode = 'insufficient_privilege';
  end if;

  select platform_role into previous from public.users where id = target_user;
  if previous is null then
    raise exception 'No such account' using errcode = 'no_data_found';
  end if;

  -- The last administrator may not step down. An empty administrator set can
  -- only be repaired with the database credentials, which is precisely the
  -- situation these screens exist to end. In the database rather than in the
  -- form, because a guard that lives in one caller is a guard the next caller
  -- does not have.
  if previous = 'admin' and new_role <> 'admin' then
    select count(*) into remaining from public.users where platform_role = 'admin';
    if remaining <= 1 then
      raise exception 'This is the only administrator. Promote someone else first'
        using errcode = 'restrict_violation';
    end if;
  end if;

  update public.users set platform_role = new_role where id = target_user;
end;
$$;

revoke all on function public.set_platform_role(uuid, public.platform_role) from public, anon;
grant execute on function public.set_platform_role(uuid, public.platform_role) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Every one of those changes is written down
-- -----------------------------------------------------------------------------
--
-- Only administrators may write here, and only as themselves: `actor_id` is
-- pinned to the caller, so an entry cannot be filed under someone else's name.
-- `audit_log_no_update` already refuses edits and deletions, so the record an
-- administrator leaves is one they cannot afterwards tidy.
--
-- Changing a customer's plan changes what the engine will spend on them and
-- whether they can hold a badge. That is not a setting; it is an act, and acts
-- by the operator belong in the same log as acts by the customer.
create policy audit_log_insert_platform_admin on public.audit_log
  for insert to authenticated
  with check (public.is_platform_admin() and actor_id = auth.uid());

grant insert on public.audit_log to authenticated;
