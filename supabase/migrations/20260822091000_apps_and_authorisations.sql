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
