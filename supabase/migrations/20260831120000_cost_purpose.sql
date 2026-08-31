-- =============================================================================
-- 0018 — What the money was spent on
--
-- `cost_records` recorded how much and for whom, and never what for. That was
-- fine while there was only one thing to spend on. There are now two — running
-- an assessment, and answering a customer's questions about one — and the
-- ledger cannot tell them apart.
--
-- Two consequences, one already visible:
--
--   · The unit-economics dashboard divides spend by assessments to get a cost
--     per run. Conversations land in the same total, so the moment somebody
--     asks the assistant a question, the figure the business is steered by is
--     wrong and nothing says so.
--   · The assistant's own ceiling cannot be enforced without knowing which
--     rows are the assistant's. A limit you cannot measure is a number in a
--     comment.
--
-- A closed set, in the database rather than in a convention: a purpose that
-- could be any string is a purpose that will be three spellings by Christmas.
-- =============================================================================

create type public.cost_purpose as enum ('assessment', 'assistant');

-- Everything written before now was an assessment; there was nothing else to
-- spend on. The default keeps existing writers correct until each is updated,
-- and is then the honest value for the overwhelming majority of rows.
alter table public.cost_records
  add column purpose public.cost_purpose not null default 'assessment';

create index cost_records_purpose_idx on public.cost_records (organisation_id, purpose, recorded_at desc);

comment on column public.cost_records.purpose is
  'What the spend bought. Assessments and assistant conversations are both real '
  'costs and both count against the daily cap, but they are not the same number '
  'and must not be averaged together.';

-- -----------------------------------------------------------------------------
-- The assistant's own spend, per organisation
-- -----------------------------------------------------------------------------
--
-- The ceiling this feeds is hourly and per organisation rather than per
-- conversation, and it is worth being exact about why: a conversation is a
-- client-side idea. The browser decides what to send back as history, so
-- "this conversation has cost $x" is a figure the spender reports about
-- themselves. An hour of one workspace's assistant spend is a fact this
-- database owns.
--
-- `security definer` for the same reason the other spend functions are: the
-- caller is a customer, and the answer is about their own organisation only.
create or replace function public.assistant_spend_since(
  organisation uuid,
  from_time timestamptz
)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(total_cost_usd), 0)::numeric
    from public.cost_records
   where organisation_id = organisation
     and purpose = 'assistant'
     and recorded_at >= from_time;
$$;

revoke all on function public.assistant_spend_since(uuid, timestamptz) from public, anon;
grant execute on function public.assistant_spend_since(uuid, timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- The cost-per-run figure counts runs again
-- -----------------------------------------------------------------------------
--
-- `assessment_cost` joins `assessments`, so an assistant row — which has no
-- assessment — was already absent from it. `daily_spend` was not so lucky: it
-- sums everything and divides by distinct assessments, which quietly turns
-- every answered question into a more expensive-looking assessment. It now
-- reports the two separately, alongside the total, so the dashboard can say
-- which is which instead of averaging them.
--
-- The two new columns are appended rather than slotted in beside the total they
-- decompose, which reads worse and is the only thing that works: `create or
-- replace view` may add columns at the end and may not rename or reorder the
-- ones already there. Dropping and recreating would allow the tidier order and
-- would silently discard the view's grant — a cosmetic column order is not
-- worth an afternoon of "permission denied for view daily_spend".
create or replace view public.daily_spend
with (security_invoker = true) as
select
  date_trunc('day', c.recorded_at) as day,
  count(distinct c.assessment_id)  as assessments,
  sum(c.ai_cost_usd)               as ai_cost_usd,
  sum(c.compute_cost_usd)          as compute_cost_usd,
  sum(c.total_cost_usd)            as total_cost_usd,
  sum(c.total_cost_usd) filter (where c.purpose = 'assessment') as assessment_cost_usd,
  sum(c.total_cost_usd) filter (where c.purpose = 'assistant')  as assistant_cost_usd
from public.cost_records c
group by 1;
