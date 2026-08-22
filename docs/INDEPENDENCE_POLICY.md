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

## What a customer may and may not do

- **May:** decline to publish a report, dispute a finding through the appeals process, request a
  re-test after remediation, opt out of the directory entirely while remaining certified.
- **May not:** purchase a score change, purchase suppression of a finding, purchase a delay to a
  badge suspension, or purchase preferential organic ordering.

## Conflicts of interest

Anyone performing human review must declare any commercial, employment or ownership relationship
with an app under review, and must recuse themselves. Declarations are kept for the life of the
business.
