# Rating Methodology & Independence Policy

> **DRAFT — REQUIRES REVIEW BY QUALIFIED COUNSEL IN [JURISDICTION] BEFORE USE.**
> Not legal advice. Not a substitute for a lawyer. Unlike the other documents here, this one is
> intended to be **published in full** — it is the source of the mark's credibility.

**Version:** 1.0.0-draft · **Status:** not in force · **Baseline:** GDPR-grade

---

## 1. The rubric is public

The full rubric — dimensions, weights, criteria, evidence requirements, bands, gates and the
certification threshold — is published at `/methodology` and versioned in this repository.
Every report and every badge names the exact rubric version used. **A rubric change never
retroactively alters a score that has already been issued**, and material changes are announced
with notice before they take effect.

## 2. How a score is reached

Each of the six dimensions starts at 100. Every published finding subtracts its severity
penalty, scaled by a confidence multiplier. Dimension scores are clamped to 0–100 and combined
by weight. **Gates are applied last and can only lower a result** — a single critical security
or privacy finding caps the overall score below the certification threshold regardless of how
strong the other dimensions are.

## 3. What payment does and does not buy

Payment buys **depth of assessment, re-testing, monitoring and support**.

Payment does not buy a score, the suppression of a finding, a delay to a badge suspension, or
preferential placement in any listing. This is not a promise about our conduct; it is a
property of how the system is built:

- The scoring function receives a data structure that **has no field** for a plan, a price, a
  spend, a marketing relationship or an account age. A build-time assertion fails compilation
  if such a field is ever added.
- Our test suite constructs a maximally-paying customer with an active marketing-services
  contract and a free-tier customer, gives them identical applications and identical evidence,
  and asserts that their scores are **identical**. That test failing blocks every change.
- Cost and margin data is not readable by reviewers. A reviewer with a commercial signal in
  front of them is not an independent reviewer.

## 4. Human review and overrides

Every assessment is reviewed by a human before publication and before any badge issues. A
reviewer may confirm, adjust or reject. **Adjustments require a written reason**, and are stored
in an append-only log with the reviewer's identity, the previous scores and the new scores. The
database rejects an override with no reason. Reviewers must declare and recuse themselves from
any application in which they have a commercial, employment or ownership interest.

## 5. Disclosure of paid relationships

Any customer who has purchased marketing services from us is **labelled as such wherever their
rating appears**, including on the verification page and, from the point the directory exists,
on their listing. If paid placement is ever introduced in the directory, it will be visually
and textually labelled as advertising and will never alter organic ordering.

## 6. What a customer may do

You may decline to publish a report, appeal a finding, request a re-test after remediation, and
opt out of any public listing entirely while remaining certified. You may not purchase a change
to a score.

## 7. Refusal and revocation

We may refuse to assess or decline to certify. We may revoke a badge. In each case we state a
reason and the Appeals & Corrections Policy applies.
