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
