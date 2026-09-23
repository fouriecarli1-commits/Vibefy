-- Uitstaande VibefyCode-migrasies, in hierdie volgorde, een blok op 'n slag.
-- Gegenereer 2026-09-23 uit supabase/migrations/.
--
-- Laat 20260922100000_not_tested_criteria.sql uit: jy het dit reeds gehardloop.
-- Onseker wat jou databasis het? node tools/migration-audit.mjs > audit.sql, en plak
-- daardie navraag in die SQL-venster. Dit lees net; dit skryf en sluit niks.


-- =============================================================================
-- 20260922110000_intensity_default.sql
-- =============================================================================
-- audit-marker: exists (select 1 from information_schema.columns where table_schema='public' and table_name='authorisations' and column_name='intensity_ceiling' and column_default like '%240%')
-- The intensity a new authorisation carries by default.
--
-- Sixty requests a minute was below what a single page load asks for. A page
-- with eighty images asks for eighty-one things at once, so a fifth of it was
-- refused — and the accessibility scan, the design survey, the screenshots and
-- the check at phone width then described a page the engine itself had broken.
--
-- 240 a minute is four a second sustained, with a minute's worth available at
-- once, which is the load profile a real visitor's browser presents on arrival.
-- The total is raised with it so a deeper crawl is not cut short by the other
-- ceiling instead.
--
-- Existing authorisations are deliberately untouched. The intensity ceiling is
-- part of what a customer agreed to, recorded beside the hash of the warranty
-- text they accepted; raising it under them would be testing harder than they
-- agreed to. New authorisations carry the new figures; old ones keep theirs
-- until the customer grants again.
--
-- Nothing else in the ceiling moves. Non-destructive only, no data
-- modification, no export, synthetic accounts only: going harder means looking
-- at more of an application, not doing more to it.
alter table public.authorisations
  alter column intensity_ceiling set default jsonb_build_object(
    'non_destructive_only', true,
    'max_requests_per_minute', 240,
    'max_total_requests', 12000,
    'max_duration_seconds', 1800,
    'allow_data_modification', false,
    'allow_data_export', false,
    'allow_account_creation', true,
    'synthetic_accounts_only', true
  );

-- =============================================================================
-- 20260922120000_authorised_repository.sql
-- =============================================================================
-- audit-marker: exists (select 1 from information_schema.columns where table_schema='public' and table_name='authorisations' and column_name='repository_url')
-- The repository an authorisation covers, recorded on the authorisation.
--
-- `apps.repository_url` has existed since the first migration and nothing read
-- it, so the static stage — the secret scan, the dependency check, the licence
-- check — never ran against a customer. Wiring it up raises the question the
-- rest of this schema already answers for a domain: what did the customer
-- actually authorise us to look at?
--
-- A domain is proved by a DNS record or a file at a well-known path. A public
-- repository cannot be proved that way, and a customer could otherwise type
-- somebody else's repository into their own application and receive a report
-- about code they do not own. So the repository is declared at the moment the
-- warranty is accepted and copied onto the authorisation row, beside the hash
-- of the exact words they agreed to. The runner clones only what the current
-- authorisation names.
--
-- Changing the repository on the app therefore does not widen what we read.
-- It takes a fresh authorisation, which is the same rule the domain scope has
-- and the same reason: an authorisation we can edit afterwards is worth
-- nothing as evidence that our testing was lawful.
alter table public.authorisations
  add column if not exists repository_url text;

comment on column public.authorisations.repository_url is
  'The repository this authorisation covers, as declared when the warranty was accepted. The runner clones only this; a change on the app requires a fresh authorisation.';

-- =============================================================================
-- 20260923100000_owner_name_is_not_public.sql
-- =============================================================================
-- audit-marker: not exists (select 1 from information_schema.columns where table_schema='public' and table_name='badge_verification' and column_name='owner_name')
-- =============================================================================
-- The owner's name comes off the public surfaces.
--
-- `organisations.name` is what somebody typed into a sign-up form. The table
-- defaults `account_type` to 'individual' and carries an `is_personal` flag,
-- which is the schema saying out loud that for a solo builder this column
-- holds a natural person's name.
--
-- It was being handed to `anon` by two views and rendered twice on the
-- verification page — a page that is unauthenticated, indexed while the badge
-- is live, and has an OpenGraph card so the name travels into any chat it is
-- pasted into. Nobody agreed to that. Under POPIA an account name collected to
-- run an account is not a name collected to publish, and the difference
-- between the two is consent, which we never asked for.
--
-- It also was not needed. The reader arrived from a mark on a website and
-- their question is about that website; `certified_origin` answers it exactly,
-- and it is the one identifier the badge actually asserts. Who stands behind
-- the origin is the owner's to disclose, and there are already two places they
-- do it on purpose: the trust page they write and publish themselves, and a
-- builder profile, which has carried a `published boolean not null default
-- false` since the day it was added for precisely this reason.
--
-- So the rule this migration makes true in the catalogue rather than only in a
-- page component: nothing an organisation typed to open an account is readable
-- by `anon`. What a customer chose to publish is published. What they typed to
-- sign up is not.
--
-- `create or replace view` cannot drop a column, so both views are dropped and
-- rebuilt. Nothing else in the schema selects from either of them.
-- =============================================================================

drop view if exists public.badge_verification;

create view public.badge_verification
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
  -- Disclosed wherever a rating is displayed, per the independence policy. It
  -- is a fact about our relationship with the owner rather than a name for
  -- them, which is why it stays when the name goes.
  o.is_marketing_client as owner_is_marketing_client,
  public.app_has_remediation(b.app_id) as owner_has_remediation,
  assessed.exit_measurement
from public.badges b
join public.apps a on a.id = b.app_id
join public.organisations o on o.id = b.organisation_id
join public.assessments assessed on assessed.id = b.assessment_id;

comment on view public.badge_verification is
  'Public, anonymous-readable projection of a badge. Carries the facts the '
  'verification page states, including both paid-relationship disclosures and '
  'the exit measurement, which is not part of the score. It deliberately does '
  'not carry the owning organisation''s name: that is an account name, not a '
  'publication, and for a solo builder it is a natural person''s name.';

grant select on public.badge_verification to anon, authenticated;

drop view if exists public.trust_page_public;

create view public.trust_page_public
with (security_invoker = false) as
select
  b.slug            as badge_slug,
  t.contact_email,
  t.security_contact,
  t.status_url,
  t.privacy_url,
  t.terms_url,
  t.note,
  t.updated_at
from public.trust_pages t
join public.badges b on b.app_id = t.app_id
where t.published
  and public.badge_effective_status(b) = 'active';

comment on view public.trust_page_public is
  'The owner''s own words, for the verification page. Live only while the badge '
  'is: a trust page attached to a suspended mark would outlive the reason '
  'anybody had to read it. Every column here is something the owner typed and '
  'published on purpose; their account name is not, and is not carried.';

grant select on public.trust_page_public to anon, authenticated;
