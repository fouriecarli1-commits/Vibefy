-- =============================================================================
-- 0021 — Advertising space, sold without selling the ratings
--
-- Anré wants people to be able to buy marketing space on VibefyCode, and his
-- argument for it is the right one: the app is quiet, and quiet is what makes a
-- space on it worth paying for. One slot on a page nobody has to scroll past
-- nine others to reach is worth more than nine slots, and it is the only kind
-- this product can carry without becoming the thing it warns people about.
--
-- The directory has been carrying this sentence since M7:
--
--     "Placement here is not for sale. Listings are ordered by the rubric
--      alone, and if paid placement is ever introduced it will be labelled as
--      advertising and kept out of this ordering."
--
-- That was a promise made before there was anything to break it. This schema is
-- where it gets kept, and it is kept in the database rather than in a habit:
--
--   · **Placement is a closed set.** Three surfaces, none of which shows an
--     individual rating. A paid slot on a verification page or inside a report
--     would be an advertisement standing next to the evidence it is paying to
--     be near, and no disclosure repairs that. Those surfaces are not in the
--     enum, so no amount of later carelessness can put one there.
--   · **One live sponsor per surface at a time.** Enforced by a trigger, not by
--     a note in a runbook. Scarcity is the product; an oversold surface is a
--     busy app, which is the thing being sold against.
--   · **A person approves every placement before it appears.** The same gate as
--     an assessment, for the same reason: this is our own credibility being
--     lent out, and a queue nobody reads is a queue that eventually publishes
--     something we would not have.
--   · **Nothing here can reach the score.** There is no foreign key from this
--     table to an assessment, a finding or a badge, and `packages/rubric`
--     cannot import it. That is the same structural separation the price list
--     has, for the same reason.
-- =============================================================================

create type public.sponsorship_status as enum (
  'draft', 'pending_review', 'approved', 'live', 'ended', 'rejected'
);

-- The surfaces that may carry a paid placement. Deliberately short, and
-- deliberately excluding every surface that displays a rating of one named
-- application: /a/<slug>, the report, and everything behind sign-in.
create type public.sponsorship_placement as enum (
  'directory', 'how_it_works', 'methodology'
);

comment on type public.sponsorship_placement is
  'Where a paid placement may appear. A closed set that excludes the '
  'verification page and the report on purpose: an advertisement beside the '
  'evidence it paid to sit next to is not repaired by labelling it.';

create table public.sponsorships (
  id                uuid primary key default gen_random_uuid(),

  -- Null when the sponsor is not a customer of ours, which is the ordinary
  -- case and the one with the least to disclose. When it is set, the
  -- organisation is disclosed wherever the placement appears.
  organisation_id   uuid references public.organisations(id) on delete restrict,

  advertiser_name   text not null check (length(btrim(advertiser_name)) between 2 and 80),
  advertiser_url    text not null check (advertiser_url ~ '^https://[a-z0-9.-]+(:\d+)?(/.*)?$'),

  -- Short on purpose. The space is small because the app is quiet, and the
  -- limit is here rather than in a stylesheet so that a longer one cannot be
  -- sold by accident.
  headline          text not null check (length(btrim(headline)) between 4 and 60),
  body              text not null check (length(btrim(body)) between 10 and 180),

  placement         public.sponsorship_placement not null,
  status            public.sponsorship_status not null default 'draft',

  starts_on         date not null,
  ends_on           date not null,

  price_cents       integer not null default 0 check (price_cents >= 0),
  currency          text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  invoice_id        uuid references public.invoices(id) on delete set null,

  reviewed_by       uuid references public.users(id) on delete restrict,
  reviewed_at       timestamptz,
  review_note       text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint sponsorships_period_is_ordered check (ends_on > starts_on),
  -- A year at the outside. A placement sold indefinitely is one nobody revisits.
  constraint sponsorships_period_is_bounded check (ends_on <= starts_on + interval '12 months'),
  constraint sponsorships_rejection_needs_a_reason check (
    status <> 'rejected' or length(btrim(coalesce(review_note, ''))) >= 10
  )
);

create index sponsorships_live_idx on public.sponsorships (placement, starts_on, ends_on)
  where status = 'live';
create index sponsorships_queue_idx on public.sponsorships (created_at)
  where status = 'pending_review';

create trigger sponsorships_set_updated_at
  before update on public.sponsorships
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- One sponsor per surface at a time
-- -----------------------------------------------------------------------------
--
-- A trigger rather than an exclusion constraint, which would be stronger but
-- needs `btree_gist`. A migration that depends on an extension being available
-- is a migration that fails on somebody else's Postgres, and this codebase runs
-- its schema against a bare cluster in CI.
create or replace function public.sponsorships_one_per_surface()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status not in ('approved', 'live') then
    return new;
  end if;

  if exists (
    select 1 from public.sponsorships other
     where other.id <> new.id
       and other.placement = new.placement
       and other.status in ('approved', 'live')
       and daterange(other.starts_on, other.ends_on, '[)')
           && daterange(new.starts_on, new.ends_on, '[)')
  ) then
    raise exception
      'Another sponsorship already holds the % surface for part of that period. One at a time is the product, not a limitation.',
      new.placement
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

create trigger sponsorships_one_per_surface
  before insert or update on public.sponsorships
  for each row execute function public.sponsorships_one_per_surface();

-- -----------------------------------------------------------------------------
-- A person approves every placement
-- -----------------------------------------------------------------------------
--
-- The same gate an assessment passes, and for the same reason: what is being
-- sold is a position beside our own credibility. A placement that reached the
-- public because nobody looked is the exact failure this company cannot have.
create or replace function public.sponsorships_need_a_reviewer()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status in ('approved', 'live') and new.reviewed_by is null then
    raise exception
      'A sponsorship cannot go live without a recorded human review. Set reviewed_by.'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger sponsorships_need_a_reviewer
  before insert or update on public.sponsorships
  for each row execute function public.sponsorships_need_a_reviewer();

-- -----------------------------------------------------------------------------
-- What the public may read
-- -----------------------------------------------------------------------------
--
-- Only what is on screen right now, and only the fields that are on screen.
-- Nobody outside needs to know what a placement cost or who reviewed it.
create view public.live_sponsorships
with (security_invoker = false) as
select
  s.id,
  s.placement,
  s.advertiser_name,
  s.advertiser_url,
  s.headline,
  s.body,
  s.organisation_id is not null as sponsor_is_a_customer,
  o.is_marketing_client as sponsor_is_marketing_client,
  -- Whether this advertiser is also listed in the directory.
  --
  -- Computed here, by a view that runs as its owner, so the answer crosses the
  -- boundary as a boolean and the organisation ids do not. The renderer needs
  -- to know that a sponsor is advertising beside its own rating; it does not
  -- need to know who else is listed, and neither does anybody reading the page
  -- source.
  exists (
    select 1
      from public.badges b
      join public.directory_listings d on d.app_id = b.app_id
     where b.organisation_id = s.organisation_id
       and b.status = 'active'
       and d.state = 'listed'
  ) as sponsor_is_listed_in_directory
from public.sponsorships s
left join public.organisations o on o.id = s.organisation_id
where s.status = 'live'
  and s.starts_on <= current_date
  and s.ends_on > current_date;

comment on view public.live_sponsorships is
  'Paid placements currently on screen. Carries no price, no reviewer and no '
  'organisation id: what a placement cost is nobody elses business, and the '
  'two facts a reader is owed — that we also rate this advertiser, and that '
  'they are listed on the page they are advertising on — cross as booleans.';

grant select on public.live_sponsorships to anon, authenticated;

alter table public.sponsorships enable row level security;
alter table public.sponsorships force row level security;

-- Only a platform administrator touches these. A customer cannot buy a
-- placement by writing a row; they ask, and a person decides.
create policy sponsorships_select_platform_admin on public.sponsorships
  for select to authenticated using (public.is_platform_admin());

create policy sponsorships_write_platform_admin on public.sponsorships
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

revoke all on public.sponsorships from public, anon, authenticated;
grant select, insert, update on public.sponsorships to authenticated;
