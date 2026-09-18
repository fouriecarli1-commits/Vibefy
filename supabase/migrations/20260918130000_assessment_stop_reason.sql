-- =============================================================================
-- 0025 — Why it stopped, and no aborted run without an answer
--
-- The companion to the migration before this one, which added the `aborted`
-- status. A status that says a run stopped and cannot say why replaces one
-- unhelpful word with another.
--
-- Three reasons, a closed set, in the database rather than in a convention:
--
--   · cost_ceiling      — the run reached the spending limit for its depth.
--                         Ours. Nothing for the customer to do.
--   · intensity_ceiling — the run reached a limit in the customer's own testing
--                         authorisation: how many requests, how fast, how long.
--                         Theirs to widen if they want a fuller run.
--   · scope_violation   — the run was about to reach something outside the
--                         authorised scope and stopped. Neither a fault nor a
--                         setting: a question about where the application led.
--
-- The constraint is the part that matters. A run recorded as aborted with no
-- reason is exactly the state this whole change exists to abolish, so the
-- database refuses it in both directions: aborted implies a reason, and a
-- reason implies aborted. It also means a stopped run cannot be quietly
-- relabelled as `awaiting_review` while keeping the reason it stopped — it
-- would have to first say it had not stopped. Approval was already refused by
-- the transition trigger above it, which insists on `awaiting_review` first;
-- this constraint is a second lock on the same door, not the first.
-- =============================================================================

create type public.assessment_stop_reason as enum (
  'cost_ceiling',
  'intensity_ceiling',
  'scope_violation'
);

alter table public.assessments
  add column stop_reason public.assessment_stop_reason;

alter table public.assessments
  add constraint assessments_stop_reason_matches_status
  check ((status = 'aborted') = (stop_reason is not null));

comment on column public.assessments.stop_reason is
  'Why a deliberately stopped run stopped. Set exactly when status is aborted. '
  'A stop is not a failure: what was assessed before it still stands, and the '
  'reason decides whether anything is the customer''s to act on.';

create index assessments_stopped_idx on public.assessments (organisation_id, stop_reason)
  where stop_reason is not null;
