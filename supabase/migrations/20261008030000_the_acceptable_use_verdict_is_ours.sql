-- audit-marker: not exists (select 1 from information_schema.column_privileges where table_schema = 'public' and table_name = 'apps' and column_name = 'screening_status' and grantee = 'authenticated')
--
-- A workspace owner could clear their own application under the Acceptable
-- Use Policy.
--
-- Measured on the test database, as `authenticated` with a real workspace
-- owner's access token, against an application a reviewer had marked
-- `refused`:
--
--     update public.apps
--        set screening_status = 'cleared', screened_at = now(),
--            screening_notes = 'Looks fine to me.'
--      where id = 'c3384c82-…';
--
--     AFTER: screening=cleared notes=Looks fine to me.
--     UPDATE 1
--
-- `screening_status` is the Acceptable Use gate. `apps/worker/src/
-- run-assessment.ts` refuses to run against `refused` and refuses to run
-- against `pending` — "no assessment runs before that" — so clearing it is
-- how a refused application gets assessed, scored and badged.
--
-- `apps_update_admins` permits it: `has_org_role(organisation_id,
-- ['owner','admin'])`, which is right for the name, the URL and the intake
-- answers, and names no column, so it also covers the three the decision is
-- recorded in. The insert policy is the same shape, so a first submission
-- could arrive already `cleared` and never pass the filter at all.
--
-- ## The monitoring columns go with them
--
-- `last_seen_at`, `last_liveness_status`, `consecutive_liveness_failures` and
-- `last_reassessed_at` are written by `apps/worker/src/monitoring.ts` on the
-- owner's connection and are read-only in every console and mobile screen.
-- The counter is what suspends a badge for an application that has stopped
-- answering; its subject being able to set it back to zero is the same defect
-- with a slower consequence.
--
-- ## Why a column grant and not a policy
--
-- Postgres has no per-column RLS. It does have per-column INSERT and UPDATE
-- privileges, and they are checked before any policy: a statement naming a
-- column the role has no privilege on is refused outright, and a statement
-- that omits it gets the column's default. `screening_status` defaults to
-- `'pending'`, which is the state the queue at /review/screening lists, so a
-- submission that no longer carries a verdict lands exactly where an
-- unscreened submission should.
--
-- It has to be written as a revoke of the whole privilege and a grant of the
-- columns, not as a revoke of the columns. A column-level revoke cannot
-- subtract from a table-level grant: Postgres answers "no privileges could be
-- revoked for column ..." as a warning and changes nothing. The first version
-- of this migration did exactly that, applied without error, and left every
-- column writable — the test that caught it is the one that reads
-- `information_schema.column_privileges` rather than trying a statement.
--
-- So the list below is the owner's own fields, enumerated. A column added to
-- this table later is not writable through PostgREST until a migration says
-- so, which is the right default for a table where the dangerous columns are
-- the ones we author — and is the cost of it: somebody adding an intake
-- question has to add it here too, and the console will tell them plainly,
-- with `permission denied for column`.
--
-- `organisation_id` is deliberately absent from the update list. Nothing in
-- the product moves an application between workspaces, and if that ever
-- becomes a feature it needs its own thought: the badge, the authorisation and
-- the invoices all hang off the organisation this column names.
--
-- ## Where the verdict is written instead
--
-- `record_intake_screening` below, on the owner's connection through
-- `writeAsService`, which is the same door `record_automated_screening` (the
-- worker's sweep) and `record_screening_decision` (the reviewer) already use.
-- The pattern was already here; intake was the one step still writing the
-- column as the customer.
--
-- Only ever moves an application out of `pending`, like the sweep: a verdict a
-- reviewer has already recorded is not something an intake screen may undo.

revoke insert, update on public.apps from authenticated;

grant insert (organisation_id, name, slug, app_type, primary_url, repository_url,
              mobile_build_reference, category, description, builder, target_audience,
              processes_personal_data, has_authentication, has_payments,
              intended_for_app_store, directory_opt_in, is_game, monitoring_enabled,
              policy_profile_id, created_by)
  on public.apps to authenticated;

grant update (name, slug, primary_url, repository_url, mobile_build_reference,
              category, description, builder, target_audience,
              processes_personal_data, has_authentication, has_payments,
              intended_for_app_store, directory_opt_in, is_game, monitoring_enabled,
              policy_profile_id, archived_at)
  on public.apps to authenticated;

-- -----------------------------------------------------------------------------
-- The intake screen's own door
-- -----------------------------------------------------------------------------
--
-- Takes a verdict, unlike `record_automated_screening`, because the
-- deterministic filter in `screenIntake` may refuse outright — it matches
-- phrases specific enough that their presence is the finding, which is a rule
-- rather than a judgement. That is why this one is granted to nobody: the
-- caller is our own server, never the customer, and a function that accepts
-- `'cleared'` from whoever calls it must not be reachable by the account it
-- would be clearing.
--
-- `pending` is a real verdict here and not a no-op: the screen read the
-- submission, could not settle it, and the sentence it got to is what the
-- reviewer at /review/screening reads. So the note is written either way.
create or replace function public.record_intake_screening(
  target_app uuid,
  verdict public.screening_status,
  note text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_org uuid;
  submitted_by uuid;
begin
  if length(btrim(coalesce(note, ''))) < 10 then
    raise exception 'An intake screening must say what it read, in a sentence';
  end if;

  select organisation_id, created_by into target_org, submitted_by
    from public.apps
   where id = target_app and screening_status = 'pending';

  -- Not an error, for the same reason the sweep's is not: between the insert
  -- and this call a reviewer may have decided, and theirs stands.
  if target_org is null then
    return false;
  end if;

  update public.apps
     set screening_status = verdict,
         screening_notes = note,
         screened_at = now()
   where id = target_app and screening_status = 'pending';

  -- A submission left pending is not a decision, so there is nothing to record
  -- beyond the note the reviewer is about to read.
  if verdict = 'pending' then
    return true;
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, actor_role, action, entity_type, entity_id, summary,
     before_state, after_state)
  values
    (target_org,
     -- Who submitted it. The decision was ours, which is what `actor_role`
     -- says; the account it was decided about is what makes the entry useful
     -- when somebody asks why an application never appeared.
     submitted_by,
     'intake screen',
     case verdict when 'refused' then 'app.screening_refused' else 'app.screening_cleared' end,
     'app', target_app, note,
     jsonb_build_object('screening_status', 'pending'),
     jsonb_build_object('screening_status', verdict));

  return true;
end
$$;

revoke all on function public.record_intake_screening(uuid, public.screening_status, text)
  from public, anon, authenticated;

comment on function public.record_intake_screening is
  'What the intake screen read, written by our server and never by the account '
  'it is about. Clears, refuses or leaves pending, and only from pending.';
