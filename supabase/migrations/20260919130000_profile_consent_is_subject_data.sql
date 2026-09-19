-- =============================================================================
-- 0030 — A record of what a person decided is that person's to receive
--
-- `builder_profile_apps` holds one row per decision to show an application on a
-- public page, stamped with who made it. That is not a property of the page: it
-- is an act by a named person, recorded nowhere else, and the same reasoning
-- that puts consents in a subject access export puts these there too.
--
-- The export is assembled by a platform admin on the subject's behalf — it
-- refuses to run for anybody else, because a reviewer would produce a partial
-- answer that looked like a complete one. So the admin needs to be able to read
-- these rows, exactly as they already can read `consents` and `data_requests`,
-- and for the same narrow reason.
--
-- Read only. Nothing here lets an admin add somebody's application to a page or
-- take it off: publishing and withdrawing stay with the organisation's own
-- owners and admins, which is where a decision about somebody's own work
-- belongs.
--
-- -----------------------------------------------------------------------------
-- And the grants the three new tables never had
-- -----------------------------------------------------------------------------
--
-- A second bug of mine, found by the first one failing.
--
-- `builder_profiles`, `builder_profile_apps` and `trust_pages` shipped with
-- row-level security and policies and **no grants at all**, which means no
-- policy was ever consulted: Postgres refuses at the privilege check first, and
-- every one of those tables was unreachable through Supabase. The console pages
-- that read and write them would have answered "permission denied for table"
-- the first time anybody opened them.
--
-- It survived the test suite because the fixtures connect as the database owner,
-- who is not subject to either check. A missing grant is invisible to a test
-- that never asks as the customer — which is why the test added alongside this
-- enumerates every table with row-level security and fails on any that the
-- `authenticated` role cannot touch.
-- =============================================================================

grant select, insert, update, delete on public.builder_profiles to authenticated;
grant select, insert, delete on public.builder_profile_apps to authenticated;
grant select, insert, update, delete on public.trust_pages to authenticated;

-- And two older ones in the same state, which the new test found on its first
-- run. `remediation_engagements` has a policy saying a member of the
-- organisation may read their own engagement, and `remediation_workers` one
-- saying a platform admin may read the roster. Neither could ever have taken
-- effect: a policy on a table the role has no privilege on is a sentence
-- nobody reads. Select only, which is exactly what those two policies say.
grant select on public.remediation_engagements to authenticated;
grant select on public.remediation_workers to authenticated;

create policy builder_profile_apps_read_for_subject_export
  on public.builder_profile_apps
  for select to authenticated
  using (consented_by = auth.uid() or public.is_platform_admin());

comment on policy builder_profile_apps_read_for_subject_export
  on public.builder_profile_apps is
  'A person may read their own publication decisions, and a platform admin may '
  'read them to assemble a subject access export. Neither may change one: that '
  'stays with the organisation that owns the application.';
