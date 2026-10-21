-- BLOK 20 VAN 21 · 20261019120000_where_the_code_came_from.sql
--
-- Een blok, op sy eie. Merk alles (Ctrl+A), kopieer, plak in Supabase se
-- SQL Editor, Run. Loop dit twee keer en niks gebeur die tweede keer.
--
-- Gegenereer uit docs/sql/OUTSTANDING.sql deur tools/outstanding-split.mjs.
-- Moenie hierdie lêer met die hand verander nie; verander die migrasie.

-- Where the code came from, stored beside the assessment that looked.
--
-- GitHub made open-source licence compliance generally available on
-- 2026-10-16, for Enterprise Cloud repositories with Code Security on,
-- enforced by a ruleset that blocks a pull request. Anré asked for the same
-- question to be part of this product two days later, and the people it is for
-- are the ones furthest from an enterprise security budget: an assistant was
-- asked to build something, and what came back carries a starter template, a
-- snippet with somebody's copyright header on it, and a font that was dropped
-- into `public/` because it looked right.
--
-- `packages/engine/src/stages/provenance.ts` reads a clone and reports what is
-- there. This column is where those observations are kept.
--
-- ## Why this is not a finding
--
-- A finding needs a criterion the published rubric defines, and rubric 1.1.0
-- has forty-nine of them and not one about licensing. Attaching these to a
-- criterion would mean a new published version of the standard, and whether a
-- licence answer should cost a score is a decision about what we sell rather
-- than about code — it is in `docs/OPEN_ITEMS.md` and it is the founder's.
--
-- So the observations are stored, rendered in their own section of the report,
-- and are structurally unreachable from anything that computes a score:
-- `scoreAssessment` takes findings, and these are not findings.
--
-- ## Why the default matters
--
-- Every assessment written before this column existed has no observations, and
-- an empty array is the honest value for "nobody looked" here — the engine
-- that would have looked did not exist when those rows were written. The
-- report renders the section only where the array has something in it, so an
-- old assessment reads exactly as it did before.

alter table public.assessments
  add column if not exists provenance jsonb not null default '[]'::jsonb;

comment on column public.assessments.provenance is
  'Observations about licensing and where the code came from: what is in the '
  'repository and what the licence asks, never whether the owner is in breach. '
  'Reported and never scored — nothing on the scoring path can read this.';

-- BLOK 21 VAN 21
