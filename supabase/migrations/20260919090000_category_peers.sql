-- =============================================================================
-- 0026 — Where a score stands, without saying whose scores it stands against
--
-- Nothing in a report answers "is that good", and it is the first thing
-- everybody asks. A 71 is a number on a scale nobody has an instinct for yet.
-- The honest way to give it meaning is to say how many assessed applications in
-- the same category scored lower.
--
-- Which cannot be read under row-level security, and should not be. A customer
-- may not see another organisation's assessments, and nothing here changes
-- that: this function returns a bare array of numbers. No names, no identifiers,
-- no dates, nothing that could be joined back to an application. "Better than
-- Kettle" is a claim about Kettle, which Kettle did not agree to.
--
-- Three things keep it narrow.
--
--   · It takes an assessment the caller is already entitled to read, and
--     returns nothing to anybody who is not entitled to it. A stranger cannot
--     use it to enumerate a category.
--   · It compares against every *assessed* application in the category, not
--     only the ones that earned a badge. Comparing against the ones that
--     passed would flatter the badged and punish everybody else, and the
--     population it claims to describe is the one it has to use.
--   · One score per application — the most recent — so an application that has
--     been re-assessed four times is one peer rather than four.
-- =============================================================================

create or replace function public.category_peer_scores(assessment uuid)
returns numeric[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  subject_app  uuid;
  subject_org  uuid;
  subject_cat  text;
  scores       numeric[];
begin
  select a.app_id, a.organisation_id, app.category
    into subject_app, subject_org, subject_cat
    from public.assessments a
    join public.apps app on app.id = a.app_id
   where a.id = assessment;

  if subject_app is null then
    return '{}';
  end if;

  -- The entitlement check is the same one the assessment itself is behind. A
  -- definer function that answers to anybody is a hole shaped like a helper.
  if not (
    coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
    or public.is_org_member(subject_org)
    or public.is_reviewer()
  ) then
    return '{}';
  end if;

  if subject_cat is null or btrim(subject_cat) = '' then
    return '{}';
  end if;

  select coalesce(array_agg(latest.score), '{}')
    into scores
    from (
      select distinct on (a.app_id) a.overall_score as score
        from public.assessments a
        join public.apps app on app.id = a.app_id
       where app.category = subject_cat
         and a.app_id <> subject_app
         and a.overall_score is not null
         and a.status in ('approved', 'published')
       order by a.app_id, a.completed_at desc nulls last, a.created_at desc
    ) latest;

  return scores;
end;
$$;

revoke all on function public.category_peer_scores(uuid) from public, anon;
grant execute on function public.category_peer_scores(uuid) to authenticated, service_role;

comment on function public.category_peer_scores(uuid) is
  'The most recent score of every other assessed application in the same '
  'category, as bare numbers. Returns nothing to a caller who is not entitled '
  'to the assessment it was asked about. It carries no identifying data by '
  'construction: a comparison must never name another application.';
