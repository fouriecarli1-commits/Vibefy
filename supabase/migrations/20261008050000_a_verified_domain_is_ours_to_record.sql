-- audit-marker: exists (select 1 from pg_trigger where tgname = 'sso_domains_are_verified_by_us' and tgrelid = 'public.sso_connections'::regclass)
--
-- A workspace owner could claim any email domain and mark it verified, which
-- locks every address at that domain out of sign-in.
--
-- Measured on the test database, as `authenticated` with a real workspace
-- owner's access token:
--
--     insert into public.sso_connections
--       (organisation_id, provider, email_domain, enforced,
--        domain_challenge, domain_verified_at, created_by, default_role)
--     values (…, 'oidc', 'gmail.com', true, 'x', now(), …, 'member');
--
--     SELF_VERIFIED_SSO: domain=gmail.com enforced=true
--
--     select provider from public.sso_routing('victim@gmail.com');  -- oidc
--
-- `auth-form.tsx` asks `sso_routing` before it accepts a password, for a good
-- reason written down beside it: "a workspace that has enforced SSO has done
-- so precisely so that a password cannot be an alternative route in." So a
-- `required` answer refuses the password and calls `signInWithSSO`. Registering
-- the identity provider itself is still a manual step on our side, so the
-- redirect would fail today — which makes the effect of the row above simply
-- that nobody with a Gmail address can sign in to VibefyCode at all, by the
-- act of one customer, with no step required of us.
--
-- ## What was already right
--
-- `sso_enforced_needs_verified_domain` already holds that `enforced` requires
-- `domain_verified_at`, and `sso_routing` already reads only enforced,
-- domain-verified rows. The constraint is the reason this needs one trigger
-- rather than a column list: with the timestamp ours to write, `enforced` can
-- stay the owner's to set, because the constraint will not let them set it
-- before we have verified the domain.
--
-- `verifySsoDomain` does check the DNS TXT record, with `verifyDnsTxt`, and
-- the challenge is generated when the domain is claimed. The check was real
-- and simply not on the path: the action ran it and then wrote the result
-- through the customer's own client, so it was a step in a server action
-- rather than a property of the row. The same sentence as
-- `20261008040000`, one table over.

-- Deliberately not `security definer`: this needs `current_user` to be the
-- role that actually sent the statement. `authenticated` for anything through
-- PostgREST or a server action on the caller's identity, the table's owner for
-- `writeAsService`. A definer function would see its own owner every time and
-- permit everything.
create or replace function public.an_sso_domain_is_verified_by_us()
returns trigger
language plpgsql
as $$
begin
  if pg_has_role(
       current_user,
       (select relowner from pg_class where oid = 'public.sso_connections'::regclass),
       'member') then
    return new;
  end if;

  if new.domain_verified_at is not null
     and (tg_op = 'INSERT' or old.domain_verified_at is distinct from new.domain_verified_at) then
    raise exception
      'Whether a domain is yours is ours to verify. Claim it, publish the DNS record, and press verify';
  end if;

  return new;
end
$$;

drop trigger if exists sso_domains_are_verified_by_us on public.sso_connections;
create trigger sso_domains_are_verified_by_us
  before insert or update on public.sso_connections
  for each row execute function public.an_sso_domain_is_verified_by_us();

comment on function public.an_sso_domain_is_verified_by_us is
  'A workspace may claim a domain and may enforce one we have verified. Whether '
  'the DNS record was there is ours to record.';
