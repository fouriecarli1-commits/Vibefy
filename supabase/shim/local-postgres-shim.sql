-- =============================================================================
-- Local Postgres shim — TEST AND LOCAL USE ONLY. Never applied to Supabase.
--
-- Supabase provides the `auth` schema, the `anon` / `authenticated` /
-- `service_role` roles and the `auth.uid()` helper. Recreating just enough of
-- them here means the real migrations can be applied to a bare Postgres, which
-- is what lets the RLS isolation tests run in CI without Docker. Every table in
-- this file mirrors the shape Supabase exposes; nothing here is a substitute
-- for Supabase's actual authentication.
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              citext unique not null,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- Supabase sets `request.jwt.claims` per request from the verified JWT. Tests
-- set the same setting, so policies are exercised exactly as they will be in
-- production rather than through a test-only shortcut.
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'role', 'anon');
$$;
