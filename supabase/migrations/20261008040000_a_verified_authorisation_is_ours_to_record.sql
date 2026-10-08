-- audit-marker: exists (select 1 from pg_trigger where tgname = 'authorisations_are_verified_by_us' and tgrelid = 'public.authorisations'::regclass)
--
-- A customer could write their own verified authorisation, for a domain they
-- do not own.
--
-- PART 11: "Do not run any assessment step against a target that lacks a
-- verified authorisation record." `apps/worker/src/run-assessment.ts` calls it
-- the hard gate, and the gate is one function:
--
--     select public.app_is_authorised_for_testing(a.id) as authorised
--
-- Measured on the test database, as `authenticated` with a real workspace
-- owner's access token and nothing else:
--
--     insert into public.authorisations
--       (organisation_id, app_id, granted_by, method, status, verified_at,
--        verification_target, scope_domains, …)
--     values (…, 'dns_txt', 'verified', now(),
--             'competitor.example', array['competitor.example'], …);
--
--     SELF_VERIFIED_AUTH: status=verified verified_at_set=true target=competitor.example
--     app_is_authorised_for_testing: true
--
-- An application's `primary_url` is the customer's to set, so the target can
-- be anybody's. The DNS-TXT proof in `verifyOwnership` is real and it was
-- simply not on the path: `verifyAuthorisation` runs the check and then writes
-- the result through the customer's own client, so the check was a step in a
-- server action rather than a property of the row.
--
-- That is the shape of the two before it — a customer writing their own score,
-- a customer clearing their own Acceptable Use verdict — and this is the one
-- where the person harmed is not the customer. It is whoever owns the domain
-- we would have scanned.
--
-- ## The second half: scope that was never proved
--
-- Measured as well: nothing tied `scope_domains` to `verification_target`.
-- `permittedScopeFor` enforces it — a requested host is allowed when it is the
-- verified host, a subdomain of it, or its apex where the verified host is
-- `www.` — and it is enforced at step one, in the action. Step two carries the
-- pending row's scope forward unchanged. So even with the status locked, a
-- pending row written straight through PostgREST could name a target the
-- customer does own and a scope they do not, press Verify in the browser, and
-- have the forged scope carried into a properly verified row.
--
-- Both halves are now properties of the table.

-- -----------------------------------------------------------------------------
-- You may ask, and you may withdraw. Only we may say it was proved.
-- -----------------------------------------------------------------------------
--
-- Deliberately not `security definer`: this needs `current_user` to be the role
-- that actually sent the statement. `authenticated` for anything through
-- PostgREST or a server action on the caller's identity, the table's owner for
-- the worker and for `writeAsService`. A definer function would see its own
-- owner every time and permit everything.
--
-- `pending` and `revoked` are the customer's own acts: asking to be assessed,
-- and withdrawing. `verified` and `expired` are findings about the world, and
-- `revokeAuthorisation` already writes a withdrawal as a new row rather than an
-- edit, so nothing legitimate needs more than this.
create or replace function public.an_authorisation_is_verified_by_us()
returns trigger
language plpgsql
as $$
begin
  if pg_has_role(
       current_user,
       (select relowner from pg_class where oid = 'public.authorisations'::regclass),
       'member') then
    return new;
  end if;

  if new.status not in ('pending', 'revoked') then
    raise exception
      'An authorisation is recorded as % by VibefyCode after the ownership check, not by the account it is about',
      new.status;
  end if;

  if new.verified_at is not null then
    raise exception 'When an authorisation was verified is ours to record, not yours to declare';
  end if;

  return new;
end
$$;

drop trigger if exists authorisations_are_verified_by_us on public.authorisations;
create trigger authorisations_are_verified_by_us
  before insert or update on public.authorisations
  for each row execute function public.an_authorisation_is_verified_by_us();

comment on function public.an_authorisation_is_verified_by_us is
  'The hard gate, held where the row is written. A customer may ask and may '
  'withdraw; whether ownership was proved is ours to record.';

-- -----------------------------------------------------------------------------
-- A verified scope lies under the host that was proved
-- -----------------------------------------------------------------------------
--
-- The SQL half of `permittedScopeFor`, in the same three cases: the host
-- itself, a subdomain of it, or its apex where what was proved is a `www.`
-- host. `right(d, length(target) + 1) = '.' || target` rather than `like`,
-- because an underscore is legal in a hostname and `like` would read it as a
-- wildcard.
--
-- `not valid` and then validated, on purpose. If a database somewhere already
-- holds a verified authorisation whose scope was never proved, the constraint
-- is in place for every new row before the validation runs, and the validation
-- then names the row rather than silently leaving the rule off. Should that
-- happen, this finds them:
--
--     select id, verification_target, scope_domains from public.authorisations
--      where status = 'verified'
--        and not public.scope_is_within_verified_target(verification_target, scope_domains);
--
-- and each one is a row worth reading, because it authorised more than it
-- proved.

-- A CHECK constraint may not contain a subquery, and mapping over an array
-- needs `unnest`, so the predicate is an immutable function and the constraint
-- calls it. It is the same three cases, and being a function it can also be
-- read on its own: `select public.scope_is_within_verified_target('mine.example',
-- array['api.mine.example'])`.
create or replace function public.scope_is_within_verified_target(
  verified_host text,
  domains text[]
)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  -- The null check is inside `bool_and`, not in front of it, so that a row with
  -- nothing to check passes rather than failing on a missing host. An empty
  -- scope on a verified row is already `authorisations_verified_needs_scope`'s
  -- rule and its message says so in those words; two constraints refusing the
  -- same row in an order Postgres does not promise is how a clear error becomes
  -- a coin toss.
  select coalesce(
           bool_and(
             verified_host is not null
             and (
               d = lower(verified_host)
               or right(d, length(verified_host) + 1) = '.' || lower(verified_host)
               or (lower(verified_host) like 'www.%'
                   and d = substring(lower(verified_host) from 5))
             )
           ),
           true)
    from unnest(coalesce(domains, '{}'::text[])) as d;
$$;

comment on function public.scope_is_within_verified_target is
  'Whether every domain is the verified host, a subdomain of it, or its apex where the host is a www one. The SQL half of permittedScopeFor.';

alter table public.authorisations
  add constraint authorisations_scope_within_verified_target
  check (
    status <> 'verified'
    or public.scope_is_within_verified_target(verification_target, scope_domains)
  ) not valid;

alter table public.authorisations
  validate constraint authorisations_scope_within_verified_target;

comment on constraint authorisations_scope_within_verified_target on public.authorisations is
  'A verified authorisation covers the host it proved, its subdomains, and its apex. Nothing else.';
