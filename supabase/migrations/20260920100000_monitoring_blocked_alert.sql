-- =============================================================================
-- "We could not look."
--
-- A liveness check can end three ways, not two: the application answered, the
-- application did not answer, or we declined to make the request at all. The
-- third is the scope guard refusing an origin that now resolves somewhere the
-- authorisation does not cover — a certified origin whose DNS has been pointed
-- at a private address, for instance.
--
-- Until now all three were recorded as "did not answer". That counted a refusal
-- towards suspension and then told the customer, in writing, that their
-- application had stopped responding. It had not. We had stopped looking, for a
-- reason that is our business to explain and a human's to act on.
--
-- So: its own alert kind, because a notice that says the wrong thing is worse
-- than no notice at all.
-- =============================================================================

do $$
begin
  if not exists (
    select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'alert_kind'
       and e.enumlabel = 'monitoring_blocked'
  ) then
    alter type public.alert_kind add value 'monitoring_blocked';
  end if;
end
$$;
