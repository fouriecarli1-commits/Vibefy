-- audit-marker: not exists (select 1 from pg_policy where polrelid = 'public.assessments'::regclass and polname = 'assessments_insert_members')
--
-- A customer could write their own score.
--
-- Measured on the test database, as `authenticated` with a real member's
-- access token and nothing else — no web page involved, just PostgREST:
--
--     insert into public.assessments
--       (app_id, organisation_id, authorisation_id, status, rubric_version,
--        depth, scope_statement, overall_score, dimension_scores,
--        certification_eligible, completed_at)
--     values (… their own app …, 'awaiting_review', '1.1.0', 'full',
--             'This is the scope statement a customer wrote for themselves. …',
--             100, '[{"dimension":"security_privacy","score":100, …}]', true, now());
--
--     SELF-SCORED: dbf93072-… status=awaiting_review score=100.00 cert=true
--
-- And on a real, engine-written assessment of theirs sitting in the queue at
-- 39.00:
--
--     update public.assessments set overall_score = 99, gate_failures = '{}',
--            dimension_scores = '[… 99 …]' where id = '63f6da7d-…';
--
--     AFTER: score=99.00 status=awaiting_review
--
-- `awaiting_review` is exactly the status `/review` lists, so either row goes
-- in front of a reviewer, and the approve action checks nothing about the
-- score, the findings or the stage records. PART 11 of the brief forbids any
-- path by which a payment, plan, discount or marketing purchase can influence
-- a score. This is the customer writing the score directly, which is the same
-- rule and a shorter path.
--
-- ## Why the policies said yes
--
-- `20260822092000_assessments` grants `select, insert, update` on
-- `public.assessments` to `authenticated` and carries:
--
--     assessments_insert_members  insert  with check (is_org_member(organisation_id))
--     assessments_update_members  update  using  (status not in ('approved','rejected')
--                                                  and is_org_member(organisation_id)
--                                                or is_reviewer())
--
-- Both read as "a workspace owns its own assessments", which is true of
-- reading them. Neither names a column, so both also permit the three columns
-- the engine alone is entitled to write: `overall_score`, `dimension_scores`
-- and `gate_failures`, plus the status that moves a row into the queue.
--
-- ## Why removing them breaks nothing
--
-- Measured across the repository: `apps/worker/src/persist.ts` holds the only
-- `insert into public.assessments`, and it runs on the worker's own connection
-- as the owner, which RLS does not apply to. Every other reference —
-- `review/actions.ts`, `review/[id]`, `review/page`, `console/billing`,
-- `console/apps/[id]`, `console/privacy/actions.ts`, the mobile report screen —
-- is a select, except the three review actions, which are reviewer-only and
-- keep their half of the update policy.
--
-- A customer asks for an assessment by inserting into
-- `public.assessment_requests`, which has its own policies and no score
-- column. That is the whole customer-facing write path, and it is untouched.
--
-- ## Why the grant goes too, not just the policy
--
-- A table-level grant with no permissive policy already refuses the
-- statement, so the revoke is redundant today. It is here because the next
-- person to add a policy to this table will write it against the grants they
-- find: `grant insert` left standing is an invitation to re-permit this by
-- accident, and the thing being guarded is the one rule the product cannot be
-- wrong about.
--
-- The findings behind a score were never writable — `public.findings` carries
-- a select policy and nothing else — so a self-scored row arrives in the queue
-- with whatever findings the engine filed, or none at all.

drop policy assessments_insert_members on public.assessments;
revoke insert on public.assessments from authenticated;

-- The reviewer half of the old policy, with the member half removed. Named for
-- who it is for, so the next reader does not have to work out that "members"
-- stopped including members.
drop policy assessments_update_members on public.assessments;

create policy assessments_update_reviewers on public.assessments
  for update to authenticated
  using (public.is_reviewer())
  with check (public.is_reviewer());

comment on table public.assessments is
  'One assessment of one application. Written by the engine on the owner''s '
  'connection; customers read their own and reviewers update status. No role '
  'reachable through PostgREST may write a score.';
