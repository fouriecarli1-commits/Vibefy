# Milestone status

Build order is fixed by PART 2 of the brief. A milestone is not complete until every item in
PART 10 passes. **Do not start M1 until the founder confirms M0.**

## M0 — Foundations · complete, with two items honestly outstanding

| Definition of Done                                                                          | Status                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Works end-to-end locally with one command                                                | ✅ `pnpm dev`. ⚠️ No deployed preview yet — blocked on the domain and hosting accounts (see `OPEN_ITEMS.md`)                                                                     |
| 2. Tests pass, including payments, badge integrity, authorisation-to-test and personal data | ✅ 159 tests, all four areas covered                                                                                                                                             |
| 3. The independence test passes                                                             | ✅ Identical apps, opposite wallets, byte-identical scores                                                                                                                       |
| 4. RLS verified — user A cannot read user B's app, assessment, report or badge              | ✅ Asserted per table against a real Postgres                                                                                                                                    |
| 5. No secrets in the repo; scanner clean                                                    | ✅ Also runs as a pre-commit hook, and covers untracked files                                                                                                                    |
| 6. Legal artefacts drafted, versioned, surfaced in-product, acceptance recorded             | ✅ 14 drafts, hashed, published at `/legal`, acceptance written to the append-only `consents` table                                                                              |
| 7. `DECISIONS.md`, `OPEN_ITEMS.md` and the runbook updated                                  | ✅ 26 decisions recorded                                                                                                                                                         |
| 8. Cost per run recorded and visible on the internal dashboard                              | ⚠️ `cost_records`, the generated total and the `daily_spend` / `assessment_cost` views exist. The dashboard that reads them lands in M1, alongside the first run that has a cost |

### What M0 built

- **Database:** 21 tables, RLS enabled and forced on every one, policies written in the same
  migration as the table they protect. Five append-only evidence tables. Three product
  guarantees enforced by trigger, not only by application code.
- **Rubric:** v1.0.0 as versioned data — six weighted dimensions, 42 evidence-bound criteria,
  three gates. Scoring receives a type that structurally cannot carry commercial data.
- **Brand:** one geometry source generating nine SVG masters, raster exports and app icons.
  Four badge states, three of which say in words that the app is not currently verified.
- **Web:** Next.js console with sign-up, sign-in, a protected console, the public methodology
  page rendered from the same rubric data the scorer uses, and the legal library.
- **Gates:** secret scan, copy lint, contrast, brand, stubs, legal registry — all blocking.

### What M0 deliberately did not build

The assessment engine, payments, the badge issuer, monitoring, agency surfaces, the mobile app,
the directory and the marketing arm. M1 to M3 is the product that can take money; M5 to M8 are
the parts to slip if anything slips.

## M1 — Assessment engine · complete, with the container image outstanding

| Definition of Done                                             | Status                                                                                                                                             |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Works end-to-end locally with one command                   | ✅ `pnpm dev` plus `pnpm dev:worker`. ⚠️ Still no deployed preview                                                                                 |
| 2. Tests pass, including the four mandatory areas              | ✅ 259 tests. The engine is proven against a deliberately flawed fixture app, not a mock                                                           |
| 3. The independence test passes                                | ✅ Unchanged, and the scoring input still structurally cannot carry commercial data                                                                |
| 4. RLS verified                                                | ✅ Extended to `finding_evidence`                                                                                                                  |
| 5. No secrets in the repo                                      | ✅ Scanner now covers untracked files and requires a reason on every suppression                                                                   |
| 6. Legal artefacts surfaced with acceptance recorded           | ✅ The authorisation warranty is accepted in-product, with version, hash, IP and user agent, in an append-only row                                 |
| 7. Docs updated                                                | ✅ 40 decisions recorded                                                                                                                           |
| 8. Cost per run recorded and visible on the internal dashboard | ✅ `/admin/costs` — cost per run by depth against the price of the tier it serves, daily spend against the global cap, and the most expensive runs |

### What M1 built

- **The scope boundary.** Host allowlist with exclusions winning, a non-destructive method
  ceiling, request/rate/wall-clock ceilings that kill the run, resolved-address checking against
  private ranges and cloud metadata, and manual redirect handling. Enforced in-process as an
  undici dispatcher and on Playwright's route handler, so requests the page's own JavaScript
  makes are bounded too.
- **Six stages.** Static intake (no model, no network), deterministic checks (transport,
  headers, cookies, CORS, exposure, credentials, accessibility, mobile layout), functional
  exploration, the adversarial pass, store readiness, and synthesis.
- **Evidence enforcement in code.** A finding citing an id we did not mint is dropped before it
  can reach a report, and the drop is recorded.
- **Ownership verification** by DNS TXT or well-known file, constant-time compared, with the
  authorisable scope derived from what was actually verified.
- **Intake screening** that clears legitimate apps which merely sound alarming, defers to a human
  when the description is too thin, and never fails open.
- **The reviewer queue**, where approval, adjustment and rejection each write an append-only row
  with a reason before the assessment moves — because the database refuses the move without one.
- **The worker**, on pg-boss, checking the authorisation gate at dispatch and again before writing.

### Outstanding from M1

The **sandbox container image** — an ephemeral machine with a default-deny egress policy — is a
deployment artefact and is blocked on the hosting decision. The in-process guard is built and
tested; it is the inner half of that boundary, not a replacement for it.

## M2 — Reports & payments · complete, blocked only on a Stripe account

| Definition of Done                                   | Status                                                                                                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Works end-to-end locally with one command         | ✅ `pnpm dev` plus `pnpm dev:worker`. ⚠️ Still no deployed preview                                                                                  |
| 2. Tests pass, including the four mandatory areas    | ✅ 325 tests. Payments now have their own suite, run against a fake that signs with a real HMAC                                                     |
| 3. The independence test passes                      | ✅ Extended: `packages/rubric` may not depend on `@vibefy/billing`, `@vibefy/report` or `stripe`, and a report renders the same score at both tiers |
| 4. RLS verified                                      | ✅ Extended to `assessment_requests` and `billing_events`                                                                                           |
| 5. No secrets in the repo                            | ✅                                                                                                                                                  |
| 6. Legal artefacts surfaced with acceptance recorded | ✅ The refund policy is summarised on the billing page and linked in full                                                                           |
| 7. Docs updated                                      | ✅ 55 decisions recorded                                                                                                                            |
| 8. Cost per run recorded and visible                 | ✅ Unchanged, and the per-run ceiling now comes from the customer's entitlement                                                                     |

### What M2 built

- **The report**, as a self-contained HTML document that is also what gets printed to PDF.
  Score, dimension breakdown, findings with evidence hashes, a prioritised remediation order,
  and — at every tier — the scope statement and what was not assessed.
- **Tier redaction that cannot leak.** A free report shows the same score and the same dimension
  breakdown; evidence and remediation are stripped from the objects, not hidden by the template.
- **Entitlements** deciding depth, report tier, PDF, badge eligibility, the free tier's 90-day
  cooling-off period and re-test credits — and nothing else. An unauthorised target is refused on
  every plan.
- **Stripe** via hosted Checkout, Billing and Tax, behind a provider interface with a signing
  fake. No card field exists anywhere in this repository.
- **Webhooks** that verify the raw body, record before acting, and are idempotent by database
  constraint.
- **A visible queue.** `assessment_requests` is claimed with `FOR UPDATE SKIP LOCKED`; the
  customer can watch their own request and cancel it, and the refusal reason is stored.
- **A self-healing report sweep** that also regenerates the full report when a customer upgrades
  after reading the free one — same findings, same evidence, same score.

### Outstanding from M2

A **Stripe account with four price ids** and a registered webhook endpoint. The integration is
built and tested; it has never spoken to Stripe, because there is nothing to speak to yet.
**Object storage** for rendered reports is still local disk, which is a deployment decision.

## M3–M8 — not started

See PART 2 of the build brief.
