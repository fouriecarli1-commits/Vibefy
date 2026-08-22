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
