-- =============================================================================
-- The automated half of intake screening: it may clear, and only clear.
--
-- `record_screening_decision` is the reviewer's door — it takes a verdict,
-- because a reviewer may refuse. This one takes no verdict at all.
--
-- That asymmetry is the point. The screening module's own note puts it best: a
-- wrongly refused customer is a real harm and so is a wrongly accepted one, and
-- the difference is that a human can resolve the first in a day. So the
-- judgement pass is allowed to take the benign submissions *out* of the queue
-- and is not allowed to put anybody out of business. Where it reads a
-- submission as prohibited, the application stays `pending` with the reasoning
-- attached and a person decides.
--
-- The deterministic filter in `screenIntake` still refuses outright, and that is
-- a different thing: it matches phrases specific enough that their presence is
-- the finding, which is a rule rather than a judgement.
--
-- Only ever moves an application out of `pending`. A refusal a reviewer has
-- already recorded is not something a sweep may undo.
-- =============================================================================

create or replace function public.record_automated_screening(target_app uuid, note text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_org uuid;
begin
  if length(btrim(coalesce(note, ''))) < 10 then
    raise exception 'An automated clearance must say what it read, in a sentence';
  end if;

  select organisation_id into target_org
    from public.apps
   where id = target_app and screening_status = 'pending';

  -- Not an error: between the sweep reading the row and writing it, a reviewer
  -- may have decided, and theirs stands.
  if target_org is null then
    return false;
  end if;

  update public.apps
     set screening_status = 'cleared',
         screening_notes = note,
         screened_at = now()
   where id = target_app and screening_status = 'pending';

  insert into public.audit_log
    (organisation_id, actor_id, actor_role, action, entity_type, entity_id, summary,
     before_state, after_state)
  values
    (target_org, null, 'automated intake screen', 'app.screening_cleared', 'app', target_app,
     note,
     jsonb_build_object('screening_status', 'pending'),
     jsonb_build_object('screening_status', 'cleared'));

  return true;
end
$$;

revoke all on function public.record_automated_screening(uuid, text) from public;

comment on function public.record_automated_screening is
  'The intake judgement pass. Clears only — it may shorten the reviewer queue, never refuse a customer.';
