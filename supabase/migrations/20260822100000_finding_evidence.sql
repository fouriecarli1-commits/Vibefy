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
