-- A refusal at intake is written down, by the database.
--
-- `apps/web/app/console/apps/actions.ts` carried this, above an insert into
-- `audit_log`:
--
--     // Refusals are logged with their ground, per the Acceptable Use Policy.
--
-- That is a commitment the published policy makes on our behalf. The insert ran
-- as the customer who submitted the application, and the only insert policy on
-- that table is `audit_log_insert_platform_admin`, which requires
-- `is_platform_admin()`. So row-level security refused it, every time, since the
-- day the admin console landed. The action discarded the result and redirected.
-- No refusal at intake has ever been recorded, and nothing anywhere said so.
--
-- The table is right to be closed. A log that the subject of an entry may write
-- into is not evidence, and the three other things a customer might try there
-- are all still refused.
--
-- So the writer moves rather than the policy. The two screening decisions that
-- already work are written by `security definer` functions — the reviewer's in
-- `record_screening_decision`, the sweep's in `record_automated_screening` —
-- and this is the third door into the same state, the deterministic filter that
-- refuses at submission. It refuses by creating the row already refused, which
-- no update trigger would see and which the other two never do, so an `after
-- insert` trigger covers exactly the gap and overlaps neither.
--
-- Being in the database rather than in the action is the usual reason: a second
-- path that creates an application gets this without anybody remembering, and a
-- refusal cannot be recorded without its ground because the column it reads is
-- the one the customer is shown.

-- audit-marker: exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='record_a_refusal_at_intake')
--
-- Said rather than guessed. The first pattern that matches is
-- `create or replace function public.assert_badge_is_earned`, which has
-- existed since August — so the audit would have reported this migration
-- as already applied, to somebody about to run eight of them by hand.

create or replace function public.record_a_refusal_at_intake()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.screening_status <> 'refused' then
    return new;
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, actor_role, action, entity_type, entity_id, summary,
     before_state, after_state)
  values
    (new.organisation_id,
     -- Who submitted it. The decision was ours, which is what `actor_role`
     -- says; the account it was decided about is what makes the entry useful
     -- when somebody asks why an application never appeared.
     new.created_by,
     'deterministic intake filter',
     'app.screening_refused',
     'app',
     new.id,
     new.screening_notes,
     null,
     jsonb_build_object('screening_status', 'refused'));

  return new;
end
$$;

drop trigger if exists apps_refusal_at_intake_is_written_down on public.apps;
create trigger apps_refusal_at_intake_is_written_down
  after insert on public.apps
  for each row execute function public.record_a_refusal_at_intake();

comment on function public.record_a_refusal_at_intake is
  'The third door into a refused screening status, and the one that refuses by '
  'creating the row already refused. The other two are updates and write their '
  'own entries, so this fires on insert only and overlaps neither.';
