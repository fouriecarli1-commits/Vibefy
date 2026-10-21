-- Who the customer is, in law.
--
-- The console asked for a name and nothing else, and four things follow from
-- facts it never held:
--
--   · which country's law governs the agreement, and therefore which documents
--     a person is accepting. The registry carries one `jurisdictionBaseline`
--     for everybody, which is true only while there is one set of documents;
--   · who the counterparty is. "Futurebox" is not a party to a contract;
--     "FUTUREBOXSTUDIO (PTY) LTD (2026/714071/07)" is, and an authorisation
--     warranty given by a name that identifies nobody is worth less than one
--     given by a company number;
--   · how to reach somebody that is not an account login — a badge suspension,
--     a revocation, a statutory deadline;
--   · a DUNS number, where an enterprise buyer asks for one. Optional, and
--     deliberately so: it costs nothing to hold and nobody is kept out for
--     lacking one.
--
-- `billing_email` is left where it is and given a comment rather than a
-- sibling. The sign-up trigger has filled it with the account's address since
-- the first migration and nothing has ever read it — a second email column
-- would be a second answer to "where do we write", and the one nobody updates
-- would be the one somebody reads.

alter table public.organisations
  add column if not exists country             text,
  add column if not exists registration_number text,
  add column if not exists duns_number         text,
  add column if not exists contact_phone       text;

-- ISO 3166-1 alpha-2, upper case. Checked rather than trusted: the column
-- decides which documents apply, and "South Africa", "RSA" and "za" are three
-- spellings of one country that would not match each other.
alter table public.organisations
  drop constraint if exists organisations_country_is_iso;
alter table public.organisations
  add constraint organisations_country_is_iso
  check (country is null or country ~ '^[A-Z]{2}$');

-- Nine digits, as Dun & Bradstreet issues them. Hyphens and spaces are how the
-- same number arrives in three shapes.
alter table public.organisations
  drop constraint if exists organisations_duns_is_nine_digits;
alter table public.organisations
  add constraint organisations_duns_is_nine_digits
  check (duns_number is null or duns_number ~ '^[0-9]{9}$');

comment on column public.organisations.country is
  'ISO 3166-1 alpha-2 of the country whose law governs this workspace''s '
  'agreement with us. It decides which variant of a legal document a person '
  'is shown and accepts; null means the published baseline.';
comment on column public.organisations.registration_number is
  'The company or close-corporation number as the register issues it, '
  'unparsed. The party to an agreement is the registered entity, not a display '
  'name, and an authorisation warranty is given by that entity.';
comment on column public.organisations.duns_number is
  'Optional, for a buyer whose procurement asks for one. Nothing in this '
  'product requires it and nothing is refused for its absence.';
comment on column public.organisations.contact_phone is
  'A number to reach somebody on about this workspace — a suspension, a '
  'revocation, a statutory deadline — which an account login is not.';
comment on column public.organisations.billing_email is
  'Where we write about this workspace. Filled from the account''s own address '
  'at sign-up and editable in the console; the name is historical.';

-- Which words were accepted, when there is more than one set of them.
--
-- `document_version` and `document_sha256` answer "which words" today because
-- there is one document per type. The moment a document has a South African
-- variant and a European one, a version and a hash alone cannot say which of
-- the two a person read — and that is the whole evidentiary value of this
-- table.
alter table public.consents
  add column if not exists document_country text;

alter table public.consents
  drop constraint if exists consents_document_country_is_iso;
alter table public.consents
  add constraint consents_document_country_is_iso
  check (document_country is null or document_country ~ '^[A-Z]{2}$');

comment on column public.consents.document_country is
  'The country variant of the document that was shown, or null for the '
  'published baseline. The hash still pins the exact bytes; this says which '
  'of several sets of bytes was the one on offer.';
