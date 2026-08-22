# Milestone status

Build order is fixed by PART 2 of the brief. A milestone is not complete until every item in
PART 10 passes. **Do not start M1 until the founder confirms M0.**

## M0 — Foundations · complete, with two items honestly outstanding

| Definition of Done | Status |
|---|---|
| 1. Works end-to-end locally with one command | ✅ `pnpm dev`. ⚠️ No deployed preview yet — blocked on the domain and hosting accounts (see `OPEN_ITEMS.md`) |
| 2. Tests pass, including payments, badge integrity, authorisation-to-test and personal data | ✅ 159 tests, all four areas covered |
| 3. The independence test passes | ✅ Identical apps, opposite wallets, byte-identical scores |
| 4. RLS verified — user A cannot read user B's app, assessment, report or badge | ✅ Asserted per table against a real Postgres |
| 5. No secrets in the repo; scanner clean | ✅ Also runs as a pre-commit hook, and covers untracked files |
| 6. Legal artefacts drafted, versioned, surfaced in-product, acceptance recorded | ✅ 14 drafts, hashed, published at `/legal`, acceptance written to the append-only `consents` table |
| 7. `DECISIONS.md`, `OPEN_ITEMS.md` and the runbook updated | ✅ 26 decisions recorded |
| 8. Cost per run recorded and visible on the internal dashboard | ⚠️ `cost_records`, the generated total and the `daily_spend` / `assessment_cost` views exist. The dashboard that reads them lands in M1, alongside the first run that has a cost |

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

## M1 — Assessment engine · not started

Intake → authorisation-to-test verification → sandboxed runner → Claude analysis → rubric
scoring → report object → human reviewer queue. Plus the cost dashboard from item 8 above.

The database gate is already in place: `assessments` cannot be inserted without a verified,
unexpired authorisation for that app. M1 builds the flows that produce one — DNS TXT records,
well-known files, verified email domains and repository OAuth — and the sandbox that enforces
the declared scope at network level.

## M2–M8 — not started

See PART 2 of the build brief.
