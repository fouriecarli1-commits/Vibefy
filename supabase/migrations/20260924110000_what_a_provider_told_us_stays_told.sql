-- =============================================================================
-- "Everything else about the event is immutable" made true.
--
-- `public.billing_events` is what a provider told us and when, and its own
-- migration says what that is for: "the record we would produce in a billing
-- dispute". The comment above its update trigger says "The one field this table
-- is allowed to change after insert, once, when the handler finishes.
-- Everything else about the event is immutable."
--
-- The trigger compared four columns — `provider_event_id`, `event_type`,
-- `payload`, `occurred_at` — and said nothing about the other three.
--
--   · **`provider`** is half of `unique (provider, provider_event_id)`, which is
--     the idempotency guard this table exists to be. Changing it on an existing
--     row frees that slot, so the same event can be inserted and applied a
--     second time: a replay through an `update`, past the constraint built to
--     stop exactly that.
--   · **`organisation_id`** decides whose dispute this evidence belongs to.
--   · **`received_at`** is when we say we were told.
--
-- Nothing in the product changes any of them today, and `authenticated` holds
-- `select` only — so this is a last line rather than an open door. But writes
-- arrive through `writeAsService`, which connects as the owner and passes every
-- policy, which leaves this trigger as the only thing between the handler and
-- the record. That is precisely when a rule has to be true rather than intended.
--
-- ## Listed rather than inverted
--
-- The obvious tightening is "refuse unless the only changed columns are
-- `handled` and `handler_note`", and it is rejected on purpose. A column added
-- later would then be immutable by default and the insert path would start
-- failing in a way whose cause is three migrations away. Listing what may not
-- change keeps the failure where the decision is: add a column, decide whether
-- it belongs in this list, and say so here.
--
-- Watched failing before it was written: tests/what-a-provider-told-us-stays-
-- told.test.ts, three failures on the three columns, the other four already
-- refused.
-- =============================================================================

create or replace function public.billing_events_only_handled_changes()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.provider_event_id is distinct from old.provider_event_id
     or new.event_type is distinct from old.event_type
     or new.payload is distinct from old.payload
     or new.occurred_at is distinct from old.occurred_at
     -- Half the replay guard. Without this, `update ... set provider = ...`
     -- frees the unique slot and the event can be applied twice.
     or new.provider is distinct from old.provider
     -- Whose dispute this is.
     or new.organisation_id is distinct from old.organisation_id
     -- When we say we were told.
     or new.received_at is distinct from old.received_at then
    raise exception 'billing_events records what a provider told us; only the handled flag may change'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
