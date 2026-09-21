-- =============================================================================
-- Somebody has to actually do the human check the screen promises.
--
-- `screenIntake` refuses what the deterministic filter catches and sends
-- everything else to `needs_human_review`, which the console records as
-- `screening_status = 'pending'`. The application page then tells the customer,
-- in as many words, "A reviewer confirms every submission before an assessment
-- runs."
--
-- Nothing did. `refused` was blocked in both the console and the worker;
-- `pending` was waved straight through, there was no screen a reviewer could
-- work, and the judgement pass is not wired up — so every application ever
-- created sits in the state that was supposed to require a person, and none of
-- them got one.
--
-- This is the database half: a reviewer may move an application out of
-- `pending` and nobody else may, a decision has to say why, and the decision
-- writes its own audit line so it cannot be taken quietly.
--
-- A function rather than an update policy, because a policy cannot say *which*
-- columns an update may touch. A reviewer has business with three of them and
-- none of the rest.
-- =============================================================================

create or replace function public.record_screening_decision(
  target_app uuid,
  decision public.screening_status,
  note text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_org uuid;
  previous   public.screening_status;
begin
  if not public.is_reviewer() then
    raise exception 'Only a VibefyCode reviewer may record a screening decision';
  end if;

  -- `pending` is where a submission starts, not something anyone decides.
  if decision = 'pending' then
    raise exception 'A screening decision is cleared or refused';
  end if;

  -- The same rule the Acceptable Use Policy states: a refusal names its ground,
  -- and a clearance says what was looked at. Both are shown to the customer.
  if length(btrim(coalesce(note, ''))) < 10 then
    raise exception 'A screening decision must say why, in a sentence';
  end if;

  select organisation_id, screening_status into target_org, previous
    from public.apps where id = target_app;
  if target_org is null then
    raise exception 'No such application';
  end if;

  update public.apps
     set screening_status = decision,
         screening_notes = note,
         screened_at = now()
   where id = target_app;

  insert into public.audit_log
    (organisation_id, actor_id, actor_role, action, entity_type, entity_id, summary,
     before_state, after_state)
  values
    (target_org, auth.uid(), 'reviewer', 'app.screening_' || decision::text, 'app', target_app,
     note,
     jsonb_build_object('screening_status', previous),
     jsonb_build_object('screening_status', decision::text));
end
$$;

revoke all on function public.record_screening_decision(uuid, public.screening_status, text)
  from public;
grant execute on function public.record_screening_decision(uuid, public.screening_status, text)
  to authenticated;

comment on function public.record_screening_decision is
  'The human check the application page promises. Reviewer only, reason required, audited.';
