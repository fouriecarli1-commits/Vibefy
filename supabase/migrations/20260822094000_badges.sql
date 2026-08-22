-- =============================================================================
-- 0005 — The badge system: "Verified by Vibefy"
--
-- Vibefy's asset is not the testing, it is the credibility of the mark. A badge
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
  -- key at verify.<domain>/.well-known/vibefy-badge-key without contacting us.
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
