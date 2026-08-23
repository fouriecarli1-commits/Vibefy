-- =============================================================================
-- 0006 — Commerce and unit economics
--
-- Note what is NOT here: there is no foreign key from any table in this file
-- into `assessments`, `findings` or `badges` beyond ownership. Nothing on the
-- scoring path joins to a plan, a price or an invoice. That is the schema-level
-- half of "the score is never for sale"; packages/rubric enforces the other half
-- with types, and the independence test asserts the result.
--
-- Cost instrumentation is built now, in M0, rather than later. If unit cost
-- exceeds price the business is dead, so the number is visible from day one.
-- =============================================================================

create table public.subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations(id) on delete restrict,
  plan                   public.plan_tier not null default 'free',
  status                 public.subscription_status not null default 'active',
  seats                  integer not null default 1 check (seats between 1 and 500),

  stripe_customer_id     text,
  stripe_subscription_id text unique,

  current_period_start   timestamptz,
  current_period_end     timestamptz,
  cancel_at              timestamptz,
  cancelled_at           timestamptz,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint subscriptions_period_is_ordered check (
    current_period_end is null
    or current_period_start is null
    or current_period_end > current_period_start
  )
);

create unique index subscriptions_one_live_per_org on public.subscriptions (organisation_id)
  where status in ('trialing', 'active', 'past_due', 'paused');

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

create table public.invoices (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations(id) on delete restrict,
  subscription_id    uuid references public.subscriptions(id) on delete set null,
  stripe_invoice_id  text unique,
  -- Card data never touches our systems. These are Stripe's numbers, mirrored
  -- so the customer can see their own billing history without a round trip.
  amount_due_cents   integer not null check (amount_due_cents >= 0),
  amount_paid_cents  integer not null default 0 check (amount_paid_cents >= 0),
  amount_refunded_cents integer not null default 0 check (amount_refunded_cents >= 0),
  currency           text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  status             public.invoice_status not null default 'draft',
  tax_country        text check (tax_country is null or tax_country ~ '^[A-Z]{2}$'),
  hosted_invoice_url text,
  issued_at          timestamptz,
  paid_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint invoices_refund_within_payment check (amount_refunded_cents <= amount_paid_cents)
);

create index invoices_org_idx on public.invoices (organisation_id, issued_at desc);

create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Cost records — one row per run stage, so a runaway loop is visible while it
-- is still running rather than at the end of the month.
-- -----------------------------------------------------------------------------

create table public.cost_records (
  id                   uuid primary key default gen_random_uuid(),
  assessment_id        uuid not null references public.assessments(id) on delete cascade,
  assessment_run_id    uuid references public.assessment_runs(id) on delete cascade,
  organisation_id      uuid not null references public.organisations(id) on delete cascade,

  model                text,
  input_tokens         integer not null default 0 check (input_tokens >= 0),
  output_tokens        integer not null default 0 check (output_tokens >= 0),
  cache_read_tokens    integer not null default 0 check (cache_read_tokens >= 0),
  ai_cost_usd          numeric(12,6) not null default 0 check (ai_cost_usd >= 0),

  compute_seconds      numeric(12,3) not null default 0 check (compute_seconds >= 0),
  compute_cost_usd     numeric(12,6) not null default 0 check (compute_cost_usd >= 0),

  storage_bytes        bigint not null default 0 check (storage_bytes >= 0),
  third_party_calls    integer not null default 0 check (third_party_calls >= 0),
  third_party_cost_usd numeric(12,6) not null default 0 check (third_party_cost_usd >= 0),

  total_cost_usd       numeric(12,6) generated always as
                         (ai_cost_usd + compute_cost_usd + third_party_cost_usd) stored,

  recorded_at          timestamptz not null default now()
);

create index cost_records_assessment_idx on public.cost_records (assessment_id);
create index cost_records_recorded_idx on public.cost_records (recorded_at desc);
create index cost_records_org_idx on public.cost_records (organisation_id, recorded_at desc);

-- Feeds the internal dashboard and the global daily spend cap.
create view public.daily_spend
with (security_invoker = true) as
select
  date_trunc('day', c.recorded_at) as day,
  count(distinct c.assessment_id)  as assessments,
  sum(c.ai_cost_usd)               as ai_cost_usd,
  sum(c.compute_cost_usd)          as compute_cost_usd,
  sum(c.total_cost_usd)            as total_cost_usd
from public.cost_records c
group by 1;

create view public.assessment_cost
with (security_invoker = true) as
select
  c.assessment_id,
  c.organisation_id,
  a.depth,
  sum(c.input_tokens)    as input_tokens,
  sum(c.output_tokens)   as output_tokens,
  sum(c.total_cost_usd)  as total_cost_usd
from public.cost_records c
join public.assessments a on a.id = c.assessment_id
group by c.assessment_id, c.organisation_id, a.depth;

-- -----------------------------------------------------------------------------
-- Row-level security
-- -----------------------------------------------------------------------------

alter table public.subscriptions enable row level security;
alter table public.invoices      enable row level security;
alter table public.cost_records  enable row level security;

alter table public.subscriptions force row level security;
alter table public.invoices      force row level security;
alter table public.cost_records  force row level security;

create policy subscriptions_select_members on public.subscriptions
  for select to authenticated
  using (public.is_org_member(organisation_id));

create policy invoices_select_members on public.invoices
  for select to authenticated
  using (public.is_org_member(organisation_id));

-- Our margins are ours. Cost data is not customer-facing, and — importantly —
-- it is not reviewer-facing either: a reviewer who could see what an assessment
-- cost us would be a reviewer with a commercial signal in front of them.
create policy cost_records_select_admins on public.cost_records
  for select to authenticated
  using (public.is_platform_admin());

revoke all on public.subscriptions, public.invoices, public.cost_records
from public, anon, authenticated;

grant select on public.subscriptions, public.invoices to authenticated;
grant select on public.cost_records to authenticated;
grant select on public.daily_spend, public.assessment_cost to authenticated;
