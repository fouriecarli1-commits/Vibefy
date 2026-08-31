-- =============================================================================
-- 0019 — A second payment provider
--
-- Anré is selling into South Africa and the United States. Those are not one
-- market with two addresses: a South African customer pays in rands with a card
-- or an instant EFT their bank actually supports, and the provider that serves
-- that is not the provider that serves a customer in Ohio.
--
-- The billing code was already built behind an interface for exactly this — the
-- test suite has been running the whole payment path against a fake since day
-- one. What was not ready was this schema. Three columns were named after one
-- provider:
--
--     subscriptions.stripe_customer_id
--     subscriptions.stripe_subscription_id
--     invoices.stripe_invoice_id
--     invoices.stripe_payment_intent_id
--
-- A column called `stripe_subscription_id` holding a Paystack subscription code
-- is a lie told to every future reader of this schema, and the first person it
-- misleads will be whoever is trying to reconcile a payment under time
-- pressure. So they are renamed, and the provider is recorded beside the
-- identifier rather than encoded in its name.
--
-- The uniqueness that mattered still holds, and now holds correctly: an
-- identifier is unique *per provider*. Two providers may legitimately mint the
-- same string, and a global unique index would have rejected the second one as
-- a duplicate of an unrelated record.
-- =============================================================================

create type public.payment_provider as enum ('stripe', 'paystack');

comment on type public.payment_provider is
  'Who took the money. A closed set: an unrecognised provider name is a bug, '
  'and a refund issued against the wrong one fails in a way nobody sees.';

-- -----------------------------------------------------------------------------
-- Subscriptions
-- -----------------------------------------------------------------------------

alter table public.subscriptions
  rename column stripe_customer_id to provider_customer_id;
alter table public.subscriptions
  rename column stripe_subscription_id to provider_subscription_id;

-- Every row that exists today was either Stripe's or was set by an operator for
-- a simulated account, and the latter carries no provider identifier at all.
-- 'stripe' is the honest default for both: it is what the code that wrote them
-- was talking to.
alter table public.subscriptions
  add column provider public.payment_provider not null default 'stripe';

alter table public.subscriptions
  drop constraint subscriptions_stripe_subscription_id_key;

-- Nulls are distinct in a unique index, which is what makes an operator-set
-- plan — no provider, no subscription id — legal, and legal more than once.
create unique index subscriptions_provider_subscription_idx
  on public.subscriptions (provider, provider_subscription_id);

comment on column public.subscriptions.provider is
  'Which provider holds this subscription. An operator-set plan keeps the '
  'default and carries no provider_subscription_id; see docs/OPEN_ITEMS.md on '
  'telling those apart from purchased ones.';

-- -----------------------------------------------------------------------------
-- Invoices
-- -----------------------------------------------------------------------------

alter table public.invoices
  rename column stripe_invoice_id to provider_invoice_id;
-- Stripe calls it a payment intent and Paystack calls it a transaction
-- reference. Both are the same thing to us: the handle a refund is issued
-- against.
alter table public.invoices
  rename column stripe_payment_intent_id to provider_payment_reference;

alter table public.invoices
  add column provider public.payment_provider not null default 'stripe';

alter table public.invoices
  drop constraint invoices_stripe_invoice_id_key;

create unique index invoices_provider_invoice_idx
  on public.invoices (provider, provider_invoice_id);

alter index invoices_payment_intent_idx rename to invoices_payment_reference_idx;

comment on column public.invoices.provider_payment_reference is
  'The handle a refund is issued against — a Stripe payment intent or a '
  'Paystack transaction reference. Never a card number: none reaches us.';

comment on column public.invoices.currency is
  'What the customer was actually charged in, from the provider rather than '
  'from our own arithmetic. We never convert a price; a price in another '
  'currency is a decision, and it is set in config/pricing.json.';
