-- One score, wherever it is read.
--
-- The product says this in its own words, on the report screen: "Your score is
-- the same number wherever you read it." It reads as a description of a
-- database. It is a promise about two columns, and nothing was keeping it.
--
-- `assessments.overall_score` is what the owner's console and report show.
-- `badges.score` is what every public surface shows — the verification page the
-- mark links to, the badge image itself, the directory, a builder's profile.
-- It is written once, at issue, and never again.
--
-- Two ways they come apart, and neither left a trace.
--
--   1. At issue. `assert_badge_is_earned` checks the status, the certification
--      gate, the organisation and the rubric version — and says of that last
--      one, correctly, that a badge "must carry the rubric version the
--      assessment was scored against". The same argument applies to the score
--      and was never made, so a badge could be issued carrying any number
--      between 0 and 100. The test fixtures had in fact drifted apart by a
--      tenth without anything noticing, which is how this was found.
--
--   2. Afterwards. `adjustAssessment` exists so a reviewer can correct a score,
--      and places no restriction on the assessment's status. Adjusting one that
--      has already been badged moves the console's number and leaves the
--      public one, for ever. The direction that matters is downward: a mark
--      still claiming the higher figure after we decided it was wrong is the
--      product over-claiming on somebody else's website, which is the one
--      thing it exists not to do.
--
-- The second is a refusal rather than a cascade. The badge is a signed
-- attestation of a number at a moment; rewriting it under the signature would
-- make the signature meaningless, and silently reissuing would hide the
-- correction. Revoke, adjust, issue again — which is the process the product
-- already describes, now the only one available.

-- -----------------------------------------------------------------------------
-- 1. A badge carries its assessment's score
-- -----------------------------------------------------------------------------

-- audit-marker: exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='assert_score_is_not_pulled_from_under_a_badge')
--
-- Said rather than guessed. The first pattern that matches is
-- `create or replace function public.assert_badge_is_earned`, which has
-- existed since August — so the audit would have reported this migration
-- as already applied, to somebody about to run eight of them by hand.

create or replace function public.assert_badge_is_earned()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  a record;
  consent record;
begin
  select * into a from public.assessments where id = new.assessment_id;

  if a.id is null then
    raise exception 'Badge references a non-existent assessment' using errcode = 'restrict_violation';
  end if;
  if a.status <> 'approved' then
    raise exception 'Badge cannot issue: assessment % is %, not approved by a human reviewer', a.id, a.status
      using errcode = 'restrict_violation';
  end if;
  if not a.certification_eligible then
    raise exception 'Badge cannot issue: assessment % did not meet the certification gate', a.id
      using errcode = 'restrict_violation';
  end if;
  if a.app_id <> new.app_id or a.organisation_id <> new.organisation_id then
    raise exception 'Badge, app and assessment must belong to the same organisation'
      using errcode = 'restrict_violation';
  end if;
  if new.rubric_version <> a.rubric_version then
    raise exception 'Badge must carry the rubric version the assessment was scored against (%)', a.rubric_version
      using errcode = 'restrict_violation';
  end if;

  -- The number on the mark is the number in the report. Said here rather than
  -- trusted to the one caller that writes badges, because the caller that
  -- writes them today is not the only caller there will ever be, and this is
  -- the figure the whole product is about.
  if a.overall_score is null then
    raise exception 'Badge cannot issue: assessment % has no score', a.id
      using errcode = 'restrict_violation';
  end if;
  if new.score <> a.overall_score then
    raise exception
      'Badge must carry the score its assessment was given (% , not %)', a.overall_score, new.score
      using errcode = 'restrict_violation';
  end if;

  select * into consent from public.consents where id = new.licence_consent_id;
  if consent.id is null
     or consent.document_type <> 'badge_licence'
     or consent.action <> 'accepted'
     or consent.organisation_id is distinct from new.organisation_id then
    raise exception 'Badge cannot issue without an accepted Badge Licence for this organisation'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. A score cannot move out from under a mark that is still standing
-- -----------------------------------------------------------------------------

create or replace function public.assert_score_is_not_pulled_from_under_a_badge()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  standing integer;
begin
  if new.overall_score is not distinct from old.overall_score then
    return new;
  end if;

  -- A revoked badge makes no claim and may be left behind. Everything else
  -- still speaks: suspended is reinstatable, and expired is what a reader of
  -- the verification page is being shown the history of.
  select count(*) into standing
  from public.badges b
  where b.assessment_id = new.id
    and b.status <> 'revoked';

  if standing > 0 then
    raise exception
      'Assessment % carries % badge(s) that still show its score, so changing it here would leave the mark and the report disagreeing. Revoke the badge, adjust, and issue again.',
      new.id, standing
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists assessments_score_is_not_pulled_from_under_a_badge on public.assessments;
create trigger assessments_score_is_not_pulled_from_under_a_badge
  before update of overall_score on public.assessments
  for each row execute function public.assert_score_is_not_pulled_from_under_a_badge();

comment on function public.assert_score_is_not_pulled_from_under_a_badge() is
  'The badge is a signed attestation of a number at a moment. Rewriting the '
  'number under the signature would make the signature meaningless, and '
  'reissuing silently would hide the correction, so this refuses instead and '
  'names the three steps that are the published process anyway.';
