-- =============================================================================
-- A review row authorises the transition it actually describes.
--
-- `public.assert_human_review` is Gate 3. It is the reason the public
-- verification page is allowed to say "a person read the result before anything
-- was issued", and it stands in front of every badge this product will ever put
-- on somebody's website. What it checked was weaker than what it claimed:
--
--     if not exists (
--       select 1 from public.reviews r
--       where r.assessment_id = new.id
--         and r.created_at >= now() - interval '1 hour'
--     )
--
-- Any review row, of any action, within the hour. The `action` column — the
-- column whose entire job is to record what the human decided — was never read,
-- so the gate was satisfied by a review that said the opposite of the transition
-- it admitted:
--
--   · A row saying `rejected` authorised `status = 'approved'`. The assessment
--     then carried an approval whose only recorded human decision was a
--     rejection, with the reviewer's written reason for rejecting it attached.
--   · A row saying `adjusted` did the same, and that one happened on its own.
--     `adjustAssessment` in `apps/web/app/review/actions.ts` writes an
--     `adjusted` row on every score correction and then updates only
--     `overall_score`, leaving the assessment in `awaiting_review` — so each
--     adjustment minted an approval token that stayed valid for an hour.
--
-- Neither needs anybody to act in bad faith. Both server actions write the
-- review row and then update the assessment in two separate statements with no
-- transaction around them, and `public.reviews` is append-only, so a refused
-- update leaves behind a committed row that cannot be withdrawn. The hour-long
-- window turned that orphan into an authorisation for whatever came next.
--
-- ## What is deliberately not changed
--
-- **The hour.** It is an existing decision about how long a reviewer's reading
-- stays current, and it was not the defect.
--
-- **The `awaiting_review` precondition.** Unchanged, and it is what keeps a
-- stale-but-matching row from being reused: one successful transition moves the
-- assessment out of `awaiting_review`, and the next one is refused there.
--
-- **Who presses the button.** The trigger does not require the review row's
-- reviewer to be the session user. `auth.uid()` is null when an operator
-- corrects a stuck row on the owning connection, so requiring a match would
-- refuse the only path that exists to unstick anything. Who decided is recorded
-- in the row; whether it was the same person who ran the update is a separate
-- question, and it is in docs/OPEN_ITEMS.md rather than decided here.
--
-- Watched failing before it was written: tests/a-review-authorises-its-own-
-- transition.test.ts, four failures on the four opposite-action combinations.
-- =============================================================================

create or replace function public.assert_human_review()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status in ('approved', 'rejected') and old.status is distinct from new.status then
    if old.status <> 'awaiting_review' then
      raise exception 'Assessment % must pass through awaiting_review before %', new.id, new.status
        using errcode = 'restrict_violation';
    end if;

    -- The action has to match the transition. Compared as text because the two
    -- enums are different types that happen to share these two words:
    -- `review_action` is ('approved', 'adjusted', 'rejected') and
    -- `assessment_status` carries 'approved' and 'rejected' among others. A cast
    -- between them would silently stop matching the day either gains a member.
    if not exists (
      select 1 from public.reviews r
      where r.assessment_id = new.id
        and r.action::text = new.status::text
        and r.created_at >= now() - interval '1 hour'
    ) then
      raise exception
        'Assessment % cannot be % without a recorded human review action of %',
        new.id, new.status, new.status
        using errcode = 'restrict_violation',
              hint = 'Insert the review row first, with its action matching the transition. AI never certifies alone, and a rejection is not an approval.';
    end if;
  end if;
  return new;
end;
$$;
