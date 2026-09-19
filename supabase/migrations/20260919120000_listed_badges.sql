-- =============================================================================
-- 0029 — The list of badges we may publish, which is not the list of badges
--
-- A bug of mine, found by reading my own work a day later.
--
-- `/api/badges/live` was built to serve one document containing every live
-- badge, so that anybody checking a lot of sites could do it locally instead of
-- asking us about each one. The privacy argument for it was sound and the query
-- behind it was not: it published *every* live badge.
--
-- A customer may opt out of the public directory and stay certified. The
-- independence policy promises it in those words, the directory honours it, and
-- a machine-readable document listing every badged origin quietly undid it —
-- republishing, in the most reusable form available, exactly the thing somebody
-- had asked us not to publish.
--
-- So the rule lives here rather than in a route, where it can be read, tested
-- and reused: a badge may appear in a published list only where its owner
-- actively chose to be listed. No row in `directory_listings` means no choice
-- was made, and no choice is not consent.
--
-- What is deliberately *not* narrowed: `/api/badge/<id>/status` still answers
-- about any badge, because the caller already holds the identifier and can only
-- have got it from the badge itself or from its owner. Answering a question
-- somebody could only ask because we already told them the answer is not a
-- listing. The verification page is unchanged for the same reason.
-- =============================================================================

create view public.listed_badges
with (security_invoker = false) as
select
  b.public_id,
  b.slug,
  public.badge_effective_status(b) as status,
  a.name            as app_name,
  b.certified_origin,
  b.rubric_version,
  b.assessed_at,
  b.expires_at
from public.badges b
join public.apps a on a.id = b.app_id
join public.directory_listings listing on listing.app_id = b.app_id
where listing.state = 'listed'
  and public.badge_effective_status(b) = 'active';

comment on view public.listed_badges is
  'Live badges whose owner chose to be listed publicly. The source for any '
  'document we publish in bulk. A badge absent from here may still exist: '
  'opting out of the directory does not affect a badge or its verification '
  'page, and this view is the difference between the two.';

grant select on public.listed_badges to anon, authenticated;
