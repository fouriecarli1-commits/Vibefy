-- =============================================================================
-- 0028 — What the owner says about themselves, beside what we found
--
-- The verification page is already the page a stranger lands on after clicking
-- a mark. It answers our question — what did the assessment find — and leaves
-- the reader with several it cannot answer: where do I write if something goes
-- wrong, where is the status page, who do I tell about a vulnerability.
--
-- The owner knows all of that. The moment they can type it, though, the page
-- stops being only our claim and becomes partly theirs, and a reader cannot
-- tell which half is which unless the page makes it obvious. That is the whole
-- design problem, and it is solved in three places:
--
--   · Here. These columns hold only the owner's own words, in a table whose
--     name says so, and nothing in them is ever mixed into an assessment.
--   · On the page. Their words are in their own section, under a heading with
--     their name in it, with a sentence saying we did not check any of it.
--   · At the moment of typing. A badge holder writing about their own
--     application beside our seal will reach for exactly the words the mark
--     does not support, the ones this repository's copy gate has refused since
--     the first week. The same rules are applied to them, at the moment of
--     typing, with a sentence saying why rather than a silent rejection.
--
-- Everything here is optional and everything here is publishable or not, in one
-- switch, by its owner.
-- =============================================================================

create table public.trust_pages (
  app_id            uuid primary key references public.apps(id) on delete cascade,
  organisation_id   uuid not null references public.organisations(id) on delete cascade,

  -- Where a person writes when something has gone wrong for them.
  contact_email     text check (contact_email is null or contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- Where somebody writes about a vulnerability, which is a different inbox
  -- and a different urgency from a support question.
  security_contact  text check (security_contact is null or length(btrim(security_contact)) between 3 and 200),

  status_url        text check (status_url is null or status_url ~ '^https://'),
  privacy_url       text check (privacy_url is null or privacy_url ~ '^https://'),
  terms_url         text check (terms_url is null or terms_url ~ '^https://'),

  -- Anything else they want a reader to know. Short on purpose: a trust page
  -- is not a marketing page, and a long one stops being read at all.
  note              text check (note is null or length(btrim(note)) <= 400),

  published         boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger trust_pages_set_updated_at
  before update on public.trust_pages
  for each row execute function public.set_updated_at();

comment on table public.trust_pages is
  'The application owner''s own words, shown on the verification page in their '
  'own section, under their own name, with a sentence saying we did not check '
  'them. Nothing here is ever read by anything that computes a score.';

-- The application and the organisation must match, for the same reason the
-- builder profile insists on it: otherwise a row here is a claim written by one
-- organisation on another organisation's verification page.
create or replace function public.assert_trust_page_is_own()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.apps a
     where a.id = new.app_id and a.organisation_id = new.organisation_id
  ) then
    raise exception 'A trust page belongs to the organisation that owns the application.';
  end if;
  return new;
end;
$$;

create trigger trust_pages_own_only
  before insert or update on public.trust_pages
  for each row execute function public.assert_trust_page_is_own();

-- -----------------------------------------------------------------------------
-- What a stranger sees
-- -----------------------------------------------------------------------------
--
-- Keyed by the badge slug, because that is what the reader arrived with, and
-- only while the badge is live: a trust page attached to a suspended mark would
-- outlive the thing that gave anybody a reason to read it.

create view public.trust_page_public
with (security_invoker = false) as
select
  b.slug            as badge_slug,
  o.name            as owner_name,
  t.contact_email,
  t.security_contact,
  t.status_url,
  t.privacy_url,
  t.terms_url,
  t.note,
  t.updated_at
from public.trust_pages t
join public.apps a on a.id = t.app_id
join public.badges b on b.app_id = t.app_id
join public.organisations o on o.id = t.organisation_id
where t.published
  and public.badge_effective_status(b) = 'active';

comment on view public.trust_page_public is
  'The owner''s own words, for the verification page. Live only while the badge '
  'is: a trust page attached to a suspended mark would outlive the reason '
  'anybody had to read it.';

grant select on public.trust_page_public to anon, authenticated;

alter table public.trust_pages enable row level security;
alter table public.trust_pages force row level security;

create policy trust_pages_read_own on public.trust_pages
  for select to authenticated
  using (public.is_org_member(organisation_id));

create policy trust_pages_write_admins on public.trust_pages
  for all to authenticated
  using (public.has_org_role(organisation_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organisation_id, array['owner', 'admin']::public.org_role[]));
