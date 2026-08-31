-- =============================================================================
-- 0020 — Games are a different thing to test
--
-- Anré asked for a way in that is specifically for games, and for games to be
-- tested as games. Both halves matter, and the second is the one that could
-- have been faked: a button that leads to the same assessment with a different
-- heading would be marketing wearing the clothes of a product.
--
-- A game is not a *kind of target* — it is a web URL or a mobile build like
-- anything else, reached the same way, authorised the same way. It is a kind of
-- *product*, whose characteristic failures are not the ones the general
-- assessment goes looking for. A vibe-coded game most often fails by never
-- reaching a playable state, by loading forty megabytes before it can start, by
-- being unplayable on the phone most of its players will open it on, or by
-- silently losing a save. None of those are what "does the primary flow
-- complete" makes you look at unless you are told to.
--
-- So this is a flag on the app, not a value in `app_type`. Adding a fourth
-- app_type would have meant a game could no longer also be a mobile build, and
-- would have put a product category in a column that answers "how do we reach
-- it".
--
-- What this flag does NOT do is change the rubric. Findings from the game stage
-- cite the same published criteria as everything else — a game that never
-- becomes playable fails FI-01 exactly as an application that never completes
-- its primary journey does. The criteria that have no home in rubric 1.0.0 —
-- age ratings, purchase disclosure, input modality — are named in
-- docs/OPEN_ITEMS.md as belonging to a future rubric version, because the
-- alternative is a report citing a rule id the published rubric does not
-- define, and a score that cannot be checked against the thing it claims to
-- come from.
-- =============================================================================

alter table public.apps
  add column is_game boolean not null default false;

comment on column public.apps.is_game is
  'Whether this is a game. Changes which assessment stage runs and what it '
  'looks for; it does not change the rubric, the score, or the badge. Set by '
  'the owner when the application is registered.';

create index apps_games_idx on public.apps (organisation_id) where is_game;

-- The stage the pipeline records for a game pass.
--
-- `run_stage` is a closed set, which is the point: a stage name that could be
-- any string is a stage name that will be two spellings by the time anybody
-- queries it. Placed after `store_readiness` to match the order the pipeline
-- runs them in, so a reader of the enum sees the sequence.
alter type public.run_stage add value if not exists 'game_experience' after 'store_readiness';
