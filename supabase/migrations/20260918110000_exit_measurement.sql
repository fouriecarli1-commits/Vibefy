-- =============================================================================
-- 0023 — How hard it is to leave, written down
--
-- The measurement exists and is tested; nothing kept it. A number nobody stores
-- is a number nobody sees, which makes it a number nobody can act on.
--
-- One jsonb column rather than a table of components. The measurement is a
-- single reading taken on a single day, it is always read whole, and nothing
-- joins to a part of it — a table would buy normalisation nobody needs and cost
-- a migration every time a component is added.
--
-- It is deliberately *not* on `badges`. A badge is a claim about an assessment
-- against a published rubric, and this is not part of the rubric and moves no
-- score. Keeping it on the assessment keeps that distinction where the schema
-- can enforce it: nothing that reads a badge's score can reach this by
-- accident.
-- =============================================================================

alter table public.assessments
  add column exit_measurement jsonb;

comment on column public.assessments.exit_measurement is
  'How hard it was to find and reach the way out, measured from the public '
  'site on the day of the assessment. Its own measurement with its own '
  'published weights: not part of the rubric, and it moves no score and no '
  'badge. Null where it was not measured.';

-- Reading a badge's exit measurement is reading one public fact about a public
-- site, so it is exposed alongside the rest of the verification record rather
-- than being reachable only by the service role. Nothing in it was derived from
-- anything a visitor could not have found by clicking around themselves.
create or replace view public.badge_verification
with (security_invoker = false) as
select
  b.public_id,
  b.slug,
  public.badge_effective_status(b) as status,
  b.score,
  b.rubric_version,
  b.assessed_at,
  b.issued_at,
  b.expires_at,
  b.certified_origin,
  b.signature,
  b.signing_key_id,
  b.payload,
  a.name as app_name,
  o.name as owner_name,
  o.is_marketing_client as owner_is_marketing_client,
  public.app_has_remediation(b.app_id) as owner_has_remediation,
  assessed.exit_measurement
from public.badges b
join public.apps a on a.id = b.app_id
join public.organisations o on o.id = b.organisation_id
join public.assessments assessed on assessed.id = b.assessment_id;

comment on view public.badge_verification is
  'Public, anonymous-readable projection of a badge. The scope-and-limitations '
  'block is rendered by the verification page above the fold; this view carries '
  'the facts it states, including both paid-relationship disclosures and the '
  'exit measurement, which is not part of the score.';

grant select on public.badge_verification to anon, authenticated;
