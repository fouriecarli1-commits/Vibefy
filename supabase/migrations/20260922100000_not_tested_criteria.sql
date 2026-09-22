-- Criteria a run did not answer, so the verification page cannot tick them.
--
-- The page turns "no findings against this criterion" into a tick. That is
-- correct when the criterion was checked and nothing was found, and it is the
-- worst thing this product can print when nothing checked it at all. One guard
-- already exists for a criterion the rubric version does not define; this is
-- the other case — a criterion the rubric defines that this particular run
-- could not reach. A checkout lives at /checkout and the criterion that asks
-- where a card number goes is read from the landing page, so for most
-- applications that take payments it was never tested, and the visitor was
-- shown a tick.
--
-- Shape: [{ "criterion": "SEC-12", "because": "<sentence the page shows>" }]
alter table public.assessments
  add column if not exists not_tested jsonb not null default '[]'::jsonb;

comment on column public.assessments.not_tested is
  'Criteria the rubric defines that this run did not answer, with the reason. The verification page shows these as not tested rather than as a pass.';
