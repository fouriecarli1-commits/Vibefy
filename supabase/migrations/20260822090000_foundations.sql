-- =============================================================================
-- 0001 — Foundations: extensions, enumerated types, and the helper functions
--        every row-level-security policy in this schema is built from.
--
-- House rule: a table is never created without its RLS policies in the same
-- migration. A table shipped without a policy is a data leak waiting for a
-- deadline, so the two are physically inseparable in this repository.
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

-- -----------------------------------------------------------------------------
-- Enumerated types
-- -----------------------------------------------------------------------------

-- One core product, three account shapes. Not three products.
create type public.account_type as enum ('individual', 'agency', 'organisation');
create type public.org_role     as enum ('owner', 'admin', 'member');

-- Platform roles are ours, not the customer's. Reviewers are staff.
create type public.platform_role as enum ('user', 'reviewer', 'admin');

create type public.app_type as enum ('web_url', 'repository', 'mobile_build');

create type public.screening_status as enum ('pending', 'cleared', 'refused');

-- How we proved the customer controls the thing they are asking us to test.
create type public.authorisation_method as enum (
  'dns_txt', 'well_known_file', 'verified_email_domain', 'oauth_repository'
);
create type public.authorisation_status as enum ('pending', 'verified', 'revoked', 'expired');

create type public.assessment_status as enum (
  'draft', 'queued', 'running', 'failed', 'awaiting_review', 'approved', 'rejected', 'published'
);

-- Depth of coverage, NOT price. Named this way deliberately: nothing downstream
-- of the rubric may branch on what a customer paid, and a field called "tier"
-- invites exactly that mistake.
create type public.assessment_depth as enum ('limited', 'full', 'continuous');

create type public.run_stage as enum (
  'static_intake', 'deterministic_checks', 'functional_exploration',
  'adversarial_practicality', 'store_readiness', 'synthesis'
);
create type public.run_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'aborted');

create type public.rubric_dimension as enum (
  'functional_integrity', 'security_posture', 'data_privacy_practice',
  'practicality_ux', 'production_readiness', 'store_distribution_readiness'
);
create type public.finding_severity as enum ('critical', 'high', 'medium', 'low', 'info');
create type public.confidence_level as enum ('high', 'medium', 'low');

create type public.evidence_kind as enum (
  'screenshot', 'playwright_trace', 'http_exchange', 'console_log',
  'dom_snapshot', 'dependency_report', 'header_scan', 'lighthouse_report', 'accessibility_scan'
);

create type public.report_format as enum ('html', 'pdf');

create type public.review_action as enum ('approved', 'adjusted', 'rejected');

create type public.badge_status as enum ('active', 'suspended', 'revoked', 'expired');
create type public.badge_event_type as enum (
  'issued', 'renewed', 'suspended', 'reinstated', 'revoked', 'expired',
  'embed_observed', 'origin_mismatch', 'licence_accepted', 'takedown_requested'
);

create type public.plan_tier as enum ('free', 'one_off', 'certified', 'agency', 'organisation');
create type public.subscription_status as enum (
  'trialing', 'active', 'past_due', 'paused', 'cancelled', 'incomplete'
);
create type public.invoice_status as enum ('draft', 'open', 'paid', 'void', 'uncollectible', 'refunded');

create type public.appeal_status as enum ('open', 'under_review', 'upheld', 'partially_upheld', 'rejected', 'withdrawn');

create type public.consent_document as enum (
  'terms_of_service', 'assessment_services_agreement', 'authorisation_to_test',
  'badge_licence', 'acceptable_use_policy', 'privacy_policy',
  'data_processing_agreement', 'cookie_notice', 'marketing_email'
);
create type public.consent_action as enum ('accepted', 'withdrawn');

create type public.data_request_type as enum ('access', 'correction', 'deletion', 'portability', 'objection');
create type public.data_request_status as enum ('received', 'verifying', 'in_progress', 'completed', 'refused');

-- -----------------------------------------------------------------------------
-- Shared triggers
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Append-only enforcement. RLS alone is not enough: a future migration, a
-- service-role client, or a mistaken UPDATE by a maintenance script would all
-- bypass a policy. These tables are our evidence if a customer disputes a
-- finding or a regulator asks how a score was reached, so the prohibition is
-- enforced by a trigger that fires for every role, superuser included.
create or replace function public.reject_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception
    'Table %.% is append-only; % is not permitted. Record a new row instead.',
    tg_table_schema, tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

comment on function public.reject_mutation is
  'Blocks UPDATE and DELETE on append-only evidence tables (authorisations, badge_events, reviews, consents, audit_log).';

-- -----------------------------------------------------------------------------
-- Identity: users, organisations, memberships
--
-- Every account type is an organisation. A solo founder gets a personal
-- organisation of one, an agency gets a shared one with seats. This means every
-- domain table below can be scoped by a single `organisation_id`, and every RLS
-- policy in this schema reduces to the same question.
-- -----------------------------------------------------------------------------

create table public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         citext not null unique,
  full_name     text,
  -- Ours to set, never the customer's. Column-level grants below make it
  -- impossible for a user to promote themselves to reviewer.
  platform_role public.platform_role not null default 'user',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create table public.organisations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(btrim(name)) between 1 and 120),
  slug          citext not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  account_type  public.account_type not null default 'individual',
  is_personal   boolean not null default false,
  billing_email citext,
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create table public.memberships (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id         uuid not null references public.users(id) on delete cascade,
  role            public.org_role not null default 'member',
  invited_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organisation_id, user_id)
);

create index memberships_user_idx on public.memberships (user_id);
create index memberships_org_idx  on public.memberships (organisation_id);
create index organisations_created_by_idx on public.organisations (created_by);

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();
create trigger organisations_set_updated_at
  before update on public.organisations
  for each row execute function public.set_updated_at();
create trigger memberships_set_updated_at
  before update on public.memberships
  for each row execute function public.set_updated_at();

-- An organisation must never be left without an owner: losing the last owner
-- strands every app, badge and subscription underneath it.
create or replace function public.assert_organisation_keeps_an_owner()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  remaining integer;
  org uuid := coalesce(old.organisation_id, new.organisation_id);
begin
  select count(*) into remaining
  from public.memberships m
  where m.organisation_id = org and m.role = 'owner'
    and m.id <> coalesce(old.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if tg_op = 'UPDATE' and new.role = 'owner' then
    remaining := remaining + 1;
  end if;

  if remaining = 0 then
    raise exception 'An organisation must retain at least one owner'
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger memberships_keep_an_owner
  after update or delete on public.memberships
  for each row execute function public.assert_organisation_keeps_an_owner();

-- -----------------------------------------------------------------------------
-- Helper functions
--
-- All membership lookups are SECURITY DEFINER so that a policy on `memberships`
-- can ask "is this user a member?" without recursively invoking itself.
-- search_path is pinned on every one of them: a SECURITY DEFINER function with a
-- mutable search_path is a privilege-escalation hole.
-- -----------------------------------------------------------------------------

create or replace function public.current_user_id()
returns uuid
language sql
stable
set search_path = public, pg_temp
as $$
  select auth.uid();
$$;

create or replace function public.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organisation_id = org
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(org uuid, allowed public.org_role[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organisation_id = org
      and m.user_id = auth.uid()
      and m.role = any(allowed)
  );
$$;

create or replace function public.platform_role_of(target uuid)
returns public.platform_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.platform_role from public.users u where u.id = target;
$$;

-- Reviewers are staff who must see customer assessments in order to review them.
-- This is the human-in-the-loop requirement, and it is a deliberate, logged
-- widening of access rather than an accident of policy design.
create or replace function public.is_reviewer()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.platform_role_of(auth.uid()) in ('reviewer', 'admin');
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.platform_role_of(auth.uid()) = 'admin';
$$;

-- -----------------------------------------------------------------------------
-- Row-level security: identity
--
-- Default deny. Nothing is readable unless a policy says so, and the shape of
-- every policy is the same question: is the caller a member of the organisation
-- that owns this row?
-- -----------------------------------------------------------------------------

create or replace function public.shares_org_with(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.organisation_id = mine.organisation_id
    where mine.user_id = auth.uid()
      and theirs.user_id = target
  );
$$;

alter table public.users         enable row level security;
alter table public.organisations enable row level security;
alter table public.memberships   enable row level security;

alter table public.users         force row level security;
alter table public.organisations force row level security;
alter table public.memberships   force row level security;

-- users -----------------------------------------------------------------------
create policy users_select_self_or_colleague on public.users
  for select to authenticated
  using (id = auth.uid() or public.shares_org_with(id) or public.is_reviewer());

create policy users_insert_self on public.users
  for insert to authenticated
  with check (id = auth.uid());

create policy users_update_self on public.users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- organisations ---------------------------------------------------------------
create policy organisations_select_members on public.organisations
  for select to authenticated
  using (public.is_org_member(id) or public.is_reviewer());

create policy organisations_insert_own on public.organisations
  for insert to authenticated
  with check (created_by = auth.uid());

create policy organisations_update_admins on public.organisations
  for update to authenticated
  using (public.has_org_role(id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(id, array['owner', 'admin']::public.org_role[]));

-- memberships -----------------------------------------------------------------
create policy memberships_select_members on public.memberships
  for select to authenticated
  using (public.is_org_member(organisation_id) or public.is_reviewer());

create policy memberships_insert_admins on public.memberships
  for insert to authenticated
  with check (public.has_org_role(organisation_id, array['owner', 'admin']::public.org_role[]));

create policy memberships_update_admins on public.memberships
  for update to authenticated
  using (public.has_org_role(organisation_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organisation_id, array['owner', 'admin']::public.org_role[]));

-- A member may always remove themselves; an admin may remove anyone. The
-- last-owner trigger above still applies.
create policy memberships_delete_admin_or_self on public.memberships
  for delete to authenticated
  using (
    user_id = auth.uid()
    or public.has_org_role(organisation_id, array['owner', 'admin']::public.org_role[])
  );

-- -----------------------------------------------------------------------------
-- Grants
--
-- RLS decides which rows; grants decide which columns and verbs. Both are
-- needed. platform_role is deliberately absent from the update grant, so no
-- policy mistake can ever let a user promote themselves to reviewer.
-- -----------------------------------------------------------------------------

revoke all on public.users, public.organisations, public.memberships from public, anon, authenticated;

grant select, insert on public.users to authenticated;
grant update (full_name) on public.users to authenticated;

grant select, insert, update on public.organisations to authenticated;
grant select, insert, update, delete on public.memberships to authenticated;

-- -----------------------------------------------------------------------------
-- Sign-up: every new auth user gets a profile row and a personal organisation
-- they own, so the rest of the schema has an organisation to hang off from the
-- very first request.
-- -----------------------------------------------------------------------------

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  base_slug text;
  final_slug text;
  suffix integer := 0;
  new_org uuid;
begin
  insert into public.users (id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '')
  )
  on conflict (id) do nothing;

  base_slug := regexp_replace(lower(split_part(new.email, '@', 1)), '[^a-z0-9]+', '-', 'g');
  base_slug := btrim(base_slug, '-');
  if length(base_slug) < 2 then
    base_slug := 'account';
  end if;
  base_slug := left(base_slug, 40);
  final_slug := base_slug;

  while exists (select 1 from public.organisations o where o.slug = final_slug) loop
    suffix := suffix + 1;
    final_slug := base_slug || '-' || suffix::text;
  end loop;

  insert into public.organisations (name, slug, account_type, is_personal, created_by, billing_email)
  values (
    coalesce(nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''), split_part(new.email, '@', 1)),
    final_slug,
    'individual',
    true,
    new.id,
    new.email
  )
  returning id into new_org;

  insert into public.memberships (organisation_id, user_id, role)
  values (new_org, new.id, 'owner');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
