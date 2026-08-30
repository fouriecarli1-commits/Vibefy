# Rating Integrity and Independence Policy

**Status:** internal policy, mirrored publicly at `/methodology`. Enforced by tests, not by good intentions.

## The commitment

Payment buys depth, re-testing, monitoring and support. **Payment never buys a score.**

## How it is enforced in code

1. **Structural separation.** Scoring functions receive a `ScoringInput` type that has no field for
   plan, price, spend, marketing-client status, or account age. It is not that scoring ignores
   commercial data — scoring cannot see commercial data, because the type does not carry it.
2. **The independence test.** CI constructs two accounts with identical apps and identical
   assessment evidence: one on the most expensive plan and an active marketing-services contract,
   one on the free tier. It asserts the two produce byte-identical rubric scores. This test failing
   blocks every merge.
3. **Rubric as versioned data.** Scores are computed from `/packages/rubric/versions/*.json`, not
   from code paths that could branch on a customer attribute.
4. **Reviewer overrides are append-only and reasoned.** A human reviewer may adjust a score, but
   the adjustment, the reviewer, the timestamp and a written reason are written to an append-only
   log and are auditable. An override without a reason is rejected by the database.

## Disclosure

- Any customer who has purchased marketing services is **labelled on every public surface** where
  their rating appears: the verification page and, from M7, the directory listing.
- Paid placement, if ever introduced in the directory, must be visually and textually labelled as
  advertising and must never alter organic ordering.
- The methodology, the rubric version history and the certification threshold are public.

## Remediation: being paid to help fix what we found

From 2026-08-26 VibefyCode may be paid to help a customer fix what a report found. This is the
sharpest conflict in the business and it is stated here rather than buried: **a rating service that
sells repairs has a financial interest in finding faults.** That is arithmetic, not an accusation,
and it cannot be answered by promising restraint — the incentive exists whether or not anybody acts
on it.

It is answered by making the influence impossible rather than forbidden. Four separations, each
enforced by something other than good intentions:

1. **The scoring code cannot reach the service.** `packages/rubric` and `packages/engine` may not
   import `@vibefycode/remediation`, may not depend on it, and `tests/remediation-wall.test.ts`
   fails the build if either ever does.
2. **Whoever did the work may not review the result.** A trigger on `public.reviews` refuses the
   insert. Not a checkbox on a form — a reviewer recorded against an engagement is refused however
   they arrive at the decision.
3. **The price never depends on what was found.** Fixed fee or hourly. "Per finding resolved" is
   the obvious pricing and the one that must never exist, so the enum has nowhere to put it, in
   TypeScript and in Postgres both.
4. **It is disclosed wherever the score is shown.** `public.app_has_remediation` answers it for any
   application, and `REMEDIATION_CLIENT_DISCLOSURE` is the one sentence every surface uses.

The offer may not promise an outcome. Whether a score rises is decided by the next assessment, and
anyone promising a number is selling one. Declining the offer changes nothing about an assessment,
a badge, or a place in the review queue.

None of this makes the conflict disappear. It makes it visible and inert, which is the most any
rater who also sells services can honestly claim — and saying that plainly is worth more than a
promise nobody can check.

## What a customer may and may not do

- **May:** decline to publish a report, dispute a finding through the appeals process, request a
  re-test after remediation, opt out of the directory entirely while remaining certified.
- **May not:** purchase a score change, purchase suppression of a finding, purchase a delay to a
  badge suspension, purchase preferential organic ordering, or purchase a review by the person who
  was paid to change the application.

## Conflicts of interest

Anyone performing human review must declare any commercial, employment or ownership relationship
with an app under review, and must recuse themselves. Declarations are kept for the life of the
business.
