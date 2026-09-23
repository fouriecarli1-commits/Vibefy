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
