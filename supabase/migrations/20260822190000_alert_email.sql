-- =============================================================================
-- 0016 — Alerts by email
--
-- M4 built the alerts and M6 delivered them to phones. Everyone without the app
-- installed still had to log in to find out their badge had been suspended,
-- which is not notice in any sense a customer would accept.
--
-- Two changes of shape here, both because there is now more than one channel:
--
--   · `alert_deliveries` becomes a ledger of (alert, channel, target) rather
--     than a ledger of pushes. One table answers "did we tell them, how, and
--     when" for every channel there will ever be.
--   · A hard bounce suppresses an address, the same way a dead push token is
--     disabled. A sender that keeps mailing an address that does not exist
--     destroys its own domain reputation, and then none of the notices arrive.
-- =============================================================================

create type public.alert_channel as enum ('push', 'email');

-- Restated rather than altered: the table is append-only with a trigger that
-- refuses UPDATE and DELETE, so reshaping it in place would mean switching that
-- rule off in order to change the thing the rule protects.
drop table if exists public.alert_deliveries;

create table public.alert_deliveries (
  id           uuid primary key default gen_random_uuid(),
  alert_id     uuid not null references public.alerts(id) on delete cascade,
  channel      public.alert_channel not null,
  -- The device token for a push, the user for an email. Not a foreign key,
  -- because it points at two different tables depending on the channel, and a
  -- delivery record has to survive the target being deleted — that is rather
  -- the point of keeping it.
  target_id    uuid not null,
  status       text not null check (status in ('sent', 'failed')),
  detail       text,
  attempted_at timestamptz not null default now(),

  -- One attempt per alert per channel per target. A sweep that runs twice
  -- cannot deliver twice.
  unique (alert_id, channel, target_id)
);

create index alert_deliveries_alert_idx on public.alert_deliveries (alert_id);

create trigger alert_deliveries_no_update
  before update or delete on public.alert_deliveries
  for each row execute function public.reject_mutation();

-- -----------------------------------------------------------------------------
-- What a person has asked to receive
-- -----------------------------------------------------------------------------

alter table public.users
  add column alert_email_level text not null default 'all'
    check (alert_email_level in ('all', 'critical_only'));

comment on column public.users.alert_email_level is
  'There is deliberately no "none". A badge suspension is a notice we are obliged to give under the Badge Licence, and an notice a customer can switch off is not one. "critical_only" silences everything else.';

grant update (alert_email_level) on public.users to authenticated;

-- -----------------------------------------------------------------------------
-- Addresses we must stop writing to
-- -----------------------------------------------------------------------------

create table public.email_suppressions (
  email        citext primary key,
  reason       text not null check (length(btrim(reason)) >= 5),
  -- 'bounce' is permanent and ours to respect; 'complaint' is someone marking
  -- us as spam, which we respect whether or not we agree with it.
  kind         text not null check (kind in ('hard_bounce', 'complaint', 'manual')),
  suppressed_at timestamptz not null default now()
);

comment on table public.email_suppressions is
  'Addresses that must not be written to again. Mirrors device_tokens.disabled_at: a sender that keeps mailing a dead address ruins its own deliverability, and then none of the notices arrive.';

-- -----------------------------------------------------------------------------
-- Row-level security
-- -----------------------------------------------------------------------------

alter table public.alert_deliveries   enable row level security;
alter table public.email_suppressions enable row level security;
alter table public.alert_deliveries   force row level security;
alter table public.email_suppressions force row level security;

-- Whether a particular handset or inbox accepted a message is an operational
-- fact about our sender, not about the customer. They see the alert itself.
create policy alert_deliveries_platform on public.alert_deliveries
  for select to authenticated
  using (public.is_platform_admin());

create policy email_suppressions_platform on public.email_suppressions
  for select to authenticated
  using (public.is_platform_admin());

revoke all on public.alert_deliveries, public.email_suppressions from public, anon, authenticated;
grant select on public.alert_deliveries to authenticated;
grant select on public.email_suppressions to authenticated;
