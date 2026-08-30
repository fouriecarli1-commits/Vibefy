-- =============================================================================
-- The alert nobody was sending: your badge exists.
--
-- `alert_kind` carried `badge_suspended` and `badge_expiring` from the start —
-- the two pieces of bad news — and nothing for the moment the customer actually
-- paid for. They found out a badge had been issued by going to look.
--
-- Adding a value to an enum cannot run inside a transaction block in older
-- Postgres, and Supabase applies each migration in one, so this is written as
-- `if not exists` against the catalogue rather than as `alter type ... add
-- value`. It is idempotent either way.
-- =============================================================================

do $$
begin
  if not exists (
    select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'alert_kind'
       and e.enumlabel = 'badge_issued'
  ) then
    alter type public.alert_kind add value 'badge_issued';
  end if;
end
$$;
