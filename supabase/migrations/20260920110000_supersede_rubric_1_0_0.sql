-- =============================================================================
-- The version that moved on, and nobody said so.
--
-- `20260826140000_rubric_superseded_alert.sql` added the alert kind, and
-- `sweepSupersededRubric` was written to raise it: a live badge earned against
-- a rubric version that has since been superseded should get its holder a
-- notice saying so. Both halves exist. The sweep has never once fired.
--
-- Its condition is `earned.superseded_at is not null`, and no row in
-- `rubric_versions` has ever had that column set. Publishing 1.1.0 inserted the
-- new version and left the old one looking current, so every badge earned
-- against 1.0.0 is measured against a standard the engine stopped scoring
-- against — and the feature written to tell them that has been inert since the
-- day it shipped, reporting zero notices raised and looking entirely healthy.
--
-- The test suite missed it because it supersedes a version by hand before
-- checking the sweep, which is a fair test of the sweep and no test at all of
-- whether the condition it depends on ever occurs. `tests/rubric-published.ts`
-- now asks the catalogue instead: every version the scoring code has moved past
-- must be marked superseded.
--
-- Superseded as of when 1.1.0 took effect, not as of now: the date the standard
-- actually moved is the date a customer would be told, and inventing today's
-- date would make the notice say something that is not true.
--
-- Publishing a rubric is two statements from here on, not one.
-- =============================================================================

-- audit-marker: exists (select 1 from public.rubric_versions where version = '1.0.0' and superseded_at is not null)

update public.rubric_versions old
   set superseded_at = current.effective_from
  from public.rubric_versions current
 where old.version = '1.0.0'
   and current.version = '1.1.0'
   and old.superseded_at is null
   and current.effective_from is not null;
