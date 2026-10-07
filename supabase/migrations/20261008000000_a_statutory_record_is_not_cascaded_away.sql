-- audit-marker: exists (select 1 from pg_constraint where conname = 'cost_records_organisation_id_fkey' and confdeltype = 'r')
--
-- A seven-year record that a workspace deletion would have taken with it.
--
-- `RETENTION_SCHEDULE` in `@vibefycode/governance` publishes 2555 days for
-- `cost_record`, with the rationale a customer reads on /console/privacy:
-- "Cost records are financial records with a statutory retention period."
--
-- Every other long-lived table is written to survive. `audit_log`,
-- `billing_events` and `retention_deletions` null the organisation and keep the
-- row; `consents`, `authorisations` and `invoices` refuse the delete outright.
-- `cost_records` cascaded — the only one of the seven — so the single path by
-- which a workspace could be removed would have destroyed the financial records
-- the schedule says we must keep, and nothing anywhere would have said so.
--
-- It is latent today: there is no delete policy on `organisations` and nothing
-- in the product deletes one, so this would only fire for an operator running
-- the delete by hand — which is exactly the circumstance in which they would
-- least expect the accounts to go with it.
--
-- `restrict` rather than `set null`, because `organisation_id` is not nullable
-- here. That is the same answer `invoices` already gives, and `invoices` is this
-- table's structural twin: a not-null organisation and a statutory retention.
--
-- The two assessment links are nullable, so they take the other half of the same
-- rule: the cost record outlives what it describes, with the link removed.

alter table public.cost_records
  drop constraint cost_records_organisation_id_fkey,
  add constraint cost_records_organisation_id_fkey
    foreign key (organisation_id) references public.organisations(id) on delete restrict;

alter table public.cost_records
  drop constraint cost_records_assessment_id_fkey,
  add constraint cost_records_assessment_id_fkey
    foreign key (assessment_id) references public.assessments(id) on delete set null;

alter table public.cost_records
  drop constraint cost_records_assessment_run_id_fkey,
  add constraint cost_records_assessment_run_id_fkey
    foreign key (assessment_run_id) references public.assessment_runs(id) on delete set null;
