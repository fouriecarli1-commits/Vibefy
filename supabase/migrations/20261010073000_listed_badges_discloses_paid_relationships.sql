-- audit-marker: exists (select 1 from information_schema.columns where table_schema='public' and table_name='listed_badges' and column_name='owner_is_marketing_client')
-- =============================================================================
-- The paid-relationship label reaches the list a marketplace reads.
--
-- `legal/rating-methodology-and-independence.md`, section 5: any customer who
-- has purchased marketing services from us is "labelled as such wherever their
-- rating appears, including on the verification page and, from the point the
-- directory exists, on their listing".
--
-- Both of those keep it. `/a/[slug]` renders the label and the directory
-- renders it. The two machine-readable surfaces — `/api/badge/<id>/status` and
-- `/api/badges/live`, each built because the signed payload is awkward to use
-- and each documented as the thing a marketplace actually wants — carried no
-- disclosure at all. So a marketplace following our own documentation would
-- show our mark beside a paying marketing client's listing with nothing to say
-- so, which is the one case that policy exists for.
--
-- The status endpoint needed no schema change: `badge_verification` has
-- carried `owner_is_marketing_client` since the badges migration. This view
-- did not, which is why it is here. Appended rather than inserted, because
-- `create or replace view` may add columns at the end and nothing else.
-- =============================================================================

create or replace view public.listed_badges
with (security_invoker = false) as
select
  b.public_id,
  b.slug,
  public.badge_effective_status(b) as status,
  a.name            as app_name,
  b.certified_origin,
  b.rubric_version,
  b.assessed_at,
  b.expires_at,
  o.is_marketing_client as owner_is_marketing_client
from public.badges b
join public.apps a on a.id = b.app_id
join public.organisations o on o.id = b.organisation_id
join public.directory_listings listing on listing.app_id = b.app_id
where listing.state = 'listed'
  and public.badge_effective_status(b) = 'active';

comment on view public.listed_badges is
  'Live badges whose owner chose to be listed publicly. The source for any '
  'document we publish in bulk. A badge absent from here may still exist: '
  'opting out of the directory does not affect a badge or its verification '
  'page, and this view is the difference between the two. Carries the '
  'paid-relationship disclosure the independence policy promises wherever a '
  'rating appears.';

grant select on public.listed_badges to anon, authenticated;
