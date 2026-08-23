-- =============================================================================
-- 0014 — The public directory
--
-- Certified applications only, and only while they are certified. Two design
-- decisions are written into this schema rather than into a page:
--
--   1. A listing is derived, not stored. There is no `is_listed` column that can
--      go stale — the view joins the live badge, so a suspension removes a
--      listing in the same instant it changes the verification page. The only
--      stored fact is the owner's own choice.
--
--   2. There is no column here through which money could affect placement. Not
--      a rank, not a weight, not a boost. The ordering the directory uses is
--      computed in `@vibefycode/directory` from a type that structurally cannot
--      carry a commercial field, and the marketing-client flag is carried only
--      so that it can be *disclosed*.
-- =============================================================================

create type public.listing_state as enum ('listed', 'opted_out');

create table public.directory_listings (
  app_id          uuid primary key references public.apps(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,

  state           public.listing_state not null default 'listed',

  -- Owner-written, and shown as theirs. Short, because a directory of
  -- paragraphs is a directory nobody reads.
  tagline         text check (tagline is null or length(btrim(tagline)) between 10 and 160),
  category        text check (category is null or length(btrim(category)) between 2 and 40),

  opted_out_at    timestamptz,
  opted_out_by    uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint listing_opt_out_is_stamped check (
    (state = 'opted_out') = (opted_out_at is not null)
  )
);

create trigger directory_listings_set_updated_at
  before update on public.directory_listings
  for each row execute function public.set_updated_at();

-- Every change of mind is kept. "We never listed you" and "you opted out in
-- March" are different claims, and only one of them can be true.
create table public.listing_events (
  id              uuid primary key default gen_random_uuid(),
  app_id          uuid not null references public.apps(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  state           public.listing_state not null,
  actor_id        uuid references public.users(id) on delete set null,
  reason          text,
  occurred_at     timestamptz not null default now()
);

create index listing_events_app_idx on public.listing_events (app_id, occurred_at desc);

create trigger listing_events_no_update
  before update or delete on public.listing_events
  for each row execute function public.reject_mutation();

create or replace function public.record_listing_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' or new.state is distinct from old.state then
    insert into public.listing_events (app_id, organisation_id, state, actor_id)
    values (new.app_id, new.organisation_id, new.state, auth.uid());
  end if;
  return new;
end;
$$;

create trigger directory_listings_record_event
  after insert or update on public.directory_listings
  for each row execute function public.record_listing_event();

-- -----------------------------------------------------------------------------
-- The directory itself
--
-- `security_invoker = false`: this view is deliberately readable by `anon`,
-- which is the whole point of a public directory, and it exposes exactly the
-- columns already published on each application's verification page — nothing
-- more. The underlying tables stay closed.
-- -----------------------------------------------------------------------------

create view public.directory
with (security_invoker = false) as
select
  b.slug,
  app.name,
  b.certified_origin,
  b.score,
  b.rubric_version,
  b.assessed_at,
  b.expires_at,
  a.dimension_scores,
  listing.tagline,
  listing.category,
  -- Disclosed on every surface where a rating appears, whether or not anybody
  -- asked, and not something that can be paid to remove.
  o.is_marketing_client,
  o.marketing_client_since
from public.directory_listings listing
join public.apps app on app.id = listing.app_id
join public.organisations o on o.id = listing.organisation_id
join public.badges b on b.app_id = listing.app_id
join public.assessments a on a.id = b.assessment_id
where listing.state = 'listed'
  -- The live badge, not a stored flag. A suspension removes the listing at the
  -- same moment it changes the verification page.
  and public.badge_effective_status(b) = 'active';

alter table public.directory_listings enable row level security;
alter table public.listing_events      enable row level security;
alter table public.directory_listings force row level security;
alter table public.listing_events      force row level security;

create policy directory_listings_members on public.directory_listings
  for all to authenticated
  using (public.is_org_member(organisation_id) or public.is_reviewer())
  with check (public.is_org_member(organisation_id));

create policy listing_events_members on public.listing_events
  for select to authenticated
  using (public.is_org_member(organisation_id) or public.is_reviewer());

revoke all on public.directory_listings, public.listing_events from public, anon, authenticated;
grant select, insert, update on public.directory_listings to authenticated;
grant select on public.listing_events to authenticated;

revoke all on public.directory from public, anon, authenticated;
grant select on public.directory to anon, authenticated;

comment on view public.directory is
  'The public directory. Certified applications only, live badge only, owner opt-out honoured immediately. Contains nothing that is not already on the verification page each badge links to.';
