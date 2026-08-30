-- =============================================================================
-- "The standard has moved on."
--
-- A badge is earned against one rubric version and stays valid until it expires,
-- because a score is never retroactively altered by a rubric change — that is
-- what `reject_published_rubric_change` protects. But it means a customer can be
-- carrying a live badge measured against a standard that has since been
-- superseded, and nothing told them.
--
-- The data was already there. `badges.rubric_version` and
-- `rubric_versions.superseded_at` answer it in one join; the product just never
-- asked the question.
-- =============================================================================

do $$
begin
  if not exists (
    select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'alert_kind'
       and e.enumlabel = 'rubric_superseded'
  ) then
    alter type public.alert_kind add value 'rubric_superseded';
  end if;
end
$$;
