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
