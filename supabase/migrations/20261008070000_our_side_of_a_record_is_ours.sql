-- audit-marker: not exists (select 1 from information_schema.column_privileges where table_schema = 'public' and table_name = 'appeals' and column_name = 'resolution' and grantee = 'authenticated')
--
-- Four more records whose own subject could write our half of them.
--
-- The same sweep that found the score, the Acceptable Use verdict, the
-- ownership proof and the verified email domain, run over every remaining
-- table a request-facing role may write. None of these four is an exploit the
-- way those were; each is a record that exists to show what *we* did, and each
-- could be written by the party it is about. A record its subject can write is
-- not evidence of anything, which is the whole reason the tables exist.
--
-- Measured first, in each case, that nothing in the product writes the column:
-- the four insert paths are `requestAppeal`, `requestMyData`, the audit-export
-- route and `create_workspace`, and what each one actually sends is listed
-- below beside what it is now allowed to send.
--
-- Postgres has no per-column RLS, so these are per-column INSERT and UPDATE
-- privileges, checked before any policy. As in `20261008030000`, the rule has
-- to be written as a revoke of the whole privilege and a grant of the
-- permitted columns: a column-level revoke cannot subtract from a table-level
-- grant, and Postgres says so in a warning rather than an error.

-- -----------------------------------------------------------------------------
-- appeals: the customer writes the grounds, we write the answer
-- -----------------------------------------------------------------------------
--
-- `appeals_insert_members` names no column, so an appeal could arrive with
-- `status = 'upheld'`, a `resolution` the appellant wrote, `resolved_by`
-- pointing at a reviewer who never saw it, and a `due_at` of their choosing.
-- `/review/appeals` lists what is open, so a self-resolved appeal is also an
-- appeal no reviewer is ever shown.
--
-- `requestAppeal` sends `assessment_id`, `organisation_id`, `finding_id`,
-- `submitted_by` and `grounds`, and nothing else. `status` defaults to `'open'`
-- and `due_at` to fourteen days, which is the published turnaround. Resolving
-- one is an update, and `appeals_update_reviewers` already requires
-- `is_reviewer()`.
revoke insert on public.appeals from authenticated;

grant insert (assessment_id, organisation_id, finding_id, submitted_by, grounds)
  on public.appeals to authenticated;

-- -----------------------------------------------------------------------------
-- data_requests: the statutory clock is not the subject's to set
-- -----------------------------------------------------------------------------
--
-- `data_requests_insert_own` names no column either, so a request could arrive
-- `completed`, with a `response` and a `handled_by` and a `refusal_basis`, or
-- with `due_at` set years out. The response deadline is the thing the whole
-- table exists to evidence — `apps/worker/src/governance.ts` sweeps for
-- overdue ones — and a record that says we answered when we did not is worse
-- than no record.
--
-- `requestMyData` sends `user_id`, `organisation_id`, `request_type` and
-- `details`. `status` defaults to `'received'` and `due_at` to thirty days.
-- Answering one is an update, and `data_requests_update_admin` already
-- requires `is_platform_admin()`.
revoke insert on public.data_requests from authenticated;

grant insert (user_id, organisation_id, request_type, details)
  on public.data_requests to authenticated;

-- -----------------------------------------------------------------------------
-- audit_exports: a hash the holder wrote is not a hash
-- -----------------------------------------------------------------------------
--
-- `packages/workspace/src/audit-export.ts` says why the row is kept: the table
-- is append-only "so that a file produced in a dispute can be" checked against
-- it. `row_count` and `sha256` are what makes that possible, and
-- `recordAuditExport` ran on `writeAsUser` — the caller's own identity — so
-- the figure and the digest were written by the party who would be producing
-- the file.
--
-- Nothing else writes this table, so the privilege goes rather than a column
-- list, and the route records on our own connection instead. The policy goes
-- with it: a policy permitting an insert nobody may perform is a line that
-- reads like a control and is not one.
drop policy audit_exports_insert_admins on public.audit_exports;
revoke insert on public.audit_exports from authenticated;

-- -----------------------------------------------------------------------------
-- organisations: a marketing relationship we have to disclose
-- -----------------------------------------------------------------------------
--
-- `is_marketing_client` is a disclosure. `MARKETING_CLIENT_DISCLOSURE` is
-- rendered on the public verification page, because a company that pays us for
-- marketing and also holds a badge from us is a conflict a reader is entitled
-- to know about. Measured as a workspace owner:
--
--     update public.organisations set is_marketing_client = true,
--            marketing_client_since = now() where id = '…';
--     MARKETING_CLIENT: true
--     UPDATE 1
--
-- Which means the same statement with `false` would have removed the
-- disclosure from their own badge page.
--
-- `is_personal` and `account_type` are beside it and decide how seats and
-- plans are counted; `deleted_at` is a lifecycle flag nothing in the product
-- sets.
--
-- Measured across the repository: nothing in `apps/` updates or inserts this
-- table at all. Creation goes through `create_workspace`, a `security definer`
-- function owned by `postgres`, which holds `bypassrls` and so is unaffected
-- by any of this. So both policies have no caller, and a rename or a settings
-- page — which does not exist yet — will need a policy written for exactly
-- what it changes. That is the right way round: the columns here are either
-- identity or commercial status, and neither should be edited by accident.
drop policy organisations_insert_own on public.organisations;
drop policy organisations_update_admins on public.organisations;
revoke insert, update on public.organisations from authenticated;
