-- audit-marker: exists (select 1 from information_schema.columns where table_schema='public' and table_name='authorisations' and column_name='repository_url')
-- The repository an authorisation covers, recorded on the authorisation.
--
-- `apps.repository_url` has existed since the first migration and nothing read
-- it, so the static stage — the secret scan, the dependency check, the licence
-- check — never ran against a customer. Wiring it up raises the question the
-- rest of this schema already answers for a domain: what did the customer
-- actually authorise us to look at?
--
-- A domain is proved by a DNS record or a file at a well-known path. A public
-- repository cannot be proved that way, and a customer could otherwise type
-- somebody else's repository into their own application and receive a report
-- about code they do not own. So the repository is declared at the moment the
-- warranty is accepted and copied onto the authorisation row, beside the hash
-- of the exact words they agreed to. The runner clones only what the current
-- authorisation names.
--
-- Changing the repository on the app therefore does not widen what we read.
-- It takes a fresh authorisation, which is the same rule the domain scope has
-- and the same reason: an authorisation we can edit afterwards is worth
-- nothing as evidence that our testing was lawful.
alter table public.authorisations
  add column if not exists repository_url text;

comment on column public.authorisations.repository_url is
  'The repository this authorisation covers, as declared when the warranty was accepted. The runner clones only this; a change on the app requires a fresh authorisation.';
