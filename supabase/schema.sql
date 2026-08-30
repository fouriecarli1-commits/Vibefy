-- ---------------------------------------------------------------------------
-- VibefyCode — the complete schema, assembled from supabase/migrations.
--
-- GENERATED FILE. Do not edit. Run `pnpm schema:build` after adding a
-- migration; CI fails if this has drifted from the migrations it came from.
--
-- To set up a fresh hosted database: open the Supabase dashboard, go to the SQL
-- Editor, paste this whole file, and run it. It is safe to run once on an empty
-- project and is not written to be re-runnable — a second run will fail on
-- objects that already exist, which is the correct behaviour for a file whose
-- job is to build a database from nothing.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 20260822090000_foundations.sql
-- ===========================================================================

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

-- ===========================================================================
-- 20260822091000_apps_and_authorisations.sql
-- ===========================================================================

-- =============================================================================
-- 0002 — Apps and authorisation to test
--
-- Testing a system without authorisation is a criminal offence in every market
-- on our list (UAE Cybercrime Law, US CFAA, UK Computer Misuse Act, SA ECT Act),
-- and our adversarial pass makes that risk live rather than theoretical.
--
-- `authorisations` is therefore APPEND-ONLY. Each row is a complete, immutable
-- statement of what we were permitted to do, by whom, under which warranty text,
-- from which IP, at which moment. Lifecycle changes — verification, revocation,
-- expiry — insert a new row that supersedes the previous one. Nothing is ever
-- edited, because an edited authorisation record is worth nothing as evidence.
-- =============================================================================

create table public.apps (
  id                        uuid primary key default gen_random_uuid(),
  organisation_id           uuid not null references public.organisations(id) on delete cascade,
  name                      text not null check (length(btrim(name)) between 1 and 160),
  slug                      citext not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  app_type                  public.app_type not null,

  primary_url               text,
  repository_url            text,
  mobile_build_reference    text,

  category                  text,
  description               text check (description is null or length(description) <= 4000),
  builder                   text,
  target_audience           text,

  -- Self-declared at intake. These drive which rubric gates apply; they are not
  -- taken on trust, they are what the assessment goes looking to confirm.
  processes_personal_data   boolean not null default false,
  has_authentication        boolean not null default false,
  has_payments              boolean not null default false,
  intended_for_app_store    boolean not null default false,

  -- Directory listing is opt-in and stays revocable even while certified.
  directory_opt_in          boolean not null default false,

  screening_status          public.screening_status not null default 'pending',
  screening_notes           text,
  screened_at               timestamptz,

  created_by                uuid references public.users(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  archived_at               timestamptz,

  unique (organisation_id, slug),

  -- The intake type must actually carry the reference the engine needs.
  constraint apps_reference_matches_type check (
    (app_type = 'web_url'      and primary_url is not null)
    or (app_type = 'repository'   and repository_url is not null)
    or (app_type = 'mobile_build' and mobile_build_reference is not null)
  ),
  constraint apps_url_is_https check (primary_url is null or primary_url ~* '^https://')
);

create index apps_org_idx on public.apps (organisation_id) where archived_at is null;

create trigger apps_set_updated_at
  before update on public.apps
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Authorisations — append-only
-- -----------------------------------------------------------------------------

create table public.authorisations (
  id                      uuid primary key default gen_random_uuid(),
  app_id                  uuid not null references public.apps(id) on delete restrict,
  -- Denormalised so every RLS policy on this table is a single comparison and
  -- never a join into a table that might itself be filtered.
  organisation_id         uuid not null references public.organisations(id) on delete restrict,

  supersedes_id           uuid references public.authorisations(id) on delete restrict,
  status                  public.authorisation_status not null default 'pending',

  method                  public.authorisation_method not null,
  verification_token      text,
  verification_target     text,
  verified_at             timestamptz,

  -- The runner enforces this allowlist at network level. Out-of-scope requests
  -- are blocked by the sandbox, not discouraged by a prompt.
  scope_domains           text[] not null default '{}',
  scope_exclusions        text[] not null default '{}',
  third_parties           text[] not null default '{}',

  -- Runner configuration the model cannot widen: non-destructive only, rate
  -- limited, no exfiltration, no persistence, no denial-of-service patterns.
  intensity_ceiling       jsonb not null default jsonb_build_object(
                            'non_destructive_only', true,
                            'max_requests_per_minute', 60,
                            'max_total_requests', 5000,
                            'max_duration_seconds', 1800,
                            'allow_data_modification', false,
                            'allow_data_export', false,
                            'allow_account_creation', true,
                            'synthetic_accounts_only', true
                          ),

  -- Exactly which words the customer agreed to, and the circumstances of the
  -- agreement. This is the record we would produce if testing were challenged.
  warranty_text_version   text not null,
  warranty_text_sha256    text not null check (warranty_text_sha256 ~ '^[0-9a-f]{64}$'),
  granted_by              uuid not null references public.users(id) on delete restrict,
  accepted_at             timestamptz not null default now(),
  accepted_ip             inet,
  accepted_user_agent     text,

  expires_at              timestamptz,
  revocation_reason       text,
  created_at              timestamptz not null default now(),

  constraint authorisations_verified_needs_scope check (
    status <> 'verified' or cardinality(scope_domains) > 0
  ),
  constraint authorisations_verified_needs_timestamp check (
    status <> 'verified' or verified_at is not null
  ),
  constraint authorisations_revoked_needs_reason check (
    status <> 'revoked' or length(btrim(coalesce(revocation_reason, ''))) >= 10
  ),
  constraint authorisations_intensity_is_non_destructive check (
    (intensity_ceiling ->> 'non_destructive_only')::boolean is true
    and (intensity_ceiling ->> 'allow_data_modification')::boolean is false
    and (intensity_ceiling ->> 'allow_data_export')::boolean is false
    and (intensity_ceiling ->> 'synthetic_accounts_only')::boolean is true
  )
);

create index authorisations_app_idx on public.authorisations (app_id, created_at desc);
create unique index authorisations_supersedes_once on public.authorisations (supersedes_id)
  where supersedes_id is not null;

create trigger authorisations_no_update
  before update or delete on public.authorisations
  for each row execute function public.reject_mutation();

-- The single row that decides whether a run may start: the most recent
-- authorisation for an app, which must be verified and unexpired.
create or replace function public.current_authorisation(target_app uuid)
returns public.authorisations
language sql
stable
set search_path = public, pg_temp
as $$
  select a.*
  from public.authorisations a
  where a.app_id = target_app
  order by a.created_at desc, a.id desc
  limit 1;
$$;

create or replace function public.app_is_authorised_for_testing(target_app uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select a.status = 'verified'
         and a.verified_at is not null
         and (a.expires_at is null or a.expires_at > now())
         and cardinality(a.scope_domains) > 0
      from public.current_authorisation(target_app) a
    ),
    false
  );
$$;

comment on function public.app_is_authorised_for_testing is
  'Hard gate. No assessment may be created for an app for which this returns false.';

-- -----------------------------------------------------------------------------
-- Row-level security
-- -----------------------------------------------------------------------------

alter table public.apps           enable row level security;
alter table public.authorisations enable row level security;
alter table public.apps           force row level security;
alter table public.authorisations force row level security;

create policy apps_select_members on public.apps
  for select to authenticated
  using (public.is_org_member(organisation_id) or public.is_reviewer());

create policy apps_insert_members on public.apps
  for insert to authenticated
  with check (public.is_org_member(organisation_id) and created_by = auth.uid());

create policy apps_update_admins on public.apps
  for update to authenticated
  using (public.has_org_role(organisation_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organisation_id, array['owner', 'admin']::public.org_role[]));

create policy authorisations_select_members on public.authorisations
  for select to authenticated
  using (public.is_org_member(organisation_id) or public.is_reviewer());

-- Only an owner or admin can warrant that the organisation is entitled to
-- authorise testing, and only ever in their own name.
create policy authorisations_insert_admins on public.authorisations
  for insert to authenticated
  with check (
    public.has_org_role(organisation_id, array['owner', 'admin']::public.org_role[])
    and granted_by = auth.uid()
    and app_id in (select id from public.apps where organisation_id = authorisations.organisation_id)
  );

revoke all on public.apps, public.authorisations from public, anon, authenticated;
grant select, insert, update on public.apps to authenticated;
grant select, insert on public.authorisations to authenticated;

-- ===========================================================================
-- 20260822092000_assessments.sql
-- ===========================================================================

-- =============================================================================
-- 0003 — The assessment core
--
-- Three rules are enforced here in the database, not only in application code,
-- because each of them is a rule we sell:
--
--   1. No assessment exists without a verified authorisation to test.
--   2. No finding is published without evidence.
--   3. No assessment reaches "approved" without a human review action.
--
-- Application code will enforce these too. The database enforces them again so
-- that a bug, a migration, or a future maintainer cannot quietly undo them.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Rubric versions — the published methodology, as data
-- -----------------------------------------------------------------------------

create table public.rubric_versions (
  version        text primary key check (version ~ '^\d+\.\d+\.\d+$'),
  definition     jsonb not null,
  checksum       text not null check (checksum ~ '^[0-9a-f]{64}$'),
  changelog      text not null,
  published_at   timestamptz,
  effective_from timestamptz,
  superseded_at  timestamptz,
  created_at     timestamptz not null default now()
);

-- A published rubric version is frozen. Scores are never retroactively altered
-- by a rubric change, so the definition a score was computed against must stay
-- byte-identical for as long as that score exists.
create or replace function public.reject_published_rubric_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.published_at is not null
     and (new.definition is distinct from old.definition
          or new.checksum is distinct from old.checksum
          or new.version is distinct from old.version) then
    raise exception 'Rubric version % is published and immutable; publish a new version instead', old.version
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger rubric_versions_frozen_once_published
  before update on public.rubric_versions
  for each row execute function public.reject_published_rubric_change();

-- The methodology page is a product, not a footnote: it is the source of the
-- badge's credibility, so published rubric versions are world-readable.
alter table public.rubric_versions enable row level security;
alter table public.rubric_versions force row level security;

create policy rubric_versions_public_read on public.rubric_versions
  for select to anon, authenticated
  using (published_at is not null);

create policy rubric_versions_admin_write on public.rubric_versions
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

revoke all on public.rubric_versions from public, anon, authenticated;
grant select on public.rubric_versions to anon, authenticated;
grant insert, update on public.rubric_versions to authenticated;

-- -----------------------------------------------------------------------------
-- Assessments
-- -----------------------------------------------------------------------------

create table public.assessments (
  id                     uuid primary key default gen_random_uuid(),
  app_id                 uuid not null references public.apps(id) on delete restrict,
  organisation_id        uuid not null references public.organisations(id) on delete restrict,

  -- Hard link, not a soft reference. An assessment row cannot exist without
  -- pointing at the exact authorisation record that permitted it.
  authorisation_id       uuid not null references public.authorisations(id) on delete restrict,

  rubric_version         text not null references public.rubric_versions(version) on delete restrict,

  -- Coverage, not price. Nothing downstream of scoring reads this column, and
  -- the scoring input type in packages/rubric structurally cannot carry it.
  depth                  public.assessment_depth not null default 'limited',

  status                 public.assessment_status not null default 'draft',

  overall_score          numeric(5,2) check (overall_score between 0 and 100),
  dimension_scores       jsonb,
  certification_eligible boolean not null default false,
  gate_failures          text[] not null default '{}',

  -- Frozen at generation time so that a later edit to the standard wording can
  -- never change what a customer was actually told.
  scope_statement        text,

  prompt_bundle_sha256   text check (prompt_bundle_sha256 is null or prompt_bundle_sha256 ~ '^[0-9a-f]{64}$'),
  engine_version         text,

  requested_by           uuid references public.users(id) on delete set null,
  started_at             timestamptz,
  completed_at           timestamptz,
  reviewed_at            timestamptz,
  published_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index assessments_app_idx on public.assessments (app_id, created_at desc);
create index assessments_org_idx on public.assessments (organisation_id);
create index assessments_review_queue_idx on public.assessments (created_at)
  where status = 'awaiting_review';

create trigger assessments_set_updated_at
  before update on public.assessments
  for each row execute function public.set_updated_at();

-- Gate 1: no assessment without a live, verified authorisation for this app.
create or replace function public.assert_assessment_is_authorised()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  current_id uuid;
  auth_org uuid;
  auth_app uuid;
begin
  select id into current_id from public.current_authorisation(new.app_id);

  if current_id is null or not public.app_is_authorised_for_testing(new.app_id) then
    raise exception 'App % has no verified, unexpired authorisation to test', new.app_id
      using errcode = 'restrict_violation',
            hint = 'Complete ownership verification and the signed authorisation warranty first.';
  end if;

  if new.authorisation_id <> current_id then
    raise exception 'Assessment must reference the current authorisation (%), not %', current_id, new.authorisation_id
      using errcode = 'restrict_violation';
  end if;

  select organisation_id, app_id into auth_org, auth_app
  from public.authorisations where id = new.authorisation_id;

  if auth_app <> new.app_id or auth_org <> new.organisation_id then
    raise exception 'Authorisation % does not belong to app % in organisation %',
      new.authorisation_id, new.app_id, new.organisation_id
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger assessments_require_authorisation
  before insert on public.assessments
  for each row execute function public.assert_assessment_is_authorised();

-- -----------------------------------------------------------------------------
-- Runs, findings, evidence
-- -----------------------------------------------------------------------------

create table public.assessment_runs (
  id              uuid primary key default gen_random_uuid(),
  assessment_id   uuid not null references public.assessments(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  stage           public.run_stage not null,
  attempt         integer not null default 1 check (attempt between 1 and 10),
  status          public.run_status not null default 'queued',
  runner_id       text,
  -- Copied from the authorisation at dispatch so the sandbox configuration that
  -- actually ran is recoverable even if a later authorisation supersedes it.
  enforced_scope  jsonb,
  started_at      timestamptz,
  finished_at     timestamptz,
  error_message   text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  unique (assessment_id, stage, attempt)
);

create index assessment_runs_assessment_idx on public.assessment_runs (assessment_id);

create table public.findings (
  id              uuid primary key default gen_random_uuid(),
  assessment_id   uuid not null references public.assessments(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  run_id          uuid references public.assessment_runs(id) on delete set null,

  dimension       public.rubric_dimension not null,
  severity        public.finding_severity not null,
  confidence      public.confidence_level not null,
  rubric_rule_id  text not null,

  title           text not null check (length(btrim(title)) between 5 and 200),
  description     text not null check (length(btrim(description)) >= 20),
  remediation     text not null check (length(btrim(remediation)) >= 20),

  -- A finding the model could not evidence is withheld, not published. A false
  -- accusation against a customer's app is a legal and reputational event.
  is_published    boolean not null default true,
  withheld_reason text,

  created_at      timestamptz not null default now(),

  constraint findings_withheld_needs_reason check (
    is_published or length(btrim(coalesce(withheld_reason, ''))) >= 10
  )
);

create index findings_assessment_idx on public.findings (assessment_id);

create table public.evidence (
  id              uuid primary key default gen_random_uuid(),
  finding_id      uuid references public.findings(id) on delete cascade,
  assessment_id   uuid not null references public.assessments(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,

  kind            public.evidence_kind not null,
  storage_path    text not null,
  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  content_type    text,
  byte_size       bigint check (byte_size >= 0),

  -- Screenshots and traces may contain incidental personal data, so this class
  -- carries the shortest default retention of anything we hold.
  captured_at     timestamptz not null default now(),
  retention_until timestamptz not null default (now() + interval '30 days'),
  redacted        boolean not null default false,

  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index evidence_finding_idx on public.evidence (finding_id);
create index evidence_expiry_idx on public.evidence (retention_until);

-- Gate 2: no published finding without evidence, checked whenever an assessment
-- leaves the engine and becomes something a human or a customer will read.
create or replace function public.assert_findings_have_evidence()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  unevidenced integer;
begin
  if new.status in ('awaiting_review', 'approved', 'published')
     and old.status is distinct from new.status then
    select count(*) into unevidenced
    from public.findings f
    where f.assessment_id = new.id
      and f.is_published
      and not exists (select 1 from public.evidence e where e.finding_id = f.id);

    if unevidenced > 0 then
      raise exception '% published finding(s) on assessment % have no evidence', unevidenced, new.id
        using errcode = 'restrict_violation',
              hint = 'Attach evidence, or withhold the finding with a stated reason.';
    end if;
  end if;
  return new;
end;
$$;

create trigger assessments_require_evidence
  before update on public.assessments
  for each row execute function public.assert_findings_have_evidence();

-- Any critical security or privacy finding caps the score below the
-- certification threshold regardless of arithmetic. This is the database
-- backstop for the rubric gate; packages/rubric implements the same rule.
create or replace function public.assert_certification_gate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  critical_count integer;
begin
  if new.certification_eligible then
    select count(*) into critical_count
    from public.findings f
    where f.assessment_id = new.id
      and f.is_published
      and f.severity = 'critical'
      and f.dimension in ('security_posture', 'data_privacy_practice');

    if critical_count > 0 then
      raise exception
        'Assessment % has % critical security or privacy finding(s) and cannot be certification-eligible',
        new.id, critical_count
        using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger assessments_certification_gate
  before insert or update on public.assessments
  for each row execute function public.assert_certification_gate();

-- -----------------------------------------------------------------------------
-- Human review — append-only
-- -----------------------------------------------------------------------------

create table public.reviews (
  id               uuid primary key default gen_random_uuid(),
  assessment_id    uuid not null references public.assessments(id) on delete restrict,
  organisation_id  uuid not null references public.organisations(id) on delete restrict,
  reviewer_id      uuid not null references public.users(id) on delete restrict,
  action           public.review_action not null,
  -- An override without a written reason is rejected by the database. The
  -- independence policy promises these are auditable; this is what makes that true.
  reason           text,
  previous_scores  jsonb,
  new_scores       jsonb,
  created_at       timestamptz not null default now(),

  constraint reviews_override_needs_reason check (
    action = 'approved' or length(btrim(coalesce(reason, ''))) >= 20
  )
);

create index reviews_assessment_idx on public.reviews (assessment_id, created_at desc);

create trigger reviews_no_update
  before update or delete on public.reviews
  for each row execute function public.reject_mutation();

-- Gate 3: an assessment reaches approved or rejected only via a logged human
-- review action by a reviewer, and only from the review queue.
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
    if not exists (
      select 1 from public.reviews r
      where r.assessment_id = new.id
        and r.created_at >= now() - interval '1 hour'
    ) then
      raise exception 'Assessment % cannot be % without a recorded human review action', new.id, new.status
        using errcode = 'restrict_violation',
              hint = 'Insert the review row first; AI never certifies alone.';
    end if;
  end if;
  return new;
end;
$$;

create trigger assessments_require_human_review
  before update on public.assessments
  for each row execute function public.assert_human_review();

-- -----------------------------------------------------------------------------
-- Reports
-- -----------------------------------------------------------------------------

create table public.reports (
  id                   uuid primary key default gen_random_uuid(),
  assessment_id        uuid not null references public.assessments(id) on delete cascade,
  organisation_id      uuid not null references public.organisations(id) on delete cascade,
  format               public.report_format not null,
  storage_path         text not null,
  sha256               text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  rubric_version       text not null references public.rubric_versions(version) on delete restrict,
  -- Both blocks are frozen into the row at generation time.
  scope_statement      text not null check (length(btrim(scope_statement)) >= 100),
  non_reliance_legend  text not null check (length(btrim(non_reliance_legend)) >= 40),
  generated_at         timestamptz not null default now(),
  published_at         timestamptz,
  created_at           timestamptz not null default now(),
  unique (assessment_id, format)
);

-- -----------------------------------------------------------------------------
-- Row-level security
-- -----------------------------------------------------------------------------

alter table public.assessments     enable row level security;
alter table public.assessment_runs enable row level security;
alter table public.findings        enable row level security;
alter table public.evidence        enable row level security;
alter table public.reviews         enable row level security;
alter table public.reports         enable row level security;

alter table public.assessments     force row level security;
alter table public.assessment_runs force row level security;
alter table public.findings        force row level security;
alter table public.evidence        force row level security;
alter table public.reviews         force row level security;
alter table public.reports         force row level security;

create policy assessments_select_members on public.assessments
  for select to authenticated
  using (public.is_org_member(organisation_id) or public.is_reviewer());

create policy assessments_insert_members on public.assessments
  for insert to authenticated
  with check (public.is_org_member(organisation_id));

-- Customers may act on their own assessments; only reviewers may approve or
-- reject one. The trigger above additionally requires a logged review action.
create policy assessments_update_members on public.assessments
  for update to authenticated
  using (public.is_org_member(organisation_id) or public.is_reviewer())
  with check (
    (status not in ('approved', 'rejected') and public.is_org_member(organisation_id))
    or public.is_reviewer()
  );

create policy assessment_runs_select_members on public.assessment_runs
  for select to authenticated
  using (public.is_org_member(organisation_id) or public.is_reviewer());

create policy findings_select_members on public.findings
  for select to authenticated
  using (public.is_org_member(organisation_id) or public.is_reviewer());

create policy evidence_select_members on public.evidence
  for select to authenticated
  using (public.is_org_member(organisation_id) or public.is_reviewer());

create policy reports_select_members on public.reports
  for select to authenticated
  using (public.is_org_member(organisation_id) or public.is_reviewer());

create policy reviews_select_members on public.reviews
  for select to authenticated
  using (public.is_org_member(organisation_id) or public.is_reviewer());

create policy reviews_insert_reviewers on public.reviews
  for insert to authenticated
  with check (public.is_reviewer() and reviewer_id = auth.uid());

revoke all on
  public.assessments, public.assessment_runs, public.findings,
  public.evidence, public.reviews, public.reports
from public, anon, authenticated;

grant select, insert, update on public.assessments to authenticated;
grant select on public.assessment_runs, public.findings, public.evidence, public.reports to authenticated;
grant select, insert on public.reviews to authenticated;

-- ===========================================================================
-- 20260822093000_governance.sql
-- ===========================================================================

-- =============================================================================
-- 0004 — Governance: consent, audit, appeals, data-subject requests
--
-- `consents` and `audit_log` are append-only. Consent that can be edited is not
-- consent, and an audit log that can be rewritten is not an audit log.
-- =============================================================================

create table public.consents (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id) on delete restrict,
  organisation_id  uuid references public.organisations(id) on delete restrict,
  document_type    public.consent_document not null,
  document_version text not null,
  -- Pins the exact bytes the user agreed to, so "which version did they accept"
  -- is answerable years later even if the file is edited.
  document_sha256  text not null check (document_sha256 ~ '^[0-9a-f]{64}$'),
  action           public.consent_action not null default 'accepted',
  supersedes_id    uuid references public.consents(id) on delete restrict,
  occurred_at      timestamptz not null default now(),
  ip               inet,
  user_agent       text,
  created_at       timestamptz not null default now()
);

create index consents_user_idx on public.consents (user_id, document_type, occurred_at desc);
create index consents_org_idx on public.consents (organisation_id);

create trigger consents_no_update
  before update or delete on public.consents
  for each row execute function public.reject_mutation();

create or replace function public.has_current_consent(
  target_user uuid,
  document public.consent_document,
  required_version text
)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select c.action = 'accepted' and c.document_version = required_version
      from public.consents c
      where c.user_id = target_user and c.document_type = document
      order by c.occurred_at desc, c.id desc
      limit 1
    ),
    false
  );
$$;

-- -----------------------------------------------------------------------------
-- Audit log — append-only
-- -----------------------------------------------------------------------------

create table public.audit_log (
  id              bigint generated always as identity primary key,
  organisation_id uuid references public.organisations(id) on delete set null,
  actor_id        uuid references public.users(id) on delete set null,
  actor_role      text,
  action          text not null check (length(btrim(action)) > 0),
  entity_type     text not null,
  entity_id       uuid,
  summary         text,
  before_state    jsonb,
  after_state     jsonb,
  ip              inet,
  user_agent      text,
  occurred_at     timestamptz not null default now()
);

create index audit_log_org_idx on public.audit_log (organisation_id, occurred_at desc);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);

create trigger audit_log_no_update
  before update or delete on public.audit_log
  for each row execute function public.reject_mutation();

-- -----------------------------------------------------------------------------
-- Appeals — the answer to "AI output may contain errors"
-- -----------------------------------------------------------------------------

create table public.appeals (
  id              uuid primary key default gen_random_uuid(),
  assessment_id   uuid not null references public.assessments(id) on delete restrict,
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  finding_id      uuid references public.findings(id) on delete set null,
  submitted_by    uuid not null references public.users(id) on delete restrict,
  status          public.appeal_status not null default 'open',
  grounds         text not null check (length(btrim(grounds)) >= 30),
  resolution      text,
  resolved_by     uuid references public.users(id) on delete set null,
  -- A published appeals route with no deadline is not a route.
  due_at          timestamptz not null default (now() + interval '14 days'),
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint appeals_resolution_needs_text check (
    status in ('open', 'under_review', 'withdrawn')
    or length(btrim(coalesce(resolution, ''))) >= 20
  )
);

create index appeals_queue_idx on public.appeals (status, due_at);

create trigger appeals_set_updated_at
  before update on public.appeals
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Data-subject requests — working flows, not an email address in a footer
-- -----------------------------------------------------------------------------

create table public.data_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete restrict,
  organisation_id uuid references public.organisations(id) on delete set null,
  request_type    public.data_request_type not null,
  status          public.data_request_status not null default 'received',
  details         text,
  response        text,
  export_path     text,
  -- GDPR-grade default. A shorter statutory deadline in a chosen jurisdiction
  -- narrows this; it never widens it.
  due_at          timestamptz not null default (now() + interval '30 days'),
  handled_by      uuid references public.users(id) on delete set null,
  completed_at    timestamptz,
  refusal_basis   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint data_requests_refusal_needs_basis check (
    status <> 'refused' or length(btrim(coalesce(refusal_basis, ''))) >= 20
  )
);

create index data_requests_queue_idx on public.data_requests (status, due_at);

create trigger data_requests_set_updated_at
  before update on public.data_requests
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row-level security
-- -----------------------------------------------------------------------------

alter table public.consents      enable row level security;
alter table public.audit_log     enable row level security;
alter table public.appeals       enable row level security;
alter table public.data_requests enable row level security;

alter table public.consents      force row level security;
alter table public.audit_log     force row level security;
alter table public.appeals       force row level security;
alter table public.data_requests force row level security;

create policy consents_select_own on public.consents
  for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin());

create policy consents_insert_own on public.consents
  for insert to authenticated
  with check (user_id = auth.uid());

-- Customers can read their own organisation's audit trail — the log exists to
-- make our decisions inspectable, which is worth little if only we can inspect it.
create policy audit_log_select_members on public.audit_log
  for select to authenticated
  using (
    (organisation_id is not null and public.is_org_member(organisation_id))
    or public.is_platform_admin()
  );

create policy appeals_select_members on public.appeals
  for select to authenticated
  using (public.is_org_member(organisation_id) or public.is_reviewer());

create policy appeals_insert_members on public.appeals
  for insert to authenticated
  with check (public.is_org_member(organisation_id) and submitted_by = auth.uid());

create policy appeals_update_reviewers on public.appeals
  for update to authenticated
  using (public.is_reviewer())
  with check (public.is_reviewer());

create policy data_requests_select_own on public.data_requests
  for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin());

create policy data_requests_insert_own on public.data_requests
  for insert to authenticated
  with check (user_id = auth.uid());

create policy data_requests_update_admin on public.data_requests
  for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

revoke all on public.consents, public.audit_log, public.appeals, public.data_requests
from public, anon, authenticated;

grant select, insert on public.consents to authenticated;
grant select on public.audit_log to authenticated;
grant select, insert, update on public.appeals to authenticated;
grant select, insert, update on public.data_requests to authenticated;

-- ===========================================================================
-- 20260822094000_badges.sql
-- ===========================================================================

-- =============================================================================
-- 0005 — The badge system: "Verified by VibefyCode"
--
-- VibefyCode's asset is not the testing, it is the credibility of the mark. A badge
-- that can be forged, cannot be revoked, or can be bought rather than earned
-- destroys the business, so this table is treated as security-critical
-- infrastructure at the same level as authentication.
--
-- Three properties are enforced here:
--   · A badge cannot exist unless a human approved a certification-eligible
--     assessment and the owner accepted the Badge Licence.
--   · A badge always expires, within twelve months at the outside.
--   · Every state transition is written to an append-only event log.
-- =============================================================================

-- Marketing-service clients are labelled on every public surface. The column
-- lives on the organisation because the disclosure obligation follows the
-- commercial relationship, not the individual app. Nothing in packages/rubric
-- can read it: it is not part of any scoring input.
alter table public.organisations
  add column is_marketing_client boolean not null default false,
  add column marketing_client_since timestamptz;

create table public.badges (
  id                  uuid primary key default gen_random_uuid(),
  app_id              uuid not null references public.apps(id) on delete restrict,
  organisation_id     uuid not null references public.organisations(id) on delete restrict,
  assessment_id       uuid not null references public.assessments(id) on delete restrict,

  -- Public identifiers. `slug` addresses the verification page at
  -- verify.<domain>/a/{slug}; `public_id` addresses the SVG at /badge/{id}.svg.
  slug                citext not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  public_id           text not null unique check (public_id ~ '^[A-Za-z0-9_-]{16,64}$'),

  status              public.badge_status not null default 'active',

  rubric_version      text not null references public.rubric_versions(version) on delete restrict,
  score               numeric(5,2) not null check (score between 0 and 100),
  assessed_at         timestamptz not null,

  -- The one domain this badge may be embedded on. Anything else is a mismatch
  -- and is logged as such.
  certified_origin    text not null check (certified_origin ~* '^https://[a-z0-9.-]+(:\d+)?$'),

  -- Ed25519 over the canonical payload. Third parties verify against the public
  -- key at verify.<domain>/.well-known/vibefycode-badge-key without contacting us.
  payload             jsonb not null,
  signature           text not null,
  signing_key_id      text not null,

  -- Proof the owner accepted the trademark licence before the mark was issued.
  licence_consent_id  uuid not null references public.consents(id) on delete restrict,

  issued_at           timestamptz not null default now(),
  expires_at          timestamptz not null,
  suspended_at        timestamptz,
  revoked_at          timestamptz,
  revocation_reason   text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Expiry is mandatory and bounded. A stale stamp is a liability.
  constraint badges_expiry_is_bounded check (
    expires_at > issued_at and expires_at <= issued_at + interval '12 months'
  ),
  constraint badges_revoked_needs_reason check (
    status <> 'revoked' or length(btrim(coalesce(revocation_reason, ''))) >= 10
  )
);

create unique index badges_one_active_per_app on public.badges (app_id)
  where status in ('active', 'suspended');
create index badges_expiry_idx on public.badges (expires_at) where status = 'active';

create trigger badges_set_updated_at
  before update on public.badges
  for each row execute function public.set_updated_at();

-- A badge is earned, never bought. Everything this trigger checks is a fact
-- about the assessment and the licence, and none of it is a fact about money.
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

create trigger badges_must_be_earned
  before insert on public.badges
  for each row execute function public.assert_badge_is_earned();

-- -----------------------------------------------------------------------------
-- Badge events — append-only
-- -----------------------------------------------------------------------------

create table public.badge_events (
  id              bigint generated always as identity primary key,
  badge_id        uuid not null references public.badges(id) on delete restrict,
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  event_type      public.badge_event_type not null,
  reason          text,
  actor_id        uuid references public.users(id) on delete set null,
  -- Origin telemetry is anti-spoofing, not analytics: a badge rendered from a
  -- domain other than the certified one is the signal we act on.
  observed_origin text,
  ip              inet,
  user_agent      text,
  metadata        jsonb not null default '{}'::jsonb,
  occurred_at     timestamptz not null default now()
);

create index badge_events_badge_idx on public.badge_events (badge_id, occurred_at desc);
create index badge_events_mismatch_idx on public.badge_events (occurred_at desc)
  where event_type = 'origin_mismatch';

create trigger badge_events_no_update
  before update or delete on public.badge_events
  for each row execute function public.reject_mutation();

-- Every status change writes its own event. Reconstructing a badge's history
-- from the badge row alone would be impossible, and that history is exactly
-- what a licence dispute turns on.
create or replace function public.record_badge_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.badge_events (badge_id, organisation_id, event_type, actor_id)
    values (new.id, new.organisation_id, 'issued', auth.uid());
  elsif new.status is distinct from old.status then
    insert into public.badge_events (badge_id, organisation_id, event_type, reason, actor_id)
    values (
      new.id,
      new.organisation_id,
      case new.status
        when 'active'    then 'reinstated'
        when 'suspended' then 'suspended'
        when 'revoked'   then 'revoked'
        when 'expired'   then 'expired'
      end::public.badge_event_type,
      new.revocation_reason,
      auth.uid()
    );
  end if;
  return null;
end;
$$;

create trigger badges_log_lifecycle
  after insert or update on public.badges
  for each row execute function public.record_badge_event();

-- A badge past its expiry is expired regardless of what the stored status says,
-- so a missed scheduled job can never leave a stale mark reading as active.
create or replace function public.badge_effective_status(b public.badges)
returns public.badge_status
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when b.status in ('revoked', 'suspended') then b.status
    when b.expires_at <= now() then 'expired'::public.badge_status
    else b.status
  end;
$$;

-- -----------------------------------------------------------------------------
-- Public verification surface
--
-- The verification page must be readable by anyone, including someone who has
-- never heard of us — that is the entire point of the mark. This view exposes
-- exactly the public fields and nothing else, so `badges` itself stays closed.
-- -----------------------------------------------------------------------------

create view public.badge_verification
with (security_invoker = false) as
select
  b.public_id,
  b.slug,
  public.badge_effective_status(b) as status,
  b.score,
  b.rubric_version,
  b.assessed_at,
  b.issued_at,
  b.expires_at,
  b.certified_origin,
  b.signature,
  b.signing_key_id,
  b.payload,
  a.name as app_name,
  o.name as owner_name,
  -- Disclosed wherever a rating is displayed, per the independence policy.
  o.is_marketing_client as owner_is_marketing_client
from public.badges b
join public.apps a on a.id = b.app_id
join public.organisations o on o.id = b.organisation_id;

comment on view public.badge_verification is
  'Public, anonymous-readable projection of a badge. The scope-and-limitations block is rendered by the verification page above the fold; this view carries the facts it states.';

-- -----------------------------------------------------------------------------
-- Row-level security
-- -----------------------------------------------------------------------------

alter table public.badges       enable row level security;
alter table public.badge_events enable row level security;
alter table public.badges       force row level security;
alter table public.badge_events force row level security;

create policy badges_select_members on public.badges
  for select to authenticated
  using (public.is_org_member(organisation_id) or public.is_reviewer());

-- Issuance and revocation are ours, not the customer's. A customer who could
-- insert a badge row could issue themselves a mark.
create policy badges_write_reviewers on public.badges
  for all to authenticated
  using (public.is_reviewer())
  with check (public.is_reviewer());

create policy badge_events_select_members on public.badge_events
  for select to authenticated
  using (public.is_org_member(organisation_id) or public.is_reviewer());

revoke all on public.badges, public.badge_events from public, anon, authenticated;
grant select, insert, update on public.badges to authenticated;
grant select on public.badge_events to authenticated;
grant select on public.badge_verification to anon, authenticated;

-- ===========================================================================
-- 20260822095000_commerce_and_cost.sql
-- ===========================================================================

-- =============================================================================
-- 0006 — Commerce and unit economics
--
-- Note what is NOT here: there is no foreign key from any table in this file
-- into `assessments`, `findings` or `badges` beyond ownership. Nothing on the
-- scoring path joins to a plan, a price or an invoice. That is the schema-level
-- half of "the score is never for sale"; packages/rubric enforces the other half
-- with types, and the independence test asserts the result.
--
-- Cost instrumentation is built now, in M0, rather than later. If unit cost
-- exceeds price the business is dead, so the number is visible from day one.
-- =============================================================================

create table public.subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations(id) on delete restrict,
  plan                   public.plan_tier not null default 'free',
  status                 public.subscription_status not null default 'active',
  seats                  integer not null default 1 check (seats between 1 and 500),

  stripe_customer_id     text,
  stripe_subscription_id text unique,

  current_period_start   timestamptz,
  current_period_end     timestamptz,
  cancel_at              timestamptz,
  cancelled_at           timestamptz,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint subscriptions_period_is_ordered check (
    current_period_end is null
    or current_period_start is null
    or current_period_end > current_period_start
  )
);

create unique index subscriptions_one_live_per_org on public.subscriptions (organisation_id)
  where status in ('trialing', 'active', 'past_due', 'paused');

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

create table public.invoices (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations(id) on delete restrict,
  subscription_id    uuid references public.subscriptions(id) on delete set null,
  stripe_invoice_id  text unique,
  -- Card data never touches our systems. These are Stripe's numbers, mirrored
  -- so the customer can see their own billing history without a round trip.
  amount_due_cents   integer not null check (amount_due_cents >= 0),
  amount_paid_cents  integer not null default 0 check (amount_paid_cents >= 0),
  amount_refunded_cents integer not null default 0 check (amount_refunded_cents >= 0),
  currency           text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  status             public.invoice_status not null default 'draft',
  tax_country        text check (tax_country is null or tax_country ~ '^[A-Z]{2}$'),
  hosted_invoice_url text,
  issued_at          timestamptz,
  paid_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint invoices_refund_within_payment check (amount_refunded_cents <= amount_paid_cents)
);

create index invoices_org_idx on public.invoices (organisation_id, issued_at desc);

create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Cost records — one row per run stage, so a runaway loop is visible while it
-- is still running rather than at the end of the month.
-- -----------------------------------------------------------------------------

create table public.cost_records (
  id                   uuid primary key default gen_random_uuid(),
  assessment_id        uuid not null references public.assessments(id) on delete cascade,
  assessment_run_id    uuid references public.assessment_runs(id) on delete cascade,
  organisation_id      uuid not null references public.organisations(id) on delete cascade,

  model                text,
  input_tokens         integer not null default 0 check (input_tokens >= 0),
  output_tokens        integer not null default 0 check (output_tokens >= 0),
  cache_read_tokens    integer not null default 0 check (cache_read_tokens >= 0),
  ai_cost_usd          numeric(12,6) not null default 0 check (ai_cost_usd >= 0),

  compute_seconds      numeric(12,3) not null default 0 check (compute_seconds >= 0),
  compute_cost_usd     numeric(12,6) not null default 0 check (compute_cost_usd >= 0),

  storage_bytes        bigint not null default 0 check (storage_bytes >= 0),
  third_party_calls    integer not null default 0 check (third_party_calls >= 0),
  third_party_cost_usd numeric(12,6) not null default 0 check (third_party_cost_usd >= 0),

  total_cost_usd       numeric(12,6) generated always as
                         (ai_cost_usd + compute_cost_usd + third_party_cost_usd) stored,

  recorded_at          timestamptz not null default now()
);

create index cost_records_assessment_idx on public.cost_records (assessment_id);
create index cost_records_recorded_idx on public.cost_records (recorded_at desc);
create index cost_records_org_idx on public.cost_records (organisation_id, recorded_at desc);

-- Feeds the internal dashboard and the global daily spend cap.
create view public.daily_spend
with (security_invoker = true) as
select
  date_trunc('day', c.recorded_at) as day,
  count(distinct c.assessment_id)  as assessments,
  sum(c.ai_cost_usd)               as ai_cost_usd,
  sum(c.compute_cost_usd)          as compute_cost_usd,
  sum(c.total_cost_usd)            as total_cost_usd
from public.cost_records c
group by 1;

create view public.assessment_cost
with (security_invoker = true) as
select
  c.assessment_id,
  c.organisation_id,
  a.depth,
  sum(c.input_tokens)    as input_tokens,
  sum(c.output_tokens)   as output_tokens,
  sum(c.total_cost_usd)  as total_cost_usd
from public.cost_records c
join public.assessments a on a.id = c.assessment_id
group by c.assessment_id, c.organisation_id, a.depth;

-- -----------------------------------------------------------------------------
-- Row-level security
-- -----------------------------------------------------------------------------

alter table public.subscriptions enable row level security;
alter table public.invoices      enable row level security;
alter table public.cost_records  enable row level security;

alter table public.subscriptions force row level security;
alter table public.invoices      force row level security;
alter table public.cost_records  force row level security;

create policy subscriptions_select_members on public.subscriptions
  for select to authenticated
  using (public.is_org_member(organisation_id));

create policy invoices_select_members on public.invoices
  for select to authenticated
  using (public.is_org_member(organisation_id));

-- Our margins are ours. Cost data is not customer-facing, and — importantly —
-- it is not reviewer-facing either: a reviewer who could see what an assessment
-- cost us would be a reviewer with a commercial signal in front of them.
create policy cost_records_select_admins on public.cost_records
  for select to authenticated
  using (public.is_platform_admin());

revoke all on public.subscriptions, public.invoices, public.cost_records
from public, anon, authenticated;

grant select on public.subscriptions, public.invoices to authenticated;
grant select on public.cost_records to authenticated;
grant select on public.daily_spend, public.assessment_cost to authenticated;

-- ===========================================================================
-- 20260822100000_finding_evidence.sql
-- ===========================================================================

-- =============================================================================
-- 0007 — Evidence is many-to-many with findings
--
-- The original model put finding_id on the evidence row, which quietly cannot
-- express the common case: one screenshot or one HTTP exchange evidencing
-- several findings. In practice a single response to `/` is the evidence for the
-- missing CSP, the flagless cookie and the credential in the bundle — and with a
-- single foreign key, attaching it to the third finding detached it from the
-- first two, leaving them silently unevidenced.
--
-- A finding that lost its evidence to a data-modelling artefact is exactly the
-- kind of finding we promise never to publish, so the relationship is corrected
-- rather than worked around.
-- =============================================================================

create table public.finding_evidence (
  finding_id      uuid not null references public.findings(id) on delete cascade,
  evidence_id     uuid not null references public.evidence(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (finding_id, evidence_id)
);

create index finding_evidence_evidence_idx on public.finding_evidence (evidence_id);

-- Backfill anything already attached, then retire the column so there is one
-- source of truth rather than two that can disagree.
insert into public.finding_evidence (finding_id, evidence_id, organisation_id)
select e.finding_id, e.id, e.organisation_id
from public.evidence e
where e.finding_id is not null
on conflict do nothing;

drop index if exists public.evidence_finding_idx;
alter table public.evidence drop column finding_id;

-- Gate 2, restated against the corrected relationship.
create or replace function public.assert_findings_have_evidence()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  unevidenced integer;
begin
  if new.status in ('awaiting_review', 'approved', 'published')
     and old.status is distinct from new.status then
    select count(*) into unevidenced
    from public.findings f
    where f.assessment_id = new.id
      and f.is_published
      and not exists (select 1 from public.finding_evidence fe where fe.finding_id = f.id);

    if unevidenced > 0 then
      raise exception '% published finding(s) on assessment % have no evidence', unevidenced, new.id
        using errcode = 'restrict_violation',
              hint = 'Attach evidence, or withhold the finding with a stated reason.';
    end if;
  end if;
  return new;
end;
$$;

alter table public.finding_evidence enable row level security;
alter table public.finding_evidence force row level security;

create policy finding_evidence_select_members on public.finding_evidence
  for select to authenticated
  using (public.is_org_member(organisation_id) or public.is_reviewer());

revoke all on public.finding_evidence from public, anon, authenticated;
grant select on public.finding_evidence to authenticated;

-- ===========================================================================
-- 20260822110000_report_narrative.sql
-- ===========================================================================

-- =============================================================================
-- 0008 — The report narrative is part of the assessment record
--
-- Synthesis produces the prose a customer actually reads: the headline, the
-- summary, what the application does well, the prioritised remediation order,
-- and what was not assessed. Keeping it only in the engine's memory would mean a
-- report could never be regenerated from the database, which is the whole point
-- of storing an assessment.
--
-- `not_assessed` is the reason this is a column rather than a nicety: a report
-- that cannot say what it did not cover is a report whose silence reads as a
-- clean result.
-- =============================================================================

alter table public.assessments
  add column report_narrative jsonb;

comment on column public.assessments.report_narrative is
  'Frozen output of the synthesis stage. Regenerating a report reads this, never the current prompt.';

-- ===========================================================================
-- 20260822120000_billing_events.sql
-- ===========================================================================

-- =============================================================================
-- 0009 — Billing events
--
-- Payment providers deliver webhooks more than once, out of order, and
-- occasionally weeks late. Processing one twice would double a refund or
-- reinstate a cancelled subscription, so every event is recorded here first and
-- the unique constraint is what makes the handler idempotent — not a flag we
-- remember to check.
--
-- Append-only, like the other evidence tables: what a provider told us and when
-- is the record we would produce in a billing dispute.
-- =============================================================================

create table public.billing_events (
  id               bigint generated always as identity primary key,
  provider         text not null default 'stripe',
  provider_event_id text not null,
  event_type       text not null,
  organisation_id  uuid references public.organisations(id) on delete set null,
  occurred_at      timestamptz not null,
  received_at      timestamptz not null default now(),
  payload          jsonb not null,
  handled          boolean not null default false,
  handler_note     text,
  unique (provider, provider_event_id)
);

create index billing_events_org_idx on public.billing_events (organisation_id, occurred_at desc);
create index billing_events_unhandled_idx on public.billing_events (received_at) where not handled;

create trigger billing_events_no_delete
  before delete on public.billing_events
  for each row execute function public.reject_mutation();

-- The one field this table is allowed to change after insert, once, when the
-- handler finishes. Everything else about the event is immutable.
create or replace function public.billing_events_only_handled_changes()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.provider_event_id is distinct from old.provider_event_id
     or new.event_type is distinct from old.event_type
     or new.payload is distinct from old.payload
     or new.occurred_at is distinct from old.occurred_at then
    raise exception 'billing_events records what a provider told us; only the handled flag may change'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger billing_events_immutable_payload
  before update on public.billing_events
  for each row execute function public.billing_events_only_handled_changes();

alter table public.billing_events enable row level security;
alter table public.billing_events force row level security;

-- Customers see their own billing history; nobody sees anyone else's.
create policy billing_events_select_members on public.billing_events
  for select to authenticated
  using (organisation_id is not null and public.is_org_member(organisation_id));

revoke all on public.billing_events from public, anon, authenticated;
grant select on public.billing_events to authenticated;

-- An invoice needs to point at the payment it settles, so a refund can find it.
alter table public.invoices
  add column stripe_payment_intent_id text,
  add column amount_tax_cents integer not null default 0 check (amount_tax_cents >= 0),
  add column app_id uuid references public.apps(id) on delete set null,
  add column plan public.plan_tier;

create index invoices_payment_intent_idx on public.invoices (stripe_payment_intent_id);

-- ===========================================================================
-- 20260822130000_assessment_requests.sql
-- ===========================================================================

-- =============================================================================
-- 0010 — Assessment requests
--
-- The durable queue. PART 5 suggested pg-boss, and this replaces it for one
-- reason that outweighs the convenience: a customer needs to see that their
-- assessment is queued, and a queue in a library's private schema is invisible
-- to row-level security. A request here is a row the customer owns, can watch,
-- and can cancel — and the worker claims it with FOR UPDATE SKIP LOCKED, which
-- is the same mechanism pg-boss uses underneath.
--
-- The entitlement decision is recorded on the row, not just acted on, so a
-- refusal can be explained later and a spent re-test credit is visible.
-- =============================================================================

create type public.request_status as enum ('queued', 'claimed', 'completed', 'failed', 'cancelled', 'refused');

create table public.assessment_requests (
  id                  uuid primary key default gen_random_uuid(),
  app_id              uuid not null references public.apps(id) on delete cascade,
  organisation_id     uuid not null references public.organisations(id) on delete cascade,
  requested_by        uuid references public.users(id) on delete set null,

  depth               public.assessment_depth not null,
  status              public.request_status not null default 'queued',

  -- Why the customer was entitled to this run, recorded at the moment it was
  -- decided rather than recomputed later from a plan that may since have changed.
  plan_at_request     public.plan_tier not null,
  uses_retest_credit  boolean not null default false,
  max_run_cost_usd    numeric(10,4) not null check (max_run_cost_usd > 0),
  refusal_code        text,
  refusal_message     text,

  assessment_id       uuid references public.assessments(id) on delete set null,
  attempts            integer not null default 0 check (attempts >= 0 and attempts <= 5),
  last_error          text,

  created_at          timestamptz not null default now(),
  claimed_at          timestamptz,
  completed_at        timestamptz,

  constraint requests_refusal_needs_reason check (
    status <> 'refused' or (refusal_code is not null and length(btrim(coalesce(refusal_message, ''))) >= 10)
  )
);

create index assessment_requests_queue_idx on public.assessment_requests (created_at)
  where status = 'queued';
create index assessment_requests_app_idx on public.assessment_requests (app_id, created_at desc);

-- One live request per app. Queueing the same assessment twice spends twice.
create unique index assessment_requests_one_live_per_app on public.assessment_requests (app_id)
  where status in ('queued', 'claimed');

alter table public.assessment_requests enable row level security;
alter table public.assessment_requests force row level security;

create policy assessment_requests_select_members on public.assessment_requests
  for select to authenticated
  using (public.is_org_member(organisation_id) or public.is_reviewer());

create policy assessment_requests_insert_members on public.assessment_requests
  for insert to authenticated
  with check (public.is_org_member(organisation_id) and requested_by = auth.uid());

-- A customer may cancel their own queued request; nothing else about it is theirs to change.
create policy assessment_requests_cancel_members on public.assessment_requests
  for update to authenticated
  using (public.is_org_member(organisation_id) and status = 'queued')
  with check (public.is_org_member(organisation_id) and status = 'cancelled');

revoke all on public.assessment_requests from public, anon, authenticated;
grant select, insert, update on public.assessment_requests to authenticated;

-- ===========================================================================
-- 20260822140000_monitoring.sql
-- ===========================================================================

-- =============================================================================
-- 0011 — Continuous monitoring
--
-- Three things a certified application needs between assessments: someone to
-- notice it changed, someone to notice it stopped answering, and a way to tell
-- the owner. This migration is those three.
--
-- `drift_reports` is append-only. A drift report is what justifies suspending a
-- badge, and a justification that can be edited afterwards is not one.
-- =============================================================================

create type public.alert_kind as enum (
  'assessment_completed',
  'drift_detected',
  'material_regression',
  'badge_suspended',
  'badge_expiring',
  'application_unreachable',
  'application_recovered',
  'subscription_problem'
);

create type public.alert_severity as enum ('info', 'warning', 'critical');

-- -----------------------------------------------------------------------------
-- Drift: what changed since last time
-- -----------------------------------------------------------------------------

create table public.drift_reports (
  id                       uuid primary key default gen_random_uuid(),
  app_id                   uuid not null references public.apps(id) on delete cascade,
  organisation_id          uuid not null references public.organisations(id) on delete cascade,
  assessment_id            uuid not null references public.assessments(id) on delete cascade,
  previous_assessment_id   uuid not null references public.assessments(id) on delete restrict,

  score_before             numeric(5,2) not null,
  score_after              numeric(5,2) not null,
  score_delta              numeric(6,2) not null,
  dimension_deltas         jsonb not null default '[]'::jsonb,

  findings_new             integer not null default 0 check (findings_new >= 0),
  findings_resolved        integer not null default 0 check (findings_resolved >= 0),
  findings_persisting      integer not null default 0 check (findings_persisting >= 0),
  new_finding_titles       text[] not null default '{}',
  resolved_finding_titles  text[] not null default '{}',

  -- The decision, and the reasons for it, frozen at the moment it was made.
  material_regression      boolean not null default false,
  regression_reasons       text[] not null default '{}',
  certification_lost       boolean not null default false,

  created_at               timestamptz not null default now(),

  unique (assessment_id),
  constraint drift_regression_needs_reason check (
    not material_regression or cardinality(regression_reasons) > 0
  ),
  constraint drift_compares_two_assessments check (assessment_id <> previous_assessment_id)
);

create index drift_reports_app_idx on public.drift_reports (app_id, created_at desc);

create trigger drift_reports_no_update
  before update or delete on public.drift_reports
  for each row execute function public.reject_mutation();

-- -----------------------------------------------------------------------------
-- Alerts: telling the owner
-- -----------------------------------------------------------------------------

create table public.alerts (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  app_id          uuid references public.apps(id) on delete cascade,
  kind            public.alert_kind not null,
  severity        public.alert_severity not null default 'info',
  title           text not null check (length(btrim(title)) between 5 and 200),
  body            text not null check (length(btrim(body)) >= 20),
  /** What it is about, so the console can link straight to it. */
  assessment_id   uuid references public.assessments(id) on delete set null,
  drift_report_id uuid references public.drift_reports(id) on delete set null,
  badge_id        uuid references public.badges(id) on delete set null,
  -- Set once the alert has been delivered outside the console. Null means it has
  -- only ever been visible to someone who happened to log in.
  delivered_at    timestamptz,
  delivery_channel text,
  read_at         timestamptz,
  created_at      timestamptz not null default now(),
  -- One alert per app per kind per day: a monitoring system that sends the same
  -- warning every half hour trains people to ignore it.
  dedupe_key      text not null
);

create unique index alerts_dedupe_idx on public.alerts (organisation_id, dedupe_key);
create index alerts_unread_idx on public.alerts (organisation_id, created_at desc) where read_at is null;
create index alerts_undelivered_idx on public.alerts (created_at) where delivered_at is null;

-- -----------------------------------------------------------------------------
-- Liveness: noticing an application that stopped answering
-- -----------------------------------------------------------------------------

alter table public.apps
  add column monitoring_enabled boolean not null default false,
  add column last_seen_at timestamptz,
  add column last_liveness_status integer,
  add column consecutive_liveness_failures integer not null default 0
    check (consecutive_liveness_failures >= 0),
  add column last_reassessed_at timestamptz;

comment on column public.apps.consecutive_liveness_failures is
  'A single failed check is a blip. Suspension needs a run of them, because taking someone''s badge down for a transient timeout is worse than a few minutes of delay.';

-- -----------------------------------------------------------------------------
-- Row-level security
-- -----------------------------------------------------------------------------

alter table public.drift_reports enable row level security;
alter table public.alerts        enable row level security;
alter table public.drift_reports force row level security;
alter table public.alerts        force row level security;

create policy drift_reports_select_members on public.drift_reports
  for select to authenticated
  using (public.is_org_member(organisation_id) or public.is_reviewer());

create policy alerts_select_members on public.alerts
  for select to authenticated
  using (public.is_org_member(organisation_id) or public.is_reviewer());

-- A customer may mark their own alert read. Nothing else about it is theirs.
create policy alerts_mark_read_members on public.alerts
  for update to authenticated
  using (public.is_org_member(organisation_id))
  with check (public.is_org_member(organisation_id));

revoke all on public.drift_reports, public.alerts from public, anon, authenticated;
grant select on public.drift_reports to authenticated;
grant select on public.alerts to authenticated;
grant update (read_at) on public.alerts to authenticated;

-- The score history a customer sees on their application. A view rather than a
-- table: it is derived, and a derived table is a table that goes stale.
create view public.assessment_history
with (security_invoker = true) as
select
  a.app_id,
  a.organisation_id,
  a.id as assessment_id,
  a.overall_score,
  a.rubric_version,
  a.certification_eligible,
  a.status,
  coalesce(a.completed_at, a.created_at) as assessed_at,
  d.score_delta,
  d.material_regression,
  d.findings_new,
  d.findings_resolved
from public.assessments a
left join public.drift_reports d on d.assessment_id = a.id
where a.status in ('approved', 'published')
order by coalesce(a.completed_at, a.created_at) desc;

grant select on public.assessment_history to authenticated;

-- -----------------------------------------------------------------------------
-- Suspension gets its own reason column
--
-- Until now a suspension borrowed `revocation_reason`, which conflated two
-- different events: revocation is permanent and is a judgement about the owner,
-- suspension is reversible and is usually a judgement about the application on a
-- particular day. A customer reading "revoked because your site was down for six
-- hours" is being told something untrue about themselves.
-- -----------------------------------------------------------------------------

alter table public.badges add column suspension_reason text;

update public.badges
   set suspension_reason = revocation_reason
 where status = 'suspended' and suspension_reason is null;

update public.badges
   set suspension_reason = 'Suspended before the reason was recorded separately.'
 where status = 'suspended' and length(btrim(coalesce(suspension_reason, ''))) < 10;

alter table public.badges add constraint badges_suspended_needs_reason check (
  status <> 'suspended' or length(btrim(coalesce(suspension_reason, ''))) >= 10
);

comment on column public.badges.suspension_reason is
  'Why this badge is not currently reading as verified. Quoted verbatim to the owner and cleared on reinstatement.';

-- ===========================================================================
-- 20260822150000_workspaces.sql
-- ===========================================================================

-- =============================================================================
-- 0012 — Agency and organisation surfaces
--
-- The brief's answer to "three segments, one product" is one shared core behind
-- three account types. This migration is the part of that which is not the
-- assessment: who is in a workspace, what they may do, what bar the workspace
-- holds its own applications to, and how it gets its records out.
--
-- One rule shapes all of it. A policy profile is an organisation's own bar,
-- applied *over* a score that was computed without knowing the profile exists.
-- It can fail an application the rubric passed. It can never raise a score, and
-- there is no column here through which it could.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Seats: inviting someone into a workspace
-- -----------------------------------------------------------------------------

create table public.invitations (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  email           citext not null check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  role            public.org_role not null default 'member',

  -- Only the hash is stored. An invitation link is a credential, and a
  -- credential we can read back out of our own database is one that leaks with it.
  token_sha256    text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),

  invited_by      uuid references public.users(id) on delete set null,
  expires_at      timestamptz not null,
  accepted_at     timestamptz,
  accepted_by     uuid references public.users(id) on delete set null,
  revoked_at      timestamptz,
  revoked_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),

  constraint invitations_expire_within_reason check (expires_at <= created_at + interval '30 days'),
  constraint invitations_accepted_has_user check (accepted_at is null or accepted_by is not null),
  constraint invitations_not_both check (accepted_at is null or revoked_at is null)
);

create index invitations_org_idx on public.invitations (organisation_id, created_at desc);
-- One live invitation per address per workspace. Two links to the same inbox is
-- two chances for the wrong one to be forwarded.
create unique index invitations_one_live_per_email
  on public.invitations (organisation_id, email)
  where accepted_at is null and revoked_at is null;

-- An owner is never invited: the seat that can delete everything is granted
-- deliberately, by an existing owner, to an account that already exists.
alter table public.invitations add constraint invitations_never_grant_ownership
  check (role <> 'owner');

-- -----------------------------------------------------------------------------
-- Seat limits
-- -----------------------------------------------------------------------------

/**
 * Seats in force for a workspace: what the active subscription says, or one.
 *
 * A workspace with no subscription is one person's workspace. Returning 1 rather
 * than null means every caller gets a number and nobody has to remember the
 * null case.
 */
create or replace function public.seats_for_organisation(org uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select s.seats from public.subscriptions s
      where s.organisation_id = org and s.status in ('active', 'trialing')
      order by s.seats desc
      limit 1),
    1
  );
$$;

/** Members plus outstanding invitations — an invitation not yet accepted still holds a seat. */
create or replace function public.seats_used(org uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (select count(*) from public.memberships m where m.organisation_id = org)::int
       + (select count(*) from public.invitations i
           where i.organisation_id = org and i.accepted_at is null and i.revoked_at is null)::int;
$$;

/**
 * Refuses a membership or invitation that would exceed the paid seat count.
 *
 * In the database rather than in the action, because "we forgot to check on the
 * SSO path" is exactly how seat limits stop meaning anything.
 */
create or replace function public.assert_seat_available()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := new.organisation_id;
  limit_seats integer := public.seats_for_organisation(org);
  used integer := public.seats_used(org);
begin
  if used > limit_seats then
    raise exception 'This workspace has % seat(s) and % in use, counting outstanding invitations. Add seats before inviting anyone else.', limit_seats, used
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create constraint trigger memberships_seat_limit
  after insert on public.memberships
  deferrable initially immediate
  for each row execute function public.assert_seat_available();

create constraint trigger invitations_seat_limit
  after insert on public.invitations
  deferrable initially immediate
  for each row execute function public.assert_seat_available();

-- -----------------------------------------------------------------------------
-- Policy profiles: an organisation's own bar
-- -----------------------------------------------------------------------------

create table public.policy_profiles (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations(id) on delete cascade,
  name                   text not null check (length(btrim(name)) between 2 and 80),
  description            text,

  -- The bar. Every one of these is a *floor the organisation requires*, applied
  -- to a score that was produced without knowing this row exists.
  min_overall_score      numeric(5,2) check (min_overall_score between 0 and 100),
  dimension_floors       jsonb not null default '{}'::jsonb,
  max_open_severity      public.finding_severity,
  require_certification  boolean not null default false,
  require_store_readiness boolean not null default false,

  is_default             boolean not null default false,
  created_by             uuid references public.users(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  unique (organisation_id, name)
);

create unique index policy_profiles_one_default
  on public.policy_profiles (organisation_id) where is_default;

create trigger policy_profiles_set_updated_at
  before update on public.policy_profiles
  for each row execute function public.set_updated_at();

alter table public.apps
  add column policy_profile_id uuid references public.policy_profiles(id) on delete set null;

comment on column public.apps.policy_profile_id is
  'The organisation''s own bar for this application. Evaluated over the score; it cannot change one.';

-- -----------------------------------------------------------------------------
-- White-label: an agency's own cover page
-- -----------------------------------------------------------------------------

create table public.workspace_branding (
  organisation_id uuid primary key references public.organisations(id) on delete cascade,
  display_name    text not null check (length(btrim(display_name)) between 2 and 80),
  -- A data: URI or a storage path. Small, because it is embedded in a PDF that
  -- has to render without a network.
  logo_data_uri   text check (logo_data_uri is null or logo_data_uri ~ '^data:image/(png|jpeg|svg\+xml);base64,'),
  accent_colour   text check (accent_colour is null or accent_colour ~ '^#[0-9a-fA-F]{6}$'),
  contact_line    text check (contact_line is null or length(btrim(contact_line)) between 3 and 160),
  footer_note     text check (footer_note is null or length(btrim(footer_note)) <= 300),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger workspace_branding_set_updated_at
  before update on public.workspace_branding
  for each row execute function public.set_updated_at();

comment on table public.workspace_branding is
  'An agency''s own cover block on a report it hands to a client. It never touches the VibefyCode marks, and the report always states who performed the assessment.';

-- -----------------------------------------------------------------------------
-- Single sign-on
-- -----------------------------------------------------------------------------

create table public.sso_connections (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations(id) on delete cascade,
  -- The email domain that routes to this connection. Unique across the platform:
  -- two organisations claiming one domain is an account-takeover primitive.
  email_domain          citext not null unique check (email_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  provider              text not null default 'saml' check (provider in ('saml', 'oidc')),
  -- The identity provider registered with the auth service. We hold the id, never
  -- the certificate or the client secret; those live in the auth service.
  auth_provider_id      text,
  -- Verified the same way an application's ownership is: a DNS TXT record.
  domain_verified_at    timestamptz,
  domain_challenge      text not null,
  -- When true, password sign-in is refused for addresses at this domain.
  enforced              boolean not null default false,
  default_role          public.org_role not null default 'member',
  created_by            uuid references public.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint sso_enforced_needs_verified_domain check (not enforced or domain_verified_at is not null),
  constraint sso_default_role_is_not_owner check (default_role <> 'owner')
);

create trigger sso_connections_set_updated_at
  before update on public.sso_connections
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Audit export
-- -----------------------------------------------------------------------------

create table public.audit_exports (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  requested_by    uuid references public.users(id) on delete set null,
  kind            text not null check (kind in ('assessments', 'findings', 'authorisations', 'consents', 'badge_events', 'audit_log')),
  format          text not null default 'csv' check (format in ('csv', 'json')),
  row_count       integer not null check (row_count >= 0),
  -- The hash of exactly what was handed over, so a file produced in a dispute can
  -- be checked against what we say we produced.
  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  period_start    timestamptz,
  period_end      timestamptz,
  created_at      timestamptz not null default now()
);

create index audit_exports_org_idx on public.audit_exports (organisation_id, created_at desc);

-- An export is a record of a disclosure. Records of disclosures do not get edited.
create trigger audit_exports_no_update
  before update or delete on public.audit_exports
  for each row execute function public.reject_mutation();

-- -----------------------------------------------------------------------------
-- Row-level security
-- -----------------------------------------------------------------------------

alter table public.invitations        enable row level security;
alter table public.policy_profiles    enable row level security;
alter table public.workspace_branding enable row level security;
alter table public.sso_connections    enable row level security;
alter table public.audit_exports      enable row level security;

alter table public.invitations        force row level security;
alter table public.policy_profiles    force row level security;
alter table public.workspace_branding force row level security;
alter table public.sso_connections    force row level security;
alter table public.audit_exports      force row level security;

-- Invitations: managed by owners and admins. A member cannot see who else was
-- invited, and cannot see the token hash of anything.
create policy invitations_manage_admins on public.invitations
  for all to authenticated
  using (public.has_org_role(organisation_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organisation_id, array['owner', 'admin']::public.org_role[]));

-- Policy profiles: every member reads them — an engineer needs to know the bar
-- their application is being held to — but only admins change them.
create policy policy_profiles_read_members on public.policy_profiles
  for select to authenticated
  using (public.is_org_member(organisation_id));

create policy policy_profiles_write_admins on public.policy_profiles
  for all to authenticated
  using (public.has_org_role(organisation_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organisation_id, array['owner', 'admin']::public.org_role[]));

create policy branding_read_members on public.workspace_branding
  for select to authenticated
  using (public.is_org_member(organisation_id));

create policy branding_write_admins on public.workspace_branding
  for all to authenticated
  using (public.has_org_role(organisation_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organisation_id, array['owner', 'admin']::public.org_role[]));

create policy sso_read_admins on public.sso_connections
  for select to authenticated
  using (public.has_org_role(organisation_id, array['owner', 'admin']::public.org_role[]));

create policy sso_write_owners on public.sso_connections
  for all to authenticated
  using (public.has_org_role(organisation_id, array['owner']::public.org_role[]))
  with check (public.has_org_role(organisation_id, array['owner']::public.org_role[]));

create policy audit_exports_read_admins on public.audit_exports
  for select to authenticated
  using (public.has_org_role(organisation_id, array['owner', 'admin']::public.org_role[]) or public.is_reviewer());

create policy audit_exports_insert_admins on public.audit_exports
  for insert to authenticated
  with check (public.has_org_role(organisation_id, array['owner', 'admin']::public.org_role[]));

revoke all on public.invitations, public.policy_profiles, public.workspace_branding,
              public.sso_connections, public.audit_exports
  from public, anon, authenticated;

grant select, insert, update, delete on public.invitations to authenticated;
grant select, insert, update, delete on public.policy_profiles to authenticated;
grant select, insert, update, delete on public.workspace_branding to authenticated;
grant select, insert, update, delete on public.sso_connections to authenticated;
grant select, insert on public.audit_exports to authenticated;

-- -----------------------------------------------------------------------------
-- Membership management
--
-- Until now memberships were created only by the sign-up trigger. A workspace
-- with seats needs owners and admins to add and remove people — and needs the
-- database, not the console, to be the thing that stops someone promoting
-- themselves.
-- -----------------------------------------------------------------------------

create policy memberships_manage_admins on public.memberships
  for all to authenticated
  using (public.has_org_role(organisation_id, array['owner', 'admin']::public.org_role[]))
  with check (
    public.has_org_role(organisation_id, array['owner', 'admin']::public.org_role[])
    -- Only an owner may create another owner. An admin who could would be an
    -- owner with an extra step.
    and (role <> 'owner' or public.has_org_role(organisation_id, array['owner']::public.org_role[]))
  );

-- -----------------------------------------------------------------------------
-- The portfolio view
--
-- One row per application, with everything a dashboard shows. A view, because it
-- is derived — and `security_invoker` so it is the caller's row-level security
-- that decides which rows come back, not the view owner's.
-- -----------------------------------------------------------------------------

create view public.portfolio
with (security_invoker = true) as
select
  app.id                       as app_id,
  app.organisation_id,
  app.name,
  app.primary_url,
  app.app_type,
  app.screening_status,
  app.monitoring_enabled,
  app.last_seen_at,
  app.consecutive_liveness_failures,
  app.policy_profile_id,
  latest.assessment_id,
  latest.overall_score,
  latest.certification_eligible,
  latest.dimension_scores,
  latest.assessed_at,
  latest.rubric_version,
  badge.id                     as badge_id,
  badge.status                 as badge_status,
  badge.expires_at             as badge_expires_at,
  auth_state.status            as authorisation_status,
  coalesce(open_alerts.n, 0)   as unread_alerts
from public.apps app
left join lateral (
  select a.id as assessment_id, a.overall_score, a.certification_eligible,
         a.dimension_scores, a.rubric_version,
         coalesce(a.completed_at, a.created_at) as assessed_at
    from public.assessments a
   where a.app_id = app.id and a.status in ('approved', 'published')
   order by coalesce(a.completed_at, a.created_at) desc
   limit 1
) latest on true
left join lateral (
  select b.id, b.status, b.expires_at from public.badges b
   where b.app_id = app.id order by b.issued_at desc limit 1
) badge on true
left join lateral (
  select au.status from public.authorisations au
   where au.app_id = app.id order by au.created_at desc limit 1
) auth_state on true
left join lateral (
  select count(*)::int as n from public.alerts al
   where al.app_id = app.id and al.read_at is null
) open_alerts on true;

grant select on public.portfolio to authenticated;

-- -----------------------------------------------------------------------------
-- Sign-in routing
--
-- The sign-in page has to know, before it accepts a password, whether an address
-- belongs to a domain that requires single sign-on. It cannot read
-- `sso_connections` — that table is administrators-only — so this function
-- answers exactly one question and nothing else: for this address, is password
-- sign-in refused, and which protocol should it use instead.
--
-- Only enforced, domain-verified connections are visible through it, matched on
-- the exact domain. It is the same domain-discovery step every enterprise
-- sign-in performs; it deliberately does not reveal which organisation owns the
-- domain, how many people are in it, or that any unenforced connection exists.
-- -----------------------------------------------------------------------------

create or replace function public.sso_routing(candidate_email text)
returns table (email_domain citext, provider text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.email_domain, c.provider
    from public.sso_connections c
   where c.enforced
     and c.domain_verified_at is not null
     and c.email_domain = lower(split_part(candidate_email, '@', 2))
   limit 1;
$$;

revoke all on function public.sso_routing(text) from public;
grant execute on function public.sso_routing(text) to anon, authenticated;

-- ===========================================================================
-- 20260822160000_mobile.sql
-- ===========================================================================

-- =============================================================================
-- 0013 — The mobile app
--
-- Two things the phone needs that the browser does not: somewhere to register
-- for push notifications, and a delivery record so the same alert is not pushed
-- twice. Everything else it uses already exists — it reads the same tables,
-- through the same anon key, under the same row-level security as the console.
-- There is no mobile API, because a second API surface is a second place for an
-- authorisation rule to be forgotten.
-- =============================================================================

create table public.device_tokens (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  -- Expo's push token. It addresses a device, not a person, and it is the only
  -- thing about a customer's phone we hold.
  token           text not null unique check (token ~ '^(ExponentPushToken\[[A-Za-z0-9_-]+\]|ExpoPushToken\[[A-Za-z0-9_-]+\])$'),
  platform        text not null check (platform in ('ios', 'android')),
  app_version     text,
  -- Cleared when Expo tells us the token is dead. A push service that keeps
  -- sending to uninstalled apps gets rate-limited, and deserves to be.
  disabled_at     timestamptz,
  disabled_reason text,
  last_seen_at    timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index device_tokens_user_idx on public.device_tokens (user_id) where disabled_at is null;

comment on table public.device_tokens is
  'Expo push tokens. Deleted with the account, and never joined to anything but the owner''s own alerts.';

-- One delivery attempt per alert per device. The unique index is the whole
-- anti-duplicate design: a sweep that runs twice cannot push twice.
create table public.alert_deliveries (
  id             uuid primary key default gen_random_uuid(),
  alert_id       uuid not null references public.alerts(id) on delete cascade,
  device_token_id uuid not null references public.device_tokens(id) on delete cascade,
  status         text not null check (status in ('sent', 'failed')),
  detail         text,
  attempted_at   timestamptz not null default now(),
  unique (alert_id, device_token_id)
);

create trigger alert_deliveries_no_update
  before update or delete on public.alert_deliveries
  for each row execute function public.reject_mutation();

alter table public.device_tokens     enable row level security;
alter table public.alert_deliveries  enable row level security;
alter table public.device_tokens     force row level security;
alter table public.alert_deliveries  force row level security;

-- A device token belongs to exactly one person, and only that person may see or
-- change it. Not their workspace, not their colleagues: them.
create policy device_tokens_own on public.device_tokens
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Delivery records are ours. A customer sees the alert; whether a push reached a
-- particular handset is an operational fact about our sender, not about them.
create policy alert_deliveries_platform on public.alert_deliveries
  for select to authenticated
  using (public.is_platform_admin());

revoke all on public.device_tokens, public.alert_deliveries from public, anon, authenticated;
grant select, insert, update, delete on public.device_tokens to authenticated;
grant select on public.alert_deliveries to authenticated;

-- The authorisation gate has to be callable from the phone, because the mobile
-- app refuses a re-test before it queues one rather than after.
grant execute on function public.app_is_authorised_for_testing(uuid) to authenticated;

-- ===========================================================================
-- 20260822170000_directory.sql
-- ===========================================================================

-- =============================================================================
-- 0014 — The public directory
--
-- Certified applications only, and only while they are certified. Two design
-- decisions are written into this schema rather than into a page:
--
--   1. A listing is derived, not stored. There is no `is_listed` column that can
--      go stale — the view joins the live badge, so a suspension removes a
--      listing in the same instant it changes the verification page. The only
--      stored fact is the owner's own choice.
--
--   2. There is no column here through which money could affect placement. Not
--      a rank, not a weight, not a boost. The ordering the directory uses is
--      computed in `@vibefycode/directory` from a type that structurally cannot
--      carry a commercial field, and the marketing-client flag is carried only
--      so that it can be *disclosed*.
-- =============================================================================

create type public.listing_state as enum ('listed', 'opted_out');

create table public.directory_listings (
  app_id          uuid primary key references public.apps(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,

  state           public.listing_state not null default 'listed',

  -- Owner-written, and shown as theirs. Short, because a directory of
  -- paragraphs is a directory nobody reads.
  tagline         text check (tagline is null or length(btrim(tagline)) between 10 and 160),
  category        text check (category is null or length(btrim(category)) between 2 and 40),

  opted_out_at    timestamptz,
  opted_out_by    uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint listing_opt_out_is_stamped check (
    (state = 'opted_out') = (opted_out_at is not null)
  )
);

create trigger directory_listings_set_updated_at
  before update on public.directory_listings
  for each row execute function public.set_updated_at();

-- Every change of mind is kept. "We never listed you" and "you opted out in
-- March" are different claims, and only one of them can be true.
create table public.listing_events (
  id              uuid primary key default gen_random_uuid(),
  app_id          uuid not null references public.apps(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  state           public.listing_state not null,
  actor_id        uuid references public.users(id) on delete set null,
  reason          text,
  occurred_at     timestamptz not null default now()
);

create index listing_events_app_idx on public.listing_events (app_id, occurred_at desc);

create trigger listing_events_no_update
  before update or delete on public.listing_events
  for each row execute function public.reject_mutation();

create or replace function public.record_listing_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' or new.state is distinct from old.state then
    insert into public.listing_events (app_id, organisation_id, state, actor_id)
    values (new.app_id, new.organisation_id, new.state, auth.uid());
  end if;
  return new;
end;
$$;

create trigger directory_listings_record_event
  after insert or update on public.directory_listings
  for each row execute function public.record_listing_event();

-- -----------------------------------------------------------------------------
-- The directory itself
--
-- `security_invoker = false`: this view is deliberately readable by `anon`,
-- which is the whole point of a public directory, and it exposes exactly the
-- columns already published on each application's verification page — nothing
-- more. The underlying tables stay closed.
-- -----------------------------------------------------------------------------

create view public.directory
with (security_invoker = false) as
select
  b.slug,
  app.name,
  b.certified_origin,
  b.score,
  b.rubric_version,
  b.assessed_at,
  b.expires_at,
  a.dimension_scores,
  listing.tagline,
  listing.category,
  -- Disclosed on every surface where a rating appears, whether or not anybody
  -- asked, and not something that can be paid to remove.
  o.is_marketing_client,
  o.marketing_client_since
from public.directory_listings listing
join public.apps app on app.id = listing.app_id
join public.organisations o on o.id = listing.organisation_id
join public.badges b on b.app_id = listing.app_id
join public.assessments a on a.id = b.assessment_id
where listing.state = 'listed'
  -- The live badge, not a stored flag. A suspension removes the listing at the
  -- same moment it changes the verification page.
  and public.badge_effective_status(b) = 'active';

alter table public.directory_listings enable row level security;
alter table public.listing_events      enable row level security;
alter table public.directory_listings force row level security;
alter table public.listing_events      force row level security;

create policy directory_listings_members on public.directory_listings
  for all to authenticated
  using (public.is_org_member(organisation_id) or public.is_reviewer())
  with check (public.is_org_member(organisation_id));

create policy listing_events_members on public.listing_events
  for select to authenticated
  using (public.is_org_member(organisation_id) or public.is_reviewer());

revoke all on public.directory_listings, public.listing_events from public, anon, authenticated;
grant select, insert, update on public.directory_listings to authenticated;
grant select on public.listing_events to authenticated;

revoke all on public.directory from public, anon, authenticated;
grant select on public.directory to anon, authenticated;

comment on view public.directory is
  'The public directory. Certified applications only, live badge only, owner opt-out honoured immediately. Contains nothing that is not already on the verification page each badge links to.';

-- ===========================================================================
-- 20260822180000_governance_operations.sql
-- ===========================================================================

-- =============================================================================
-- 0015 — Operating the governance we already promised
--
-- Four things the brief specifies that the schema described but nothing yet
-- carried out:
--
--   PART 8.2 · data-subject rights with working in-product flows, not an email
--             address. The `data_requests` table existed; nothing filled it in,
--             and nothing enforced its deadline.
--   PART 8.2 · a retention schedule with automated deletion jobs. Every evidence
--             artefact has carried a `retention_until` since M1 and nothing has
--             ever acted on one.
--   PART 9   · a global daily spend cap with automatic pause and alert. The
--             per-run ceiling existed; a runaway loop across many runs did not
--             hit anything.
--   PART 3   · an appeals route with a deadline. Published in the legal text,
--             linked from the console, and until now not answerable in product.
--
-- A promise with no mechanism behind it is the thing this whole product exists
-- to find in other people's software.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Spend: the stop that a runaway loop actually hits
-- -----------------------------------------------------------------------------

create table public.spend_pauses (
  id            uuid primary key default gen_random_uuid(),
  reason        text not null check (length(btrim(reason)) >= 10),
  -- What the numbers were at the moment the decision was taken, so an argument
  -- afterwards is about the threshold rather than about what happened.
  observed_usd  numeric(12,4) not null check (observed_usd >= 0),
  ceiling_usd   numeric(12,4) not null check (ceiling_usd > 0),
  paused_at     timestamptz not null default now(),
  lifted_at     timestamptz,
  lifted_by     uuid references public.users(id) on delete set null,
  lift_reason   text,

  constraint spend_lift_needs_reason check (
    lifted_at is null or length(btrim(coalesce(lift_reason, ''))) >= 10
  )
);

create unique index spend_pauses_one_live on public.spend_pauses ((true)) where lifted_at is null;
create index spend_pauses_recent_idx on public.spend_pauses (paused_at desc);

comment on table public.spend_pauses is
  'A global stop on new assessment work. One can be live at a time; lifting one requires a written reason and is kept.';

/** True when work must not start. Read by the worker before it claims anything. */
create or replace function public.spending_is_paused()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.spend_pauses where lifted_at is null);
$$;

/** Total recorded cost since a moment. The cap is applied to this, not to an estimate. */
create or replace function public.spend_since(from_time timestamptz)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(total_cost_usd), 0)::numeric
    from public.cost_records where recorded_at >= from_time;
$$;

/** Free-tier spend since a moment, which has its own budget because it has no revenue. */
create or replace function public.free_tier_spend_since(from_time timestamptz)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(c.total_cost_usd), 0)::numeric
    from public.cost_records c
    join public.assessments a on a.id = c.assessment_id
   where c.recorded_at >= from_time
     and not exists (
       select 1 from public.subscriptions s
        where s.organisation_id = a.organisation_id
          and s.status in ('active', 'trialing')
          and s.plan <> 'free'
     )
     and not exists (
       select 1 from public.invoices i
        where i.app_id = a.app_id and i.status = 'paid'
          and i.amount_paid_cents > i.amount_refunded_cents
     );
$$;

-- -----------------------------------------------------------------------------
-- Retention: the deletion that the deadline was always for
-- -----------------------------------------------------------------------------

create table public.retention_deletions (
  id             uuid primary key default gen_random_uuid(),
  data_class     text not null check (data_class in ('evidence', 'assessment_run_log', 'alert', 'cost_record')),
  entity_id      uuid not null,
  organisation_id uuid references public.organisations(id) on delete set null,
  -- The hash of what was deleted, kept after the thing itself is gone. It proves
  -- an artefact existed and was removed on schedule without keeping the artefact.
  sha256         text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  retention_until timestamptz not null,
  deleted_at     timestamptz not null default now()
);

create index retention_deletions_recent_idx on public.retention_deletions (deleted_at desc);

create trigger retention_deletions_no_update
  before update or delete on public.retention_deletions
  for each row execute function public.reject_mutation();

comment on table public.retention_deletions is
  'What was deleted on schedule, and when. Keeps the hash rather than the artefact: proof the retention policy ran, with nothing left that the policy existed to remove.';

-- -----------------------------------------------------------------------------
-- Data-subject requests and appeals: making the deadline real
-- -----------------------------------------------------------------------------

-- Both tables already carry `due_at`. Nothing was setting it, so a published
-- deadline was a published deadline with no clock behind it.
create or replace function public.set_request_deadline()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.due_at is null then
    new.due_at := coalesce(new.created_at, now()) + interval '30 days';
  end if;
  return new;
end;
$$;

create trigger data_requests_set_deadline
  before insert on public.data_requests
  for each row execute function public.set_request_deadline();

create or replace function public.set_appeal_deadline()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.due_at is null then
    new.due_at := coalesce(new.created_at, now()) + interval '14 days';
  end if;
  return new;
end;
$$;

create trigger appeals_set_deadline
  before insert on public.appeals
  for each row execute function public.set_appeal_deadline();

-- -----------------------------------------------------------------------------
-- Row-level security
-- -----------------------------------------------------------------------------

alter table public.spend_pauses        enable row level security;
alter table public.retention_deletions enable row level security;
alter table public.spend_pauses        force row level security;
alter table public.retention_deletions force row level security;

-- A spend pause is ours. It is not about any one customer, and it names our
-- numbers, so only platform staff see it.
create policy spend_pauses_platform on public.spend_pauses
  for select to authenticated
  using (public.is_platform_admin());

-- A customer may see that their own evidence was deleted on schedule. That is
-- the point of keeping the record.
create policy retention_deletions_members on public.retention_deletions
  for select to authenticated
  using (organisation_id is not null and public.is_org_member(organisation_id))
  ;

create policy retention_deletions_platform on public.retention_deletions
  for select to authenticated
  using (public.is_platform_admin());

revoke all on public.spend_pauses, public.retention_deletions from public, anon, authenticated;
grant select on public.spend_pauses to authenticated;
grant select on public.retention_deletions to authenticated;

grant execute on function public.spending_is_paused() to authenticated;

-- ===========================================================================
-- 20260822190000_alert_email.sql
-- ===========================================================================

-- =============================================================================
-- 0016 — Alerts by email
--
-- M4 built the alerts and M6 delivered them to phones. Everyone without the app
-- installed still had to log in to find out their badge had been suspended,
-- which is not notice in any sense a customer would accept.
--
-- Two changes of shape here, both because there is now more than one channel:
--
--   · `alert_deliveries` becomes a ledger of (alert, channel, target) rather
--     than a ledger of pushes. One table answers "did we tell them, how, and
--     when" for every channel there will ever be.
--   · A hard bounce suppresses an address, the same way a dead push token is
--     disabled. A sender that keeps mailing an address that does not exist
--     destroys its own domain reputation, and then none of the notices arrive.
-- =============================================================================

create type public.alert_channel as enum ('push', 'email');

-- Restated rather than altered: the table is append-only with a trigger that
-- refuses UPDATE and DELETE, so reshaping it in place would mean switching that
-- rule off in order to change the thing the rule protects.
drop table if exists public.alert_deliveries;

create table public.alert_deliveries (
  id           uuid primary key default gen_random_uuid(),
  alert_id     uuid not null references public.alerts(id) on delete cascade,
  channel      public.alert_channel not null,
  -- The device token for a push, the user for an email. Not a foreign key,
  -- because it points at two different tables depending on the channel, and a
  -- delivery record has to survive the target being deleted — that is rather
  -- the point of keeping it.
  target_id    uuid not null,
  status       text not null check (status in ('sent', 'failed')),
  detail       text,
  attempted_at timestamptz not null default now(),

  -- One attempt per alert per channel per target. A sweep that runs twice
  -- cannot deliver twice.
  unique (alert_id, channel, target_id)
);

create index alert_deliveries_alert_idx on public.alert_deliveries (alert_id);

create trigger alert_deliveries_no_update
  before update or delete on public.alert_deliveries
  for each row execute function public.reject_mutation();

-- -----------------------------------------------------------------------------
-- What a person has asked to receive
-- -----------------------------------------------------------------------------

alter table public.users
  add column alert_email_level text not null default 'all'
    check (alert_email_level in ('all', 'critical_only'));

comment on column public.users.alert_email_level is
  'There is deliberately no "none". A badge suspension is a notice we are obliged to give under the Badge Licence, and an notice a customer can switch off is not one. "critical_only" silences everything else.';

grant update (alert_email_level) on public.users to authenticated;

-- -----------------------------------------------------------------------------
-- Addresses we must stop writing to
-- -----------------------------------------------------------------------------

create table public.email_suppressions (
  email        citext primary key,
  reason       text not null check (length(btrim(reason)) >= 5),
  -- 'bounce' is permanent and ours to respect; 'complaint' is someone marking
  -- us as spam, which we respect whether or not we agree with it.
  kind         text not null check (kind in ('hard_bounce', 'complaint', 'manual')),
  suppressed_at timestamptz not null default now()
);

comment on table public.email_suppressions is
  'Addresses that must not be written to again. Mirrors device_tokens.disabled_at: a sender that keeps mailing a dead address ruins its own deliverability, and then none of the notices arrive.';

-- -----------------------------------------------------------------------------
-- Row-level security
-- -----------------------------------------------------------------------------

alter table public.alert_deliveries   enable row level security;
alter table public.email_suppressions enable row level security;
alter table public.alert_deliveries   force row level security;
alter table public.email_suppressions force row level security;

-- Whether a particular handset or inbox accepted a message is an operational
-- fact about our sender, not about the customer. They see the alert itself.
create policy alert_deliveries_platform on public.alert_deliveries
  for select to authenticated
  using (public.is_platform_admin());

create policy email_suppressions_platform on public.email_suppressions
  for select to authenticated
  using (public.is_platform_admin());

revoke all on public.alert_deliveries, public.email_suppressions from public, anon, authenticated;
grant select on public.alert_deliveries to authenticated;
grant select on public.email_suppressions to authenticated;

-- ===========================================================================
-- 20260823100000_portfolio_findings.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The portfolio row carries its own findings
--
-- Two policy rules could never come out right on the portfolio page, because
-- the row it reads did not carry the facts they need.
--
--   · `max_open_severity` was evaluated against an empty finding list, so a
--     profile that forbids an open critical reported a pass on an application
--     with three of them. A ceiling that cannot be breached is not a ceiling.
--
--   · `require_store_readiness` was evaluated with `intendedForAppStore` hard
--     -coded to false, so an application that *is* intended for a store failed
--     the rule with an explanation stating the opposite of the truth. A wrong
--     answer with a confident reason is worse than no answer.
--
-- Both are added to the view rather than fetched per row by the page: one query
-- that returns what it needs beats a dashboard that issues one more query per
-- application and gets slower as a customer succeeds.
--
-- Only published findings on the latest reviewed assessment, and only the four
-- fields the policy engine reads. The portfolio is a summary; the report is
-- where a finding is read.
-- ---------------------------------------------------------------------------

drop view if exists public.portfolio;

create view public.portfolio
with (security_invoker = true) as
select
  app.id                       as app_id,
  app.organisation_id,
  app.name,
  app.primary_url,
  app.app_type,
  app.screening_status,
  app.monitoring_enabled,
  app.intended_for_app_store,
  app.last_seen_at,
  app.consecutive_liveness_failures,
  app.policy_profile_id,
  latest.assessment_id,
  latest.overall_score,
  latest.certification_eligible,
  latest.dimension_scores,
  latest.assessed_at,
  latest.rubric_version,
  coalesce(findings.rows, '[]'::jsonb) as open_findings,
  badge.id                     as badge_id,
  badge.status                 as badge_status,
  badge.expires_at             as badge_expires_at,
  auth_state.status            as authorisation_status,
  coalesce(open_alerts.n, 0)   as unread_alerts
from public.apps app
left join lateral (
  select a.id as assessment_id, a.overall_score, a.certification_eligible,
         a.dimension_scores, a.rubric_version,
         coalesce(a.completed_at, a.created_at) as assessed_at
    from public.assessments a
   where a.app_id = app.id and a.status in ('approved', 'published')
   order by coalesce(a.completed_at, a.created_at) desc
   limit 1
) latest on true
left join lateral (
  select jsonb_agg(
           jsonb_build_object(
             'ruleId',    f.rubric_rule_id,
             'dimension', f.dimension,
             'severity',  f.severity,
             'title',     f.title
           )
           order by f.severity, f.title
         ) as rows
    from public.findings f
   where f.assessment_id = latest.assessment_id
     and f.is_published
) findings on true
left join lateral (
  select b.id, b.status, b.expires_at from public.badges b
   where b.app_id = app.id order by b.issued_at desc limit 1
) badge on true
left join lateral (
  select au.status from public.authorisations au
   where au.app_id = app.id order by au.created_at desc limit 1
) auth_state on true
left join lateral (
  select count(*)::int as n from public.alerts al
   where al.app_id = app.id and al.read_at is null
) open_alerts on true;

comment on view public.portfolio is
  'One row per application with everything a dashboard shows, including the published findings of the latest reviewed assessment so a policy profile can be evaluated without a second query. security_invoker, so row-level security decides which rows come back.';

grant select on public.portfolio to authenticated;

-- ===========================================================================
-- 20260826120000_badge_issued_alert.sql
-- ===========================================================================

-- =============================================================================
-- The alert nobody was sending: your badge exists.
--
-- `alert_kind` carried `badge_suspended` and `badge_expiring` from the start —
-- the two pieces of bad news — and nothing for the moment the customer actually
-- paid for. They found out a badge had been issued by going to look.
--
-- Adding a value to an enum cannot run inside a transaction block in older
-- Postgres, and Supabase applies each migration in one, so this is written as
-- `if not exists` against the catalogue rather than as `alter type ... add
-- value`. It is idempotent either way.
-- =============================================================================

do $$
begin
  if not exists (
    select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'alert_kind'
       and e.enumlabel = 'badge_issued'
  ) then
    alter type public.alert_kind add value 'badge_issued';
  end if;
end
$$;

-- ===========================================================================
-- 20260826140000_rubric_superseded_alert.sql
-- ===========================================================================

-- =============================================================================
-- "The standard has moved on."
--
-- A badge is earned against one rubric version and stays valid until it expires,
-- because a score is never retroactively altered by a rubric change — that is
-- what `reject_published_rubric_change` protects. But it means a customer can be
-- carrying a live badge measured against a standard that has since been
-- superseded, and nothing told them.
--
-- The data was already there. `badges.rubric_version` and
-- `rubric_versions.superseded_at` answer it in one join; the product just never
-- asked the question.
-- =============================================================================

do $$
begin
  if not exists (
    select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'alert_kind'
       and e.enumlabel = 'rubric_superseded'
  ) then
    alter type public.alert_kind add value 'rubric_superseded';
  end if;
end
$$;

