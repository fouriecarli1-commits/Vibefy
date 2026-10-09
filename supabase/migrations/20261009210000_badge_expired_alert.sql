-- =============================================================================
-- "Your badge expired, and nothing told you."
--
-- `sweepBadgeLifecycle` does two things fifteen lines apart. It suspends a badge
-- whose subscription lapsed, and it expires a badge that reached its date. The
-- suspension branch carries this comment, about the defect it was written to
-- close:
--
--     The same event from a liveness failure raises `badge_suspended`; this one
--     raised nothing. A customer's mark came down on their own website — which
--     the licence obliges them to then remove — and the only way to find out was
--     to open the console and look.
--
-- Every word of that applies to the branch above it, which still raises nothing.
--
-- Measured on 2026-10-09 against the test database. A badge twenty-five days
-- from expiry raises one `badge_expiring` alert at severity `info`, and neither
-- delivery channel carries `info` — both filter to warning and critical — so it
-- reaches only somebody who happens to log in. At three days a second one is
-- raised at `warning`, and that one is delivered. Then the badge expires: the
-- status changes, and the alert count goes from two to two.
--
-- So one delivered notice, inside the last week, and silence at the moment the
-- Badge Licence creates the obligation to take the mark down.
--
-- Its own kind, not `badge_suspended` reused. A suspension is something we did
-- because the facts changed; an expiry is a date arriving, and it has a
-- different remedy — a re-assessment renews it. Telling somebody their badge
-- was suspended when it expired would be a notice that says the wrong thing,
-- which the migration that added `monitoring_blocked` already settled is worse
-- than no notice at all.
-- =============================================================================

do $$
begin
  if not exists (
    select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'alert_kind'
       and e.enumlabel = 'badge_expired'
  ) then
    alter type public.alert_kind add value 'badge_expired';
  end if;
end
$$;
