-- =============================================================================
-- Remediation engagements, and the recusal they create.
--
-- VibefyCode rates applications and, from here, may also be paid to help fix
-- them. A rater that sells repairs has a financial interest in finding faults —
-- not an accusation, arithmetic — and the objection cannot be answered by
-- promising restraint, because the incentive exists whether or not anybody acts
-- on it.
--
-- So the separation is enforced here rather than in a form. A reviewer recorded
-- against an engagement cannot approve that application's assessment, however
-- they arrive at the button: through the console, through a script, or through
-- a future code path nobody has written yet.
-- =============================================================================

create type public.engagement_status as enum (
  'proposed', 'accepted', 'in_progress', 'delivered', 'declined'
);

-- No per-finding member, deliberately. "Per finding resolved" is the obvious way
-- to price this and the one that must never exist: it pays us for every fault we
-- report. A rate card cannot drift into it, because the type has nowhere to put it.
create type public.engagement_pricing as enum ('fixed_fee', 'hourly');

create table public.remediation_engagements (
  id              uuid primary key default gen_random_uuid(),
  app_id          uuid not null references public.apps(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  status          public.engagement_status not null default 'proposed',
  pricing_basis   public.engagement_pricing not null,
  summary         text not null,
  opened_at       timestamptz not null default now(),
  delivered_at    timestamptz,
  created_at      timestamptz not null default now()
);

create index remediation_engagements_app on public.remediation_engagements (app_id);

-- Who worked on it. This is the recusal list, so it is the row that matters
-- most: a name missing here is a reviewer permitted to approve an assessment of
-- an application they were paid to change.
create table public.remediation_workers (
  engagement_id uuid not null references public.remediation_engagements(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  recorded_at   timestamptz not null default now(),
  primary key (engagement_id, user_id)
);

-- -----------------------------------------------------------------------------
-- The recusal itself
-- -----------------------------------------------------------------------------

create or replace function public.reject_review_by_remediation_worker()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  reviewed_app uuid;
begin
  select a.app_id into reviewed_app
    from public.assessments a
   where a.id = new.assessment_id;

  if reviewed_app is null then
    return new;
  end if;

  if exists (
    select 1
      from public.remediation_workers w
      join public.remediation_engagements e on e.id = w.engagement_id
     where w.user_id = new.reviewer_id
       and e.app_id = reviewed_app
       -- A declined proposal is not a relationship. Everything else is: once we
       -- have accepted money to change an application, the person who changed it
       -- cannot be the person who says whether it passes.
       and e.status <> 'declined'
  ) then
    raise exception
      'Reviewer % was paid to work on this application and may not review its assessment. Independence policy, enforced here rather than on a form.',
      new.reviewer_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- On `reviews` rather than on `assessments`: the review is the decision, and a
-- trigger on the thing being decided would fire on every unrelated update to it.
create trigger reviews_reviewer_not_a_remediation_worker
  before insert on public.reviews
  for each row execute function public.reject_review_by_remediation_worker();

-- -----------------------------------------------------------------------------
-- Disclosure
-- -----------------------------------------------------------------------------

-- Read wherever a score is shown. A relationship the public cannot see is a
-- relationship the public is right to distrust when they find it.
create or replace function public.app_has_remediation(app uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.remediation_engagements
     where app_id = app and status in ('accepted', 'in_progress', 'delivered')
  );
$$;

alter table public.remediation_engagements enable row level security;
alter table public.remediation_engagements force row level security;
alter table public.remediation_workers enable row level security;
alter table public.remediation_workers force row level security;

create policy remediation_engagements_own on public.remediation_engagements
  for select using (public.is_org_member(organisation_id) or public.is_platform_admin());

create policy remediation_workers_admin on public.remediation_workers
  for select using (public.is_platform_admin());
