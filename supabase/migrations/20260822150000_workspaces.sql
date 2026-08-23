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
