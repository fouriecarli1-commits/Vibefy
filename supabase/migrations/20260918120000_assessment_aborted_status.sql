-- =============================================================================
-- 0024 — A run that stopped on purpose is not a run that failed
--
-- `assessment_status` has had no word for a run that was stopped, so the worker
-- wrote `failed` for all three of the ways a run stops deliberately: reaching
-- the spending limit for its depth, using up the intensity the customer's own
-- authorisation permits, and being turned back at the scope boundary.
--
-- Every one of those is the system working. Recording them as failures does
-- three things, each worse than the last:
--
--   · It tells the customer their application broke something. It did not.
--   · It sends whoever is on support looking for a fault that is not there.
--   · It buries the one event most worth seeing. A scope violation means a run
--     was about to reach something nobody authorised and stopped instead —
--     which is the guardrail PART 6 of the brief exists for, filed under the
--     same word as a crashed stage.
--
-- Adding a value to an enum cannot be used in the transaction that adds it, and
-- Supabase applies a pasted migration in one. So this migration adds the label
-- and nothing else; the column that depends on it is the next one. Two files
-- rather than one failure with a confusing message.
-- =============================================================================

do $$
begin
  if not exists (
    select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'assessment_status'
       and e.enumlabel = 'aborted'
  ) then
    -- After `failed`, because that is where a reader looking for it will expect
    -- it: the two outcomes where no report was produced, side by side.
    alter type public.assessment_status add value 'aborted' after 'failed';
  end if;
end
$$;
