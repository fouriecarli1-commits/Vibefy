-- =============================================================================
-- 0027 — A page for the person who built the thing
--
-- Somebody who builds quickly and wants to be taken seriously has nothing to
-- link to. A page listing the applications they have had assessed, with the
-- badges still live, is a thing to put in a proposal or at the bottom of a CV.
--
-- It is also the most dangerous thing in this schema so far, because it is the
-- first that says something about a *person* rather than about an application.
-- Listing somebody's applications together tells a story about them: what they
-- have built, how often, and how it went. That story is theirs.
--
-- So four rules, each enforced here rather than promised in a policy.
--
--   · Nothing is published until they publish it. `published` defaults to
--     false, and a profile that exists is not a profile anybody can see.
--   · Consent is per application. A row in `builder_profile_apps` is a
--     decision about one application, taken once, and deleting it is how it is
--     withdrawn. There is no "list everything" switch, because a switch like
--     that is how an application somebody had forgotten about ends up on a
--     page they are showing to a client.
--   · An organisation may only list its own applications. A trigger, not a
--     convention: without it, a row here is a claim about somebody else's work
--     with your name at the top of the page.
--   · Taking it down is one action and it is immediate. Unpublishing hides the
--     whole page; deleting a row removes one application. Neither needs us.
--
-- Publicly, only applications with a *live* badge appear. An assessment that
-- did not earn one is the owner's to talk about if they want to, and a page we
-- host is not where that decision should be made for them.
-- =============================================================================

create table public.builder_profiles (
  organisation_id uuid primary key references public.organisations(id) on delete cascade,

  -- The address. Lowercase, short, and not something that could be mistaken
  -- for us: a profile at /b/vibefycode would be an impersonation we hosted.
  handle          text not null unique
                    check (handle ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$')
                    check (handle not in (
                      -- vibefycode-copy-lint-allow-block: the old name is reserved precisely because it is the old name, and somebody holding the handle could pass as us
                      'vibefycode', 'vibefy',
                      -- vibefycode-copy-lint-allow-block-end
                      'admin', 'official', 'support',
                      'security', 'verify', 'badge', 'staff', 'help', 'root'
                    )),

  display_name    text not null check (length(btrim(display_name)) between 2 and 60),
  tagline         text check (tagline is null or length(btrim(tagline)) <= 160),

  -- Off until they say otherwise. A profile nobody asked to publish is a
  -- reputation we took custody of without being asked.
  published       boolean not null default false,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger builder_profiles_set_updated_at
  before update on public.builder_profiles
  for each row execute function public.set_updated_at();

comment on table public.builder_profiles is
  'A public page for one organisation''s own work. Published only when its '
  'owner publishes it, and taken down by them in one action.';

-- -----------------------------------------------------------------------------
-- Which applications, one decision at a time
-- -----------------------------------------------------------------------------

create table public.builder_profile_apps (
  organisation_id uuid not null references public.builder_profiles(organisation_id) on delete cascade,
  app_id          uuid not null references public.apps(id) on delete cascade,
  consented_at    timestamptz not null default now(),
  consented_by    uuid references public.users(id) on delete set null,
  primary key (organisation_id, app_id)
);

create index builder_profile_apps_app_idx on public.builder_profile_apps (app_id);

comment on table public.builder_profile_apps is
  'One row is one decision about one application. Deleting it is how that '
  'decision is withdrawn, and nothing else is needed to withdraw it.';

-- An organisation may only list its own applications. Without this, a row here
-- is a claim about somebody else's work with your name at the top of the page.
create or replace function public.assert_profile_app_is_own()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.apps a
     where a.id = new.app_id and a.organisation_id = new.organisation_id
  ) then
    raise exception
      'An application can only appear on the profile of the organisation that owns it.';
  end if;
  return new;
end;
$$;

create trigger builder_profile_apps_own_only
  before insert or update on public.builder_profile_apps
  for each row execute function public.assert_profile_app_is_own();

-- -----------------------------------------------------------------------------
-- What a stranger sees
-- -----------------------------------------------------------------------------
--
-- `security_invoker = false`, like the badge view: this is deliberately public
-- data and the view is the thing that decides what public means. The three
-- conditions are the whole policy — the profile is published, the application
-- was consented to, and its badge is live today.

create view public.builder_profile_public
with (security_invoker = false) as
select
  p.handle,
  p.display_name,
  p.tagline,
  a.name            as app_name,
  b.slug            as badge_slug,
  b.score,
  b.rubric_version,
  b.assessed_at,
  b.expires_at
from public.builder_profiles p
join public.builder_profile_apps c on c.organisation_id = p.organisation_id
join public.apps a on a.id = c.app_id
join public.badges b on b.app_id = a.id
where p.published
  and public.badge_effective_status(b) = 'active';

comment on view public.builder_profile_public is
  'A published profile and the consented applications whose badge is live. An '
  'assessment that earned no badge never appears: that is the owner''s to talk '
  'about, and a page we host is not where that decision is made for them.';

grant select on public.builder_profile_public to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Row-level security
-- -----------------------------------------------------------------------------

alter table public.builder_profiles enable row level security;
alter table public.builder_profiles force row level security;
alter table public.builder_profile_apps enable row level security;
alter table public.builder_profile_apps force row level security;

create policy builder_profiles_read_own on public.builder_profiles
  for select to authenticated
  using (public.is_org_member(organisation_id));

create policy builder_profiles_write_admins on public.builder_profiles
  for all to authenticated
  using (public.has_org_role(organisation_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organisation_id, array['owner', 'admin']::public.org_role[]));

create policy builder_profile_apps_read_own on public.builder_profile_apps
  for select to authenticated
  using (public.is_org_member(organisation_id));

create policy builder_profile_apps_write_admins on public.builder_profile_apps
  for all to authenticated
  using (public.has_org_role(organisation_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organisation_id, array['owner', 'admin']::public.org_role[]));
