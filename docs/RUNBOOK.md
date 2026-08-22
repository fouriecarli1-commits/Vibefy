# Runbook

How to run, verify, debug and deploy Vibefy. Written for one person with no team to ask.

## Everyday commands

| Command               | What it does                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| `pnpm dev`            | Checks prerequisites, starts Supabase, applies migrations, builds brand assets, runs the console on :3000 |
| `pnpm verify`         | Everything CI runs: five gates, the legal registry, typecheck and the full test suite                     |
| `pnpm test`           | Tests only (boots a throwaway Postgres automatically)                                                     |
| `pnpm brand:build`    | Regenerates every SVG master, PNG export and app icon                                                     |
| `pnpm tokens:build`   | Regenerates the console's CSS custom properties from `tokens.json`                                        |
| `pnpm legal:registry` | Rehashes `/legal` into `legal/registry.json` — run after editing any legal document                       |
| `pnpm db:reset`       | Drops and recreates the local Supabase database from migrations                                           |

Local URLs: console `:3000`, Supabase Studio `:54323`, mail catcher `:54324`.

## First run on a new machine

```bash
corepack enable && corepack prepare pnpm@10 --activate
pnpm install
cp .env.example .env.local
pnpm dev                       # prints the Supabase keys — paste them into .env.local
```

Then open <http://localhost:3000/sign-up>, create an account, and collect the confirmation
email from the mail catcher on :54324. Sign-up creates your `users` row, a personal
organisation and an owner membership through a database trigger; the console lists it.

## Verifying a change

The five gates, in the order CI runs them and why that order:

1. **`check:secrets`** — a leaked credential is the most expensive mistake, and the cheapest to
   catch. Scans tracked _and_ untracked files. Also runs as a pre-commit hook on staged changes.
2. **`check:copy`** — no phrase that extends "Verified by Vibefy", no absolute word without a
   scope qualifier. If it fires on wording you believe is correct, add
   `vibefy-copy-lint-allow: <reason>` on the line above, or a
   `vibefy-copy-lint-allow-block: <reason>` … `vibefy-copy-lint-allow-block-end` region. The
   reason is required and must be a real sentence.
3. **`check:contrast`** — every token pair against WCAG 2.2 AA. **Fix the token, not the
   threshold.**
4. **`check:brand`** — the nine masters exist, use only palette colours, and the certification
   badge carries the unextended wordmark.
5. **`check:stubs`** — no leftover `TODO`; every `STUB_` is registered in `OPEN_ITEMS.md`.

Then `legal:registry`, `typecheck` and `test`.

## The test database

`pnpm test` boots a throwaway Postgres 16 cluster on a Unix socket under `.tmp/pg`, applies the
Supabase shim and then the real migrations, and tears nothing down between runs so repeat runs
are fast. No Docker required.

```bash
scripts/test-db.sh start    # boot and migrate
scripts/test-db.sh reset    # drop, recreate, re-migrate — do this after adding a migration
scripts/test-db.sh dsn      # print the connection string
scripts/test-db.sh stop
```

If it refuses to start as root, it drops to the `postgres` account automatically; set
`VIBEFY_TEST_PGUSER` if that account does not exist.

## Common failures

| Symptom                                      | Cause                                           | Fix                                                                     |
| -------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL is not set`        | `.env.local` missing or unfilled                | `cp .env.example .env.local`, paste the values `supabase start` printed |
| Tests fail with `VIBEFY_TEST_DSN is not set` | Global setup did not run                        | Run `pnpm test`, not `vitest` directly                                  |
| `initdb: cannot be run as root`              | No unprivileged account                         | `VIBEFY_TEST_PGUSER=<user> pnpm test`                                   |
| Migration fails with `append-only`           | A migration tried to UPDATE an evidence table   | That is the trigger doing its job. Insert a superseding row instead     |
| `no verified, unexpired authorisation`       | An assessment was created without authorisation | That is the gate doing its job. Complete verification first             |
| CI fails on "brand/svg is out of date"       | `geometry.mjs` changed without regenerating     | `pnpm brand:build` and commit                                           |
| Copy lint fires on legal text                | Absolute word in a sentence with no negation    | Reword, or use a reasoned suppression                                   |

## Adding a migration

1. Create `supabase/migrations/<timestamp>_<name>.sql`.
2. **Write the RLS policies in the same file as the table.** A table without a policy is a data
   leak waiting for a deadline; nothing merges without one.
3. `scripts/test-db.sh reset` to apply it locally.
4. Add or extend the isolation test in `tests/rls-isolation.test.ts`.
5. `pnpm test`.

## Running an assessment locally

1. `pnpm dev` and `pnpm dev:worker` in two terminals.
2. Submit an application at `/console/apps/new`.
3. Accept the authorisation warranty and declare a scope.
4. Publish the DNS TXT record or the well-known file the page shows you, then verify. **Nothing
   runs before this**: `assessments` cannot be inserted without a verified authorisation, and the
   worker re-checks at dispatch and again before writing.
5. Enqueue a job on `assessment.run` with `{ appId, depth, requestedBy }`.
6. Watch the worker's structured log, then review the result at `/review`.

Costs land in `cost_records` as the run proceeds, and `/admin/costs` shows them against the
price of the tier each depth serves.

### When the browser will not launch

The runner resolves Playwright's browser itself. Two overrides exist: `VIBEFY_BROWSER_EXECUTABLE`
for a container image that bakes one in, and a discovery fallback for a machine whose cached
browser build predates the pinned Playwright version. If neither finds one, the browser pass is
skipped with a note rather than failing the run — but the report is thinner, so fix it.

### When a stage aborts

A stage that stops at a cost, rate or wall-clock ceiling is recorded as `aborted`, not `failed`,
and the pipeline stops rather than retrying. That is deliberate: retrying a ceiling breach spends
money to break the same rule twice. Everything assessed before that point still stands, and the
report says what came after was not assessed.

## Testing payments without Stripe

The billing suite runs against `FakePaymentProvider`, which signs webhooks with a real HMAC in
Stripe's format. To exercise the endpoint by hand:

```bash
node -e '
  const { FakePaymentProvider } = await import("./packages/billing/src/index.ts");
  const p = new FakePaymentProvider();
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", created: Math.floor(Date.now()/1000),
    data: { object: { id: "cs_1", mode: "payment", invoice: "in_1", amount_total: 7900, currency: "usd",
      metadata: { organisationId: "<your org id>", plan: "one_off" } } } });
  console.log(body); console.log(p.sign(body));
'
```

POST the body to `/api/stripe/webhook` with that value as the `stripe-signature` header. A
tampered body, an unsigned body, or one older than five minutes is refused — those are tested.

With real keys set, the fake is never constructed, and production refuses to start without them.

## Changing the rubric

Rubric versions are immutable once published — the database refuses to edit one, and issued
scores are never recomputed against a different version.

1. Copy `packages/rubric/versions/1.0.0.json` to the new version.
2. Register it in `packages/rubric/src/rubric.ts`.
3. Update `CURRENT_RUBRIC_VERSION`.
4. Announce the change with notice before it takes effect, per the Independence Policy.

## The badge signing key

```bash
pnpm badge:keygen                 # a dated key id
pnpm badge:keygen my-key-id       # a chosen one
```

It writes to stdout and never to a file. Copy the two variables into the
platform secret store, then clear your shell history. **Only the worker needs
them** — the console never signs anything, deliberately.

### Rotating

1. `pnpm badge:keygen` with a new id.
2. Add the _previous_ public JWK to `VIBEFY_BADGE_RETIRED_KEYS` (it is printed as
   a comment by the generator; you can also read it from
   `/.well-known/vibefy-badge-key` before you switch).
3. Point `VIBEFY_BADGE_KEY_ID` and `VIBEFY_BADGE_SIGNING_KEY_B64` at the new key.
4. Restart the worker.

Existing badges keep verifying, because they record which key signed them and the
retired public key stays published. **Never remove a retired key**: a verifier
that suddenly fails cannot tell "this badge is forged" from "Vibefy tidied up".

### If the key is suspected compromised

This is the one incident that ends the business if handled slowly.

1. Generate a new key and switch to it immediately.
2. Remove the compromised key from the published set — this is the _only_
   circumstance in which a key is unpublished, and it deliberately invalidates
   every badge it signed.
3. Re-sign every active badge with the new key.
4. Publish what happened. A quiet rotation after a compromise is a worse
   position than the compromise.

## Taking a badge down

`/review/badges` lists every issued badge and surfaces origin mismatches — a
badge requested from a domain it is not licensed for. Suspension and revocation
both need a written reason; the database refuses a revocation without one, and
the transition is written to an append-only event log by trigger.

Because the image is served from our origin with a five-minute cache, a
revocation stops every embedded instance reading as verified within minutes.
There is no file anywhere that says otherwise.

## Continuous monitoring

Four sweeps run in the worker every five minutes (`MONITOR_SWEEP_INTERVAL_MS`).
All four are idempotent, so running them twice, or crashing halfway, costs
nothing.

| Sweep | What it does |
| --- | --- |
| `sweepDriftDetection` | Compares each reviewed assessment against the one before it on the same application, writes an append-only `drift_reports` row, and suspends the badge if the change is material |
| `sweepScheduledReassessments` | Queues a re-assessment for every monitored application whose plan cadence is up, re-checking the authorisation in the same query |
| `sweepLiveness` | Sends one GET to each monitored badge's certified origin, suspends after a run of failures, restores when it answers again |
| `sweepBadgeExpiryWarnings` | Raises one alert at 30 days and one at 7 days before expiry |

### When a customer asks why their badge was suspended

The answer is a row, not a reconstruction:

```sql
select created_at, score_before, score_after, score_delta,
       material_regression, regression_reasons, certification_lost,
       new_finding_titles
  from public.drift_reports
 where app_id = '<app id>'
 order by created_at desc
 limit 1;
```

`regression_reasons` is the exact wording the customer was shown, frozen at the
moment the decision was made. The table refuses updates and deletes, including
from the superuser, so what is there is what happened. If the suspension was a
liveness one instead, `badges.suspension_reason` says so and names the number of
consecutive failed checks.

### Restoring a badge

- **Suspended for unreachability** — restores itself on the next successful
  probe. Nothing to do.
- **Suspended for a material regression** — the customer fixes the findings and
  requests a re-assessment. A new approved assessment issues a badge through the
  normal three gates. Do not reinstate by hand: the suspension is a record of a
  score that was true at the time.
- **Suspended by a reviewer** — `/review/badges`, with a written reason for the
  reinstatement. The liveness sweep will not touch it, because it only reverses
  suspensions whose reason it wrote itself.

### Turning monitoring off for one application

The customer does it themselves on the application page. Off means we stop
looking; the badge is then not renewed and runs to its expiry date.

### Adjusting what counts as material

`DEFAULT_MATERIALITY_POLICY` in `packages/monitoring/src/regression.ts`. The
numbers there mirror rubric 1.0.0's certification floors but are restated
deliberately, so that publishing a new rubric cannot silently change what
suspends a live badge. Changing either is a decision to record in
`DECISIONS.md`, and `pnpm test` will tell you which cases move.

## Workspaces, seats and single sign-on

### A customer says they cannot invite anyone

The seat limit is a database trigger, not a form check, and it counts unaccepted
invitations. Check both numbers:

```sql
select public.seats_for_organisation('<org id>') as seats,
       public.seats_used('<org id>')             as used;
```

`used` above `seats` means either someone should be removed, an invitation
withdrawn, or seats added on the subscription. Adding seats is a Stripe change;
the trigger reads the live subscription, so it takes effect immediately.

### A customer lost an invitation link

It cannot be recovered — only the hash is stored, deliberately. Withdraw the
invitation (which frees the seat) and issue a new one.

### A customer is locked out by single sign-on

`sso_connections.enforced` refuses password sign-in for every address at that
domain. If their identity provider is misconfigured, the way back is to unenforce:

```sql
update public.sso_connections set enforced = false where email_domain = '<domain>';
```

Do this only on a request from an owner of that workspace, verified out of band.
Whoever controls the domain controls who gets in, which is exactly why the domain
is proved by DNS TXT before enforcement can be switched on at all.

### Registering an identity provider

Still manual. The console tells the customer so. The domain claim, its DNS
verification and the sign-in routing are all built; the provider itself is
registered with the auth service by an operator, and `sso_connections.auth_provider_id`
is where its id belongs once it exists.

### An auditor questions an export

Every export is recorded in `audit_exports` with the SHA-256 of exactly what was
handed over, in a table that refuses updates and deletes:

```sql
select created_at, kind, format, row_count, sha256, period_start, period_end
  from public.audit_exports where organisation_id = '<org id>' order by created_at desc;
```

Hash the file they are holding and compare. Two things are never in one of those
files by design: a full IP address, and anybody's email address.

## Changing a legal document

1. Edit the file in `/legal`, bump its `**Version:**`.
2. `pnpm legal:registry` — this rehashes it.
3. `pnpm test` — the legal suite checks the mandated clauses are still present.
4. Existing consent records still point at the previous hash, which is the point: they record
   what that customer actually agreed to.

## Deploying

Not yet wired — the domain and hosting accounts are open items. When they are:

- **Web:** Vercel, EU region, environment variables from the platform secret store.
- **Database:** Supabase, EU region (Frankfurt or Ireland).
- **Secrets:** never in the repo. `.env.local` locally, platform secret store in production.
- **Badge signing key (M3):** generated at M3, stored only in the platform secret store. If it
  leaks, every badge becomes forgeable — rotation means reissuing every badge, so treat it as
  the most sensitive value in the system.

## If something goes wrong in production

1. **Suspected data exposure** — follow the incident response plan in `BUSINESS_CHECKLIST.md`.
   72-hour notification clock starts at awareness, not at confirmation.
2. **Badge signing key suspected compromised** — revoke the published key at
   `/.well-known/vibefy-badge-key`, generate a new key pair, re-sign every active badge, and
   publish what happened. Do not quietly rotate.
3. **Runaway assessment cost** — the global daily spend cap pauses new runs automatically. Check
   the internal cost dashboard, then `cost_records` for the assessment responsible.
4. **A finding turns out to be wrong** — correct it under the Appeals & Corrections Policy,
   whether or not the customer raised it, and whether or not the correction favours them.
