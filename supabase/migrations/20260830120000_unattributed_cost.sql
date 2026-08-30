-- =============================================================================
-- 0015 — Spend that never became an assessment
--
-- `cost_records.assessment_id` was `not null`, so the ledger could only record
-- money spent by a run that persisted successfully. The daily spend cap reads
-- that ledger. Which means the one failure mode that spends the most — a run
-- that finishes, costs real money, and then cannot be written down — was the
-- one failure mode the cap could not see.
--
-- That is not hypothetical. The first production run cost $0.53, failed to
-- persist against a foreign key, was requeued, and did it again. No row in
-- `cost_records`, so `public.spend_since()` reported zero the whole time.
--
-- A guardrail blind to its own worst case is not a guardrail. The column
-- becomes nullable so the cost can be recorded against the organisation even
-- when there is no assessment to attach it to. `organisation_id` stays
-- mandatory: unattributable spend is still someone's spend.
-- =============================================================================

alter table public.cost_records alter column assessment_id drop not null;

comment on column public.cost_records.assessment_id is
  'Null when the run was paid for but never persisted — the cost is real and the '
  'spend cap must see it, even though no assessment row exists to attach it to.';

-- `public.assessment_cost` joins assessments, so these rows are absent from it
-- by construction, which is correct: they belong to no assessment. They are
-- present in `public.daily_spend` and in `public.spend_since()`, which is the
-- entire point.

-- -----------------------------------------------------------------------------
-- The free-tier budget has to see the same rows
-- -----------------------------------------------------------------------------
--
-- `free_tier_spend_since` reached the organisation by joining through the
-- assessment, which was reasonable when every cost record had one. With the
-- column nullable that inner join silently drops exactly the rows this
-- migration exists to make visible.
--
-- `cost_records.organisation_id` was always there and was always the direct
-- answer, so the join becomes a left join used only for the app-level invoice
-- exemption. Where there is no assessment there is no app, so that exemption
-- cannot be established and the spend counts against the free-tier budget.
-- For a ceiling, the conservative reading is the correct one: unattributable
-- spend is counted rather than excused.
create or replace function public.free_tier_spend_since(from_time timestamptz)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(c.total_cost_usd), 0)::numeric
    from public.cost_records c
    left join public.assessments a on a.id = c.assessment_id
   where c.recorded_at >= from_time
     and not exists (
       select 1 from public.subscriptions s
        where s.organisation_id = c.organisation_id
          and s.status in ('active', 'trialing')
          and s.plan <> 'free'
     )
     and not exists (
       select 1 from public.invoices i
        where i.app_id = a.app_id and i.status = 'paid'
          and i.amount_paid_cents > i.amount_refunded_cents
     );
$$;
