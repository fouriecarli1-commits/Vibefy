-- audit-marker: exists (select 1 from information_schema.columns where table_schema='public' and table_name='authorisations' and column_name='intensity_ceiling' and column_default like '%240%')
-- The intensity a new authorisation carries by default.
--
-- Sixty requests a minute was below what a single page load asks for. A page
-- with eighty images asks for eighty-one things at once, so a fifth of it was
-- refused — and the accessibility scan, the design survey, the screenshots and
-- the check at phone width then described a page the engine itself had broken.
--
-- 240 a minute is four a second sustained, with a minute's worth available at
-- once, which is the load profile a real visitor's browser presents on arrival.
-- The total is raised with it so a deeper crawl is not cut short by the other
-- ceiling instead.
--
-- Existing authorisations are deliberately untouched. The intensity ceiling is
-- part of what a customer agreed to, recorded beside the hash of the warranty
-- text they accepted; raising it under them would be testing harder than they
-- agreed to. New authorisations carry the new figures; old ones keep theirs
-- until the customer grants again.
--
-- Nothing else in the ceiling moves. Non-destructive only, no data
-- modification, no export, synthetic accounts only: going harder means looking
-- at more of an application, not doing more to it.
alter table public.authorisations
  alter column intensity_ceiling set default jsonb_build_object(
    'non_destructive_only', true,
    'max_requests_per_minute', 240,
    'max_total_requests', 12000,
    'max_duration_seconds', 1800,
    'allow_data_modification', false,
    'allow_data_export', false,
    'allow_account_creation', true,
    'synthetic_accounts_only', true
  );
