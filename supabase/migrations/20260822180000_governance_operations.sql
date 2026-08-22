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
