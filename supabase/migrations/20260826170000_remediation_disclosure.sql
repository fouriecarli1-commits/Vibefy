-- =============================================================================
-- The remediation relationship, on the face of the result.
--
-- The wall stops the money reaching the score. This makes the relationship
-- visible anyway — because a separation nobody can see is a separation nobody
-- has reason to believe, and the objection is not answered by a policy document
-- that a sceptic has to go looking for.
--
-- Added to the same view the marketing disclosure travels in, so a surface that
-- shows a score cannot show one without the other being available to it.
-- =============================================================================

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
  -- Disclosed wherever a rating is displayed, per the independence policy.
  o.is_marketing_client as owner_is_marketing_client,
  -- The sharper of the two relationships: we were paid to change this
  -- application, and we are also the ones saying whether it passes.
  public.app_has_remediation(b.app_id) as owner_has_remediation
from public.badges b
join public.apps a on a.id = b.app_id
join public.organisations o on o.id = b.organisation_id;

comment on view public.badge_verification is
  'Public, anonymous-readable projection of a badge. The scope-and-limitations block is rendered by the verification page above the fold; this view carries the facts it states, including both paid-relationship disclosures.';

grant select on public.badge_verification to anon, authenticated;
