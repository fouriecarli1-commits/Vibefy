-- =============================================================================
-- 0009 — Billing events
--
-- Payment providers deliver webhooks more than once, out of order, and
-- occasionally weeks late. Processing one twice would double a refund or
-- reinstate a cancelled subscription, so every event is recorded here first and
-- the unique constraint is what makes the handler idempotent — not a flag we
-- remember to check.
--
-- Append-only, like the other evidence tables: what a provider told us and when
-- is the record we would produce in a billing dispute.
-- =============================================================================

create table public.billing_events (
  id               bigint generated always as identity primary key,
  provider         text not null default 'stripe',
  provider_event_id text not null,
  event_type       text not null,
  organisation_id  uuid references public.organisations(id) on delete set null,
  occurred_at      timestamptz not null,
  received_at      timestamptz not null default now(),
  payload          jsonb not null,
  handled          boolean not null default false,
  handler_note     text,
  unique (provider, provider_event_id)
);

create index billing_events_org_idx on public.billing_events (organisation_id, occurred_at desc);
create index billing_events_unhandled_idx on public.billing_events (received_at) where not handled;

create trigger billing_events_no_delete
  before delete on public.billing_events
  for each row execute function public.reject_mutation();

-- The one field this table is allowed to change after insert, once, when the
-- handler finishes. Everything else about the event is immutable.
create or replace function public.billing_events_only_handled_changes()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.provider_event_id is distinct from old.provider_event_id
     or new.event_type is distinct from old.event_type
     or new.payload is distinct from old.payload
     or new.occurred_at is distinct from old.occurred_at then
    raise exception 'billing_events records what a provider told us; only the handled flag may change'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger billing_events_immutable_payload
  before update on public.billing_events
  for each row execute function public.billing_events_only_handled_changes();

alter table public.billing_events enable row level security;
alter table public.billing_events force row level security;

-- Customers see their own billing history; nobody sees anyone else's.
create policy billing_events_select_members on public.billing_events
  for select to authenticated
  using (organisation_id is not null and public.is_org_member(organisation_id));

revoke all on public.billing_events from public, anon, authenticated;
grant select on public.billing_events to authenticated;

-- An invoice needs to point at the payment it settles, so a refund can find it.
alter table public.invoices
  add column stripe_payment_intent_id text,
  add column amount_tax_cents integer not null default 0 check (amount_tax_cents >= 0),
  add column app_id uuid references public.apps(id) on delete set null,
  add column plan public.plan_tier;

create index invoices_payment_intent_idx on public.invoices (stripe_payment_intent_id);
