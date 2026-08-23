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

| Definition of Done                                   | Status                                                                                                                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Works end-to-end locally with one command         | ✅ `pnpm dev` plus `pnpm dev:worker`. ⚠️ Still no deployed preview                                                                                          |
| 2. Tests pass, including the four mandatory areas    | ✅ 325 tests. Payments now have their own suite, run against a fake that signs with a real HMAC                                                             |
| 3. The independence test passes                      | ✅ Extended: `packages/rubric` may not depend on `@vibefycode/billing`, `@vibefycode/report` or `stripe`, and a report renders the same score at both tiers |
| 4. RLS verified                                      | ✅ Extended to `assessment_requests` and `billing_events`                                                                                                   |
| 5. No secrets in the repo                            | ✅                                                                                                                                                          |
| 6. Legal artefacts surfaced with acceptance recorded | ✅ The refund policy is summarised on the billing page and linked in full                                                                                   |
| 7. Docs updated                                      | ✅ 55 decisions recorded                                                                                                                                    |
| 8. Cost per run recorded and visible                 | ✅ Unchanged, and the per-run ceiling now comes from the customer's entitlement                                                                             |

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

## M3 — Badge system · complete

| Definition of Done                                   | Status                                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1. Works end-to-end locally with one command         | ✅ `pnpm dev` plus `pnpm dev:worker`. ⚠️ Still no deployed preview, and the `verify.` subdomain is a deployment concern   |
| 2. Tests pass, including the four mandatory areas    | ✅ 368 tests. Badge integrity now has 43 of its own, covering forgery, tampering, rotation and every lifecycle transition |
| 3. The independence test passes                      | ✅ Unchanged                                                                                                              |
| 4. RLS verified                                      | ✅ The public verification surface is a view granted to `anon`; the `badges` table itself stays closed                    |
| 5. No secrets in the repo                            | ✅ The signing key is generated to stdout and never to a file                                                             |
| 6. Legal artefacts surfaced with acceptance recorded | ✅ The Badge Licence is accepted in-product, append-only, with version, hash, IP and user agent                           |
| 7. Docs updated                                      | ✅ 68 decisions recorded                                                                                                  |
| 8. Cost per run recorded and visible                 | ✅ Unchanged                                                                                                              |

### What M3 built

- **Ed25519 signing** over a fixed, published canonicalisation. A third party verifies a badge
  offline with any JOSE library, against a JWKS at `/.well-known/vibefycode-badge-key`.
- **The distinction the scheme rests on**, written into the payload, the API response and the
  checker page: the signature attests that the assessment happened and scored what it says —
  a fact that survives revocation — and says nothing about whether the badge is live.
- **The badge image, rendered on every request** from our origin, cached five minutes. There is
  no file to copy, which is what makes revocation take effect within minutes.
- **Four states that are never a broken image.** Suspended, expired and revoked all render as a
  legible "not currently verified" mark, visually distinct from the certification mark.
- **The verification page**, with the scope-and-limitations block above the fold — before the
  score — and the marketing-client disclosure where one applies.
- **A public checker** at `/verify` that answers the two questions separately, because
  conflating them is the whole failure mode.
- **Issuance behind three gates**: a human approved it, the rubric gate passed, and the owner
  accepted the trademark licence at its current version. None can be bought.
- **Lifecycle sweeps** that expire and suspend, plus a database function that reports an expired
  badge as expired whatever the stored column says.
- **Origin telemetry** capped at one event per badge, per origin, per hour, surfaced to reviewers
  as mismatches — a badge requested from a domain it is not licensed for.
- **One renderer** for the runtime badge and the brand masters, so the mark on a customer's site
  and the mark in our header cannot drift apart.

### Outstanding from M3

The **`verify.` subdomain** in production — the routes exist and work; host-based routing is a
deployment concern blocked on the domain decision. A **bulk re-signing script** for the
compromise path: planned rotation is covered by retired keys, and the runbook says plainly that
the compromise path is not automated yet.

## M4 — Continuous monitoring ✅

| Gate                                                             | Status                                                                                                         |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1. `pnpm verify` green                                           | ✅ 417 tests, six gates                                                                                        |
| 2. Tests for money, badges, authorisation-to-test, personal data | ✅ Drift and regression are badge tests: 26 unit cases and 18 against the database                             |
| 3. Every AI-written claim evidence-bound                         | ✅ Unchanged — monitoring adds no model calls                                                                  |
| 4. RLS verified                                                  | ✅ `drift_reports` and `alerts` are member-scoped; the only writable column for a customer is `alerts.read_at` |
| 5. No secrets in the repo                                        | ✅ Unchanged                                                                                                   |
| 6. Legal artefacts surfaced with acceptance recorded             | ✅ Unchanged                                                                                                   |
| 7. Docs updated                                                  | ✅ 85 decisions recorded                                                                                       |
| 8. Cost per run recorded and visible                             | ✅ A scheduled re-assessment carries the same per-run ceiling as a requested one                               |

### What M4 built

- **`packages/monitoring`** — the whole verdict, with no database access: what changed between two
  assessments, and whether the change is bad enough to take a badge down. Every rule is data and
  carries the sentence the customer is shown.
- **The same commercial-data ban as scoring**, enforced at compile time. Suspension cannot see a
  plan, a price or a marketing relationship, and a source-scan test keeps the cadence table out of
  the verdict modules.
- **`drift_reports`**, append-only, with a check constraint that makes "we suspended it and cannot
  say why" unrepresentable.
- **Four sweeps in the worker**: compare each finished assessment against its predecessor, queue
  due re-assessments, ping certified origins, and warn before a badge expires. All idempotent —
  a drift report is unique per assessment, an alert is unique per dedupe key, and a re-assessment
  stamps the application before it runs.
- **Automatic suspension on a material regression**, with the reasons written down at the moment
  the decision was made, and a matching alert quoting them in full.
- **Liveness with a run threshold and automatic restore**, so one timeout costs nothing and a
  recovery needs no support ticket — while leaving a reviewer's suspension exactly where they put
  it.
- **A separate `suspension_reason`**, because a customer whose site was down for six hours should
  not be told their badge was revoked.
- **The console surfaces**: score over time, the last comparison in full — new, resolved and
  unchanged findings — an alert inbox, and a monitoring switch on each application.

### Outstanding from M4

**Alert delivery outside the console.** `alerts.delivered_at` and `delivery_channel` exist and are
never set: there is no email sender yet, so an alert is only seen by someone who logs in. The
column is there so that adding a sender later is a sweep, not a migration.

**The liveness probe does not go through the scope guard.** It is a single GET to the badge's own
certified origin, which is narrower than any authorised scope, but it uses `fetch` directly rather
than the guarded dispatcher. Registered in OPEN_ITEMS.md.

## M5 — Agency & organisation surfaces ✅

| Gate                                                             | Status                                                                                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1. `pnpm verify` green                                           | ✅ 456 tests, six gates                                                                                                        |
| 2. Tests for money, badges, authorisation-to-test, personal data | ✅ Seats, invitation tokens, workspace isolation and what an audit export may not contain                                      |
| 3. Every AI-written claim evidence-bound                         | ✅ Unchanged                                                                                                                   |
| 4. RLS verified                                                  | ✅ Five new tables, all forced; invitations are admin-only, exports are admin-only, the portfolio is a `security_invoker` view |
| 5. No secrets in the repo                                        | ✅ Only invitation token _hashes_ are stored, and no identity-provider certificate ever reaches us                             |
| 6. Legal artefacts surfaced with acceptance recorded             | ✅ Unchanged                                                                                                                   |
| 7. Docs updated                                                  | ✅ 103 decisions recorded                                                                                                      |
| 8. Cost per run recorded and visible                             | ✅ Unchanged                                                                                                                   |

### What M5 built

- **Shared workspaces** — agency and organisation types alongside the personal one every
  account gets. The creator is its owner from the moment it exists, and a trigger refuses to
  leave one without an owner.
- **Seats, enforced in the database** on both memberships and invitations, so no path — including
  a future single-sign-on one — can walk past the limit. An unaccepted invitation holds a seat.
- **Invitations as credentials**: CSPRNG token, only the hash stored, seven-day expiry,
  constant-time comparison, and the signed-in address checked as well as the token.
- **`packages/policy`** — an organisation's own bar, applied over a finished score. It can fail
  an application the rubric passed; the evaluation type structurally cannot carry a score, and a
  test asserts the report fingerprint is identical with and without a profile attached.
- **White-label reports** — the agency's cover block, with the sentence that keeps a handover
  report from reading as the agency's own verification of its own work. Their accent colour is
  used only where it passes contrast.
- **Audit export** — six exports, each scoped by the caller's own row-level security, each
  recorded with the hash of exactly what was handed over in an append-only table. IPs truncated
  to their network, no email address anywhere, and CSV formula injection defused.
- **Single sign-on** — domain claimed, proved by DNS TXT, unique platform-wide, enforceable only
  once verified. The sign-in page routes through one `security definer` function that answers
  one question and reveals nothing else.
- **The portfolio dashboard** — every application in every workspace you belong to, with its
  score, badge state, monitoring state and policy verdict.

### Outstanding from M5

**Identity-provider registration is manual.** The domain claim, verification, enforcement and
sign-in routing are all built; registering the SAML or OIDC provider itself with the auth service
is an operator step, and the console says so rather than implying otherwise.

**Invitation emails are not sent.** The link is shown once to the inviter to pass on, and the
console states plainly that we do not send it. Same underlying gap as monitoring alerts: there is
no email sender yet.

**The portfolio evaluates a profile without findings.** A severity ceiling is checked on the
report, which has the findings; the dashboard row does not carry them, so it evaluates the
score-and-dimension rules only. Registered in OPEN_ITEMS.md.

## M6 — Native mobile app ✅

| Gate                                                             | Status                                                                                                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `pnpm verify` green                                           | ✅ 472 tests, six gates, ten workspace projects typechecked                                                                                       |
| 2. Tests for money, badges, authorisation-to-test, personal data | ✅ The one write that spends money checks the authorisation gate before it queues; push delivery is tested for scope, duplication and dead tokens |
| 3. Every AI-written claim evidence-bound                         | ✅ Unchanged                                                                                                                                      |
| 4. RLS verified                                                  | ✅ A device token belongs to one person and only that person; delivery records are platform-only and append-only                                  |
| 5. No secrets in the repo                                        | ✅ The app ships the anon key and nothing else — no service-role key ever reaches a phone                                                         |
| 6. Legal artefacts surfaced with acceptance recorded             | ✅ There is no mobile sign-up, precisely so consent is recorded where the wording is shown in full                                                |
| 7. Docs updated                                                  | ✅ 118 decisions recorded                                                                                                                         |
| 8. Cost per run recorded and visible                             | ✅ A re-test requested from a phone carries the same per-run ceiling as one requested in the console                                              |

### What M6 built

- **`packages/api`** — one client, two front ends. The phone talks to the same database, through
  the same anon key, under the same row-level security as the console. There is no mobile API.
- **An Expo Router app** with five screens: applications, alerts, account, one application, one
  report — plus adding an application. Read-and-monitor first, as the brief asks.
- **An explicit boundary**, listed on the Account tab: ownership verification, badge licence
  acceptance, billing and workspace administration are console-only, and the app says why.
- **The same single-sign-on domain check** on mobile sign-in as on the web, because a second front
  end is exactly where an enforcement rule gets forgotten.
- **Push notifications** — `warning` and `critical` only, one delivery row per alert per device,
  dead tokens disabled rather than retried, an outage retried rather than recorded as a loss, and
  the alert stamped `delivered_at`/`delivery_channel` so the console can say we told you and how.
- **Mobile icons and splash** built by `pnpm brand:build` from the same masters as the favicon and
  the badge.

### Outstanding from M6

**EAS build and store submission are not configured.** The app runs in Expo Go and in a
development build; `eas.json`, the credentials and the store listings are an account-level step
that needs the bundle identifier and the Apple/Google accounts, which follow the entity decision.

**Email alerts are still not sent.** M6 closes the delivery gap for people who install the app;
`alerts.delivered_at` stays null for everyone else. Still registered in OPEN_ITEMS.md.

## M7 — Public directory ✅

| Gate                                                             | Status                                                                                                                                                    |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `pnpm verify` green                                           | ✅ 495 tests, six gates                                                                                                                                   |
| 2. Tests for money, badges, authorisation-to-test, personal data | ✅ Ordering is asserted identical with and without a paid relationship; the public view is asserted to expose nothing beyond the verification page        |
| 3. Every AI-written claim evidence-bound                         | ✅ Unchanged                                                                                                                                              |
| 4. RLS verified                                                  | ✅ The listing table is member-only; the directory view is the one thing `anon` may read, and it exposes only published columns                           |
| 5. No secrets in the repo                                        | ✅ Unchanged                                                                                                                                              |
| 6. Legal artefacts surfaced with acceptance recorded             | ✅ The Badge Licence gained a directory clause and bumped to 1.1.0-draft; the console now asks for re-acceptance rather than carrying the old one forward |
| 7. Docs updated                                                  | ✅ 129 decisions recorded                                                                                                                                 |
| 8. Cost per run recorded and visible                             | ✅ Unchanged                                                                                                                                              |

### What M7 built

- **`packages/directory`** — search, ordering and disclosure, with the same structural guard as
  scoring. The comparator receives four fields and the marketing-client flag is not among them,
  so placement cannot be bought even by mistake.
- **A derived listing.** The public view joins `badge_effective_status`, so a suspended, expired
  or revoked badge removes its listing in the same instant it changes the verification page.
  There is no stored flag to go stale and no cache to invalidate.
- **Opt-out that means it** — one control, immediate, and certification untouched, which is what
  the Badge Licence now promises in writing. Every change of mind is kept in an append-only table.
- **One disclosure, one wording**, in `@vibefycode/shared`, used by both the verification page and the
  listing. PART 8.1 requires it wherever a rating is displayed.
- **A Badge Licence clause** covering listing, what it shows, the opt-out, the disclosure and the
  no-paid-placement rule — which bumped the version and invalidated existing acceptances, because
  publishing someone's score is a material change to what they agreed to.
- **A real bug fixed on the way**: the licence version in force was a constant hardcoded beside
  the document. Bumping one would have silently stopped badge issuance for ever. It now comes
  from the generated registry, and the console compares what a customer accepted with what is
  actually in force.

### Outstanding from M7

**Nothing is listed until something is certified.** That is the cold-start the brief warned about,
and it is why M7 comes seventh rather than second. No code change makes it go away.

**No paid placement exists, and none is built.** If it is ever introduced it must be labelled as
advertising, visually and in words, and kept out of the organic ordering — the Badge Licence and
the ordering note both say so, and the type system would need changing to allow it.

## Governance operations — closing what the schema only promised ✅

Not a numbered milestone. Four things the brief specifies that earlier milestones recorded the
_intent_ of and nothing carried out. They are listed here because a promise with no mechanism
behind it is the thing this whole product exists to find in other people's software — and two of
them were being claimed, in writing, in the published privacy notice.

| Gate                                                             | Status                                                                                                                                                      |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `pnpm verify` green                                           | ✅ 525 tests, six gates                                                                                                                                     |
| 2. Tests for money, badges, authorisation-to-test, personal data | ✅ Personal data is the whole of this: retention deletion, data-subject rights, and the privacy of both                                                     |
| 3. Every AI-written claim evidence-bound                         | ✅ Unchanged                                                                                                                                                |
| 4. RLS verified                                                  | ✅ A spend pause is platform-only; a deletion record is visible to the workspace it belongs to; a data-subject request is private to the person who made it |
| 5. No secrets in the repo                                        | ✅ Unchanged                                                                                                                                                |
| 6. Legal artefacts surfaced with acceptance recorded             | ✅ No document changed — what changed is that two of their claims became true                                                                               |
| 7. Docs updated                                                  | ✅ 142 decisions recorded                                                                                                                                   |
| 8. Cost per run recorded and visible                             | ✅ The dashboard now shows the ceilings and whether one has stopped anything                                                                                |

### What it built

- **The global daily spend cap** (PART 9). The per-run ceiling existed; a runaway loop across a
  thousand cheap runs hit nothing. The pause is a row, so restarting the worker does not lift it;
  a partial unique index means two workers crossing the line produce one pause; the lift is manual
  and needs a written reason; and a paused platform defers queued work rather than failing it.
- **Retention deletion** (PART 8.2). Every evidence artefact has carried a `retention_until` since
  M1 and nothing had ever acted on one. The record of the deletion is written before the deletion,
  keeps the hash and not the artefact, and is append-only.
- **Data-subject rights, in product** (PART 8.2) — access, correction, deletion, portability,
  objection, each with what it actually gets you in the words we will be held to. The deadline
  comes from a database trigger, a completed request is terminal, and a refusal must name its
  lawful basis in both the action and a check constraint.
- **The appeals route** (PART 3), with a fourteen-day deadline, a reviewer queue, and written
  reasons required for every outcome including a rejection.

## Hardening — the egress path, the bounce path, and one test that walks the whole thing

Not a numbered milestone. Three defects and one gap, found by asking what happens in the seams
between milestones rather than inside any one of them.

| Gate                                                             | Status                                                                                                                                  |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `pnpm verify` green                                           | ✅ 612 tests, nine gates — `format:check` is now one of them                                                                            |
| 2. Tests for money, badges, authorisation-to-test, personal data | ✅ The journey test covers three of the four in one run; the fourth is unchanged                                                        |
| 3. Every AI-written claim evidence-bound                         | ✅ Unchanged, and now asserted end-to-end: every published finding in the journey run carries evidence                                  |
| 4. RLS verified                                                  | ✅ Unchanged. The webhook writes as the service role to one table nobody else can write                                                 |
| 5. No secrets in the repo                                        | ✅ The test signing secrets are assembled at runtime rather than written down, because a scanner cannot tell a fake one from a real one |
| 6. Legal artefacts surfaced with acceptance recorded             | ✅ No document changed                                                                                                                  |
| 7. Docs updated                                                  | ✅ 202 decisions recorded                                                                                                               |
| 8. Cost per run recorded and visible                             | ✅ Unchanged                                                                                                                            |

### What it built

- **The address check, actually switched on.** `ScopeGuard.check` reads a URL. The half of scope
  enforcement a URL cannot answer — what the host resolves to — lived only in an undici dispatcher
  installed by a method nothing ever called. An authorised host whose A-record points at
  `169.254.169.254` passed every check made against its URL. The engine's HTTP client, the liveness
  probe and the ownership check now each carry a scoped dispatcher on the request itself.
- **Bounce and complaint ingestion.** `POST /api/email/webhook`, verified before parsing, a 400 for
  anything unproven, a 404 when unconfigured, and idempotent by primary key. Only a permanent bounce
  or a complaint suppresses.
- **`tests/journey.test.ts`.** One application from a signature on a warranty to a suspended badge,
  in order, through the tables a customer would touch. It states where it is not the real code.
- **Invitation email**, sent at the point of invitation, because the link exists in memory for one
  request and nowhere else.

## M8 — not started

Blocked, per PART 2, on M7 being live and on the independence policy in PART 8 being implemented
and documented. The policy is implemented (`docs/INDEPENDENCE_POLICY.md`, enforced by
`tests/independence.test.ts`, `tests/directory.test.ts` and the compile-time boundaries in
`packages/rubric`, `packages/monitoring`, `packages/policy` and `packages/directory`). What
remains is a live directory, which needs paying customers rather than code — and the cold-start
argument in PART 11 is exactly the reason not to build a marketing arm against an empty one.
