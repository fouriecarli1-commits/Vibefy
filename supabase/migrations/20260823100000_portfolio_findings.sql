-- ---------------------------------------------------------------------------
-- The portfolio row carries its own findings
--
-- Two policy rules could never come out right on the portfolio page, because
-- the row it reads did not carry the facts they need.
--
--   · `max_open_severity` was evaluated against an empty finding list, so a
--     profile that forbids an open critical reported a pass on an application
--     with three of them. A ceiling that cannot be breached is not a ceiling.
--
--   · `require_store_readiness` was evaluated with `intendedForAppStore` hard
--     -coded to false, so an application that *is* intended for a store failed
--     the rule with an explanation stating the opposite of the truth. A wrong
--     answer with a confident reason is worse than no answer.
--
-- Both are added to the view rather than fetched per row by the page: one query
-- that returns what it needs beats a dashboard that issues one more query per
-- application and gets slower as a customer succeeds.
--
-- Only published findings on the latest reviewed assessment, and only the four
-- fields the policy engine reads. The portfolio is a summary; the report is
-- where a finding is read.
-- ---------------------------------------------------------------------------

drop view if exists public.portfolio;

create view public.portfolio
with (security_invoker = true) as
select
  app.id                       as app_id,
  app.organisation_id,
  app.name,
  app.primary_url,
  app.app_type,
  app.screening_status,
  app.monitoring_enabled,
  app.intended_for_app_store,
  app.last_seen_at,
  app.consecutive_liveness_failures,
  app.policy_profile_id,
  latest.assessment_id,
  latest.overall_score,
  latest.certification_eligible,
  latest.dimension_scores,
  latest.assessed_at,
  latest.rubric_version,
  coalesce(findings.rows, '[]'::jsonb) as open_findings,
  badge.id                     as badge_id,
  badge.status                 as badge_status,
  badge.expires_at             as badge_expires_at,
  auth_state.status            as authorisation_status,
  coalesce(open_alerts.n, 0)   as unread_alerts
from public.apps app
left join lateral (
  select a.id as assessment_id, a.overall_score, a.certification_eligible,
         a.dimension_scores, a.rubric_version,
         coalesce(a.completed_at, a.created_at) as assessed_at
    from public.assessments a
   where a.app_id = app.id and a.status in ('approved', 'published')
   order by coalesce(a.completed_at, a.created_at) desc
   limit 1
) latest on true
left join lateral (
  select jsonb_agg(
           jsonb_build_object(
             'ruleId',    f.rubric_rule_id,
             'dimension', f.dimension,
             'severity',  f.severity,
             'title',     f.title
           )
           order by f.severity, f.title
         ) as rows
    from public.findings f
   where f.assessment_id = latest.assessment_id
     and f.is_published
) findings on true
left join lateral (
  select b.id, b.status, b.expires_at from public.badges b
   where b.app_id = app.id order by b.issued_at desc limit 1
) badge on true
left join lateral (
  select au.status from public.authorisations au
   where au.app_id = app.id order by au.created_at desc limit 1
) auth_state on true
left join lateral (
  select count(*)::int as n from public.alerts al
   where al.app_id = app.id and al.read_at is null
) open_alerts on true;

comment on view public.portfolio is
  'One row per application with everything a dashboard shows, including the published findings of the latest reviewed assessment so a policy profile can be evaluated without a second query. security_invoker, so row-level security decides which rows come back.';

grant select on public.portfolio to authenticated;
