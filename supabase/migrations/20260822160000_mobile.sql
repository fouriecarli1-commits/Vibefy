-- =============================================================================
-- 0013 — The mobile app
--
-- Two things the phone needs that the browser does not: somewhere to register
-- for push notifications, and a delivery record so the same alert is not pushed
-- twice. Everything else it uses already exists — it reads the same tables,
-- through the same anon key, under the same row-level security as the console.
-- There is no mobile API, because a second API surface is a second place for an
-- authorisation rule to be forgotten.
-- =============================================================================

create table public.device_tokens (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  -- Expo's push token. It addresses a device, not a person, and it is the only
  -- thing about a customer's phone we hold.
  token           text not null unique check (token ~ '^(ExponentPushToken\[[A-Za-z0-9_-]+\]|ExpoPushToken\[[A-Za-z0-9_-]+\])$'),
  platform        text not null check (platform in ('ios', 'android')),
  app_version     text,
  -- Cleared when Expo tells us the token is dead. A push service that keeps
  -- sending to uninstalled apps gets rate-limited, and deserves to be.
  disabled_at     timestamptz,
  disabled_reason text,
  last_seen_at    timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index device_tokens_user_idx on public.device_tokens (user_id) where disabled_at is null;

comment on table public.device_tokens is
  'Expo push tokens. Deleted with the account, and never joined to anything but the owner''s own alerts.';

-- One delivery attempt per alert per device. The unique index is the whole
-- anti-duplicate design: a sweep that runs twice cannot push twice.
create table public.alert_deliveries (
  id             uuid primary key default gen_random_uuid(),
  alert_id       uuid not null references public.alerts(id) on delete cascade,
  device_token_id uuid not null references public.device_tokens(id) on delete cascade,
  status         text not null check (status in ('sent', 'failed')),
  detail         text,
  attempted_at   timestamptz not null default now(),
  unique (alert_id, device_token_id)
);

create trigger alert_deliveries_no_update
  before update or delete on public.alert_deliveries
  for each row execute function public.reject_mutation();

alter table public.device_tokens     enable row level security;
alter table public.alert_deliveries  enable row level security;
alter table public.device_tokens     force row level security;
alter table public.alert_deliveries  force row level security;

-- A device token belongs to exactly one person, and only that person may see or
-- change it. Not their workspace, not their colleagues: them.
create policy device_tokens_own on public.device_tokens
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Delivery records are ours. A customer sees the alert; whether a push reached a
-- particular handset is an operational fact about our sender, not about them.
create policy alert_deliveries_platform on public.alert_deliveries
  for select to authenticated
  using (public.is_platform_admin());

revoke all on public.device_tokens, public.alert_deliveries from public, anon, authenticated;
grant select, insert, update, delete on public.device_tokens to authenticated;
grant select on public.alert_deliveries to authenticated;

-- The authorisation gate has to be callable from the phone, because the mobile
-- app refuses a re-test before it queues one rather than after.
grant execute on function public.app_is_authorised_for_testing(uuid) to authenticated;
