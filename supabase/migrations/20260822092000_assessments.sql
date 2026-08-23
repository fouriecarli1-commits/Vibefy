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
