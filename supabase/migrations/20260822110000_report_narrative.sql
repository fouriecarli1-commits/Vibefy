-- =============================================================================
-- 0008 — The report narrative is part of the assessment record
--
-- Synthesis produces the prose a customer actually reads: the headline, the
-- summary, what the application does well, the prioritised remediation order,
-- and what was not assessed. Keeping it only in the engine's memory would mean a
-- report could never be regenerated from the database, which is the whole point
-- of storing an assessment.
--
-- `not_assessed` is the reason this is a column rather than a nicety: a report
-- that cannot say what it did not cover is a report whose silence reads as a
-- clean result.
-- =============================================================================

alter table public.assessments
  add column report_narrative jsonb;

comment on column public.assessments.report_narrative is
  'Frozen output of the synthesis stage. Regenerating a report reads this, never the current prompt.';
