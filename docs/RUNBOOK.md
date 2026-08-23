# Runbook

How to run, verify, debug and deploy VibefyCode. Written for one person with no team to ask.

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
2. **`check:copy`** — no phrase that extends "Verified by VibefyCode", no absolute word without a
   scope qualifier. If it fires on wording you believe is correct, add
   `vibefycode-copy-lint-allow: <reason>` on the line above, or a
   `vibefycode-copy-lint-allow-block: <reason>` … `vibefycode-copy-lint-allow-block-end` region. The
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
`VIBEFYCODE_TEST_PGUSER` if that account does not exist.

## Common failures

| Symptom                                          | Cause                                                       | Fix                                                                     |
| ------------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL is not set`            | `.env.local` missing or unfilled                            | `cp .env.example .env.local`, paste the values `supabase start` printed |
| Tests fail with `VIBEFYCODE_TEST_DSN is not set` | Global setup did not run                                    | Run `pnpm test`, not `vitest` directly                                  |
| `initdb: cannot be run as root`                  | No unprivileged account                                     | `VIBEFYCODE_TEST_PGUSER=<user> pnpm test`                               |
| Migration fails with `append-only`               | A migration tried to UPDATE an evidence table               | That is the trigger doing its job. Insert a superseding row instead     |
| `no verified, unexpired authorisation`           | An assessment was created without authorisation             | That is the gate doing its job. Complete verification first             |
| CI fails on "brand/svg is out of date"           | `packages/shared/src/brand.ts` changed without regenerating | `pnpm brand:build` and commit                                           |
| Copy lint fires on legal text                    | Absolute word in a sentence with no negation                | Reword, or use a reasoned suppression                                   |

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

The runner resolves Playwright's browser itself. Two overrides exist: `VIBEFYCODE_BROWSER_EXECUTABLE`
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
2. Add the _previous_ public JWK to `VIBEFYCODE_BADGE_RETIRED_KEYS` (it is printed as
   a comment by the generator; you can also read it from
   `/.well-known/vibefycode-badge-key` before you switch).
3. Point `VIBEFYCODE_BADGE_KEY_ID` and `VIBEFYCODE_BADGE_SIGNING_KEY_B64` at the new key.
4. Restart the worker.

Existing badges keep verifying, because they record which key signed them and the
retired public key stays published. **Never remove a retired key**: a verifier
that suddenly fails cannot tell "this badge is forged" from "VibefyCode tidied up".

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

| Sweep                         | What it does                                                                                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sweepDriftDetection`         | Compares each reviewed assessment against the one before it on the same application, writes an append-only `drift_reports` row, and suspends the badge if the change is material |
| `sweepScheduledReassessments` | Queues a re-assessment for every monitored application whose plan cadence is up, re-checking the authorisation in the same query                                                 |
| `sweepLiveness`               | Sends one GET to each monitored badge's certified origin, suspends after a run of failures, restores when it answers again                                                       |
| `sweepBadgeExpiryWarnings`    | Raises one alert at 30 days and one at 7 days before expiry                                                                                                                      |

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

## Accessibility

We score other people on WCAG 2.2 AA. Two gates cover us:

```bash
pnpm test          # the report, the badge and the alert email — pure functions
pnpm check:a11y    # builds the app, serves it, scans twelve public pages
pnpm verify:all    # both, plus everything else
```

`pnpm verify` deliberately leaves the page scan out — it needs a build and a
server, and the fast gate should stay fast. CI runs it as its own job.

### When it fails

The output names the rule, the impact, the element and a link to the rule's
page. Fix the markup; do not add the rule to an ignore list. There is no ignore
list, and adding one is a decision to record in `DECISIONS.md` with a reason.

### What it does not cover

The authenticated console. Reaching it needs a live auth service the local
harness does not run, so those pages are covered by the contrast gate and by
review rather than by axe. Registered in `docs/OPEN_ITEMS.md`.

And the standing caveat, which is the same one we print in every report: an
automated scan finds a minority of real barriers. A clean run is a floor.

## Alerts: who gets told, and how

Three channels, in the order that matters:

1. **In the console and the app.** A `critical` alert appears on whatever console
   page the customer opens, and at the top of the mobile home screen. This is the
   one that gets read.
2. **Push**, to phones with the app installed and notifications allowed.
3. **Email**, which is the channel of _record_ — a badge suspension is a notice
   we are obliged to give, and there has to be evidence it was sent.

`alert_deliveries` is the ledger for all of it:

```sql
select d.channel::text, d.status, d.detail, d.attempted_at
  from public.alert_deliveries d where d.alert_id = '<alert id>'
 order by d.attempted_at;
```

### A customer says they were never told

```sql
-- What we raised, and whether anything left the building.
select id, severity::text, title, created_at, delivered_at, delivery_channel
  from public.alerts where organisation_id = '<org id>' order by created_at desc limit 10;

-- Is their address suppressed?
select * from public.email_suppressions
 where email = (select email from public.users where id = '<user id>');

-- What did they ask to receive? There is no level that silences a critical.
select alert_email_level from public.users where id = '<user id>';
```

A suppressed address means a hard bounce: the address does not exist. Removing
the row makes us write to it again, so only do that once it is known good.

### Setting up sending

```
RESEND_API_KEY=...
ALERT_EMAIL_FROM="VibefyCode <alerts@<domain>>"
ALERT_EMAIL_REPLY_TO=<support address>     # optional
```

Without both of the first two, the worker logs once that email is not configured
and sends nothing. That is a legitimate deployment, not a fault.

**SPF, DKIM and DMARC on the sending domain are not optional.** Without them
these land in spam, and a notice in spam is not a notice. It is on the open-items
list, blocked on the domain decision.

### Bounces and complaints reported after the fact

Most bounces are not reported while we hold the connection. The provider accepts
the message, tries for a while, and tells us hours later — by webhook.

```
RESEND_WEBHOOK_SECRET=whsec_...            # from the Resend dashboard
```

Point Resend at `POST https://<domain>/api/email/webhook` and subscribe it to
`email.bounced` and `email.complained`. Without the secret the endpoint answers
404 to everything: an endpoint that silently accepts anything because a secret is
missing looks like it is working, which is worse than one that is not there.

What it does, and only this:

| Event                                    | Effect                                              |
| ---------------------------------------- | --------------------------------------------------- |
| `email.bounced`, bounce type `Permanent` | The address is suppressed.                          |
| `email.bounced`, any other bounce type   | Nothing. A full mailbox is not a dead address.      |
| `email.complained`                       | The address is suppressed, whether or not we agree. |
| Anything else                            | Recorded in the response, written nowhere.          |

A redelivery of an event already applied is a no-op — `email` is the primary key
of `email_suppressions` — and the _first_ reason recorded for an address is the
one kept. To check what a webhook did:

```sql
select email, kind, reason, suppressed_at
  from public.email_suppressions order by suppressed_at desc limit 20;
```

## The mobile app

```bash
EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... pnpm dev:mobile
```

Both values are public by design. **There is no service-role key in the app and
no mobile API** — the phone reads the same tables through the same policies as
the console, so an authorisation rule cannot be right in one place and wrong in
the other.

### A customer says they are not getting notifications

Three things, in order:

```sql
-- 1. Does the handset have a live token?
select id, platform, disabled_at, disabled_reason, last_seen_at
  from public.device_tokens where user_id = '<user id>';

-- 2. Was the alert one we push at all? Only warning and critical are pushed.
select id, severity, delivered_at, delivery_channel from public.alerts
 where organisation_id = '<org id>' order by created_at desc limit 10;

-- 3. What did Expo say?
select ad.status, ad.detail, ad.attempted_at
  from public.alert_deliveries ad
  join public.device_tokens dt on dt.id = ad.device_token_id
 where dt.user_id = '<user id>' order by ad.attempted_at desc limit 10;
```

`disabled_reason` naming `DeviceNotRegistered` means the app was uninstalled or
the token rotated — reinstalling and signing in registers a new one. An
informational alert is never pushed; it waits in the app, which is deliberate.

### Icons

`pnpm brand:build` writes `icon.png`, `adaptive-icon.png` and `splash.png` into
`apps/mobile/assets/` from the same masters as the favicon and the badge. Never
hand-edit them.

## The public directory

A listing is derived, not stored. `public.directory` joins the live badge through
`badge_effective_status`, so there is nothing to invalidate and no sweep to miss:
a suspension removes the listing at the same moment it changes the verification
page.

### A customer says their listing has disappeared

In order of likelihood:

```sql
select b.status::text, public.badge_effective_status(b)::text as effective, b.expires_at,
       b.suspension_reason
  from public.badges b where b.app_id = '<app id>';

select state::text, opted_out_at, opted_out_by
  from public.directory_listings where app_id = '<app id>';

select state::text, occurred_at, actor_id from public.listing_events
 where app_id = '<app id>' order by occurred_at desc;
```

`listing_events` is append-only, so it settles "we never listed you" against "you
opted out in March" without anyone's recollection being involved.

### A customer wants to be delisted but stay certified

They do it themselves, on the application page, and it takes effect on the next
read. The Badge Licence promises exactly this, and a test asserts the badge is
still `active` after an opt-out.

### Someone asks for paid placement

There is none, and there is no column for one. The ordering comparator receives
four fields — slug, score, assessment date, dimension scores — and a compile-time
assertion fails the build if a commercial key reaches that type. If paid
placement is ever introduced it must be labelled as advertising, visually and in
words, and kept out of the organic ordering; that is in the Badge Licence and in
the note under every page of results.

## Spend ceilings

The per-run cap is enforced inside the engine before every model call. The
global daily cap is a sweep, and its pause is a row:

```sql
select public.spend_since(date_trunc('day', now()))       as today,
       public.free_tier_spend_since(now() - interval '7 days') as free_this_week,
       public.spending_is_paused()                        as paused;
```

### The platform has paused itself

That is the ceiling working. `/admin/costs` shows why, with the observed number
against the ceiling. The worker claims nothing while a pause is live; queued
requests stay queued and are not failed.

Before lifting one, find out what spent the money — `/admin/costs` lists the most
expensive assessments. Then:

```sql
update public.spend_pauses
   set lifted_at = now(), lifted_by = '<your user id>',
       lift_reason = 'Cause identified: <what it was>. Raised the ceiling / fixed the loop.'
 where lifted_at is null;
```

The reason is required by a check constraint, and the pause is kept. A cap that
lifts itself is not a cap, which is why this is a manual step with a sentence
attached.

To change the ceiling itself, edit `config/pricing.json`. It is config, not code,
so it does not need a deploy.

## Retention and data-subject rights

### Proving a deletion happened

```sql
select data_class, entity_id, sha256, retention_until, deleted_at
  from public.retention_deletions
 where organisation_id = '<org id>' order by deleted_at desc;
```

The hash is kept and the artefact is not, so this answers "did you actually
delete it" rather than asserting it. The table refuses updates and deletes.

### A data-subject request

Customers raise them at `/console/privacy`; the queue is `/review/requests`. Both
sides show the deadline, which is set by a database trigger at thirty days and
cannot be created without one.

- **Answering one** needs a sentence saying what was done. It is shown to them.
- **Refusing one** needs the lawful basis, in a sentence. A check constraint
  refuses a refusal without it — name the basis, do not assert that one exists.
- **A completed or refused request is terminal.** If they come back, that is a
  new request with a new deadline, which is the honest way round.

### An appeal

`/review/appeals`, fourteen days, answered by someone who did not work on the
assessment. Every outcome needs written reasons — a rejection especially, since
that is the one the published policy exists for.

## The marks

`pnpm brand:build` is the only way any brand asset is produced. It writes the
SVG masters, the PNG exports at 1x/2x/3x, the full icon set, the mobile icons
and splash, and the web app's public assets — all from one geometry source,
`packages/shared/src/brand.ts`. Never hand-edit anything it writes.

```bash
pnpm brand:build              # everything
pnpm brand:build --svg-only   # skip rasterisation
pnpm check:brand              # the gate: masters present, palette clean, wordmark intact
```

### Looking at what you changed

The gate checks correctness, not whether it looks right. For that, render and
open it:

```bash
node -e "require('sharp')('brand/svg/vibefycode-badge-verified.svg',{density:600})\
  .resize(600).flatten({background:'#fff'}).png().toFile('/tmp/seal.png')"
```

Check the seal at 512px **and** the compact badge at 96px. They are different
artwork for a reason.

### Two things that will bite

**`textPath` renders as nothing in librsvg**, which is what rasterises our own
PNG masters. The seal's arc legends are placed one glyph at a time
(`arcTextPlacements`) for exactly this reason. If you reintroduce `textPath`,
the browser will look fine and the PNG masters will come out with no wordmark
on them. A test asserts no badge SVG contains it.

**The wordmark is outlines, not text**, and the brand gate refuses a master that
sets it as text. It is the trade mark and it goes onto other people's websites,
where a machine without Poppins would otherwise draw a different logo. To
regenerate it after a font or spacing change:

```bash
curl -sS "https://fonts.gstatic.com/s/poppins/v24/pxiByp8kv8JHgFVrLCz7V1s.ttf" -o /tmp/Poppins-Bold.ttf
curl -sS "https://fonts.gstatic.com/s/poppins/v24/pxiEyp8kv8JHgFVrFJA.ttf"     -o /tmp/Poppins-Regular.ttf
node tools/build-wordmark.mjs /tmp/Poppins-Bold.ttf /tmp/Poppins-Regular.ttf
pnpm brand:build
```

Poppins is SIL Open Font License 1.1. No font file ships — only the ten glyphs
of the wordmark, as paths.

**The remaining text still pins its width with `textLength`.** The legends and
the tagline are descriptive rather than the mark, so a substituted font there is
cosmetic — but drop the pin and they will clip on some machines and not others.
The first build of the new lockup clipped to "VIBEFYCO".

### The artwork in `brand/source/` is the authority

Except that right now it is empty: the VibefyCode logo and stamp arrived as
images in conversation rather than as files, so the masters are reconstructions.
`brand/source/README.md` says what to drop in and what to check. Until then the
delta is registered in `docs/OPEN_ITEMS.md`.

## Changing a legal document

1. Edit the file in `/legal`, bump its `**Version:**`.
2. `pnpm legal:registry` — this rehashes it.
3. `pnpm test` — the legal suite checks the mandated clauses are still present.
4. Existing consent records still point at the previous hash, which is the point: they record
   what that customer actually agreed to.

**If the document requires consent, bumping it stops anything that depends on
that consent until people re-accept.** That is deliberate, and for the Badge
Licence it is enforced: the version in force is read from `legal/registry.json`
by both the worker's issuance query and the console's acceptance prompt, so
neither can drift from the file. Expect issuance to pause and the console to ask
for re-acceptance. If you did not intend that, you did not want a version bump.

## Deploying

### Standing rules

- **Web:** Vercel, EU region. `vercel.json` pins `fra1`, the build command and the output
  directory, so an import needs no dashboard configuration and two deployments cannot differ
  because someone typed something different into a form.
- **Database:** Supabase, EU region (Frankfurt or Ireland). The region is not a preference: the
  privacy notice says data is held in the EU, and this is the setting that makes that true.
- **Secrets:** never in the repo. `.env.local` locally, the platform secret store in production.
- **Badge signing key:** stored only in the platform secret store, and only the worker needs it.
  If it leaks, every badge becomes forgeable — rotation means reissuing every badge, so treat it
  as the most sensitive value in the system.

### First deployment, from a browser

Written for someone with no local toolchain. Nothing here needs a terminal.

1. **Create the Supabase project.** EU region. Save the database password at the moment it is
   shown; it is shown once.
2. **Apply the schema.** Supabase dashboard → SQL Editor → paste the whole of
   `supabase/schema.sql` → Run. That file is generated from `supabase/migrations` by
   `pnpm schema:build`, and `pnpm check:schema` fails the build if it has drifted — so what gets
   pasted is what the tests ran against.
3. **Import the repository into Vercel.** Root directory: the repository root, not `apps/web`.
   `vercel.json` supplies the rest.
4. **Set the environment variables** before the first deployment (Vercel → Settings →
   Environment Variables), for all three environments:

   | Variable                        | Where it comes from                                          |
   | ------------------------------- | ------------------------------------------------------------ |
   | `NEXT_PUBLIC_SUPABASE_URL`      | Supabase → Settings → API → Project URL                      |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public                      |
   | `SUPABASE_SERVICE_ROLE_KEY`     | Supabase → Settings → API → service_role                     |
   | `SUPABASE_DB_URL`               | Supabase → Settings → Database → Connection string → URI     |
   | `ANTHROPIC_API_KEY`             | console.anthropic.com → API Keys                             |
   | `NEXT_PUBLIC_SITE_URL`          | The deployment's own URL — known only after the first deploy |
   | `NEXT_PUBLIC_SUPPORT_EMAIL`     | Whatever address answers support today                       |

   Everything else in `.env.example` may stay empty. A missing setting disables the feature it
   belongs to and says so; it does not break the build.

5. **Deploy**, then set `NEXT_PUBLIC_SITE_URL` to the URL Vercel gave you and deploy again.

### What this deployment cannot do

The assessment engine drives a real browser, and Vercel's functions cannot hold one open for the
minutes a run takes. So on Vercel alone: an assessment can be requested and appears in
`assessment_requests` as `queued`, and nothing claims it. Everything else works — accounts,
workspaces, authorisation, reports on existing data, badges, verification, the directory.

Running the worker means a machine that can hold a process and launch Chromium: a laptop with
`pnpm dev:worker`, or a small always-on container. It needs `SUPABASE_DB_URL` and
`ANTHROPIC_API_KEY`, and nothing else.

## If something goes wrong in production

1. **Suspected data exposure** — follow the incident response plan in `BUSINESS_CHECKLIST.md`.
   72-hour notification clock starts at awareness, not at confirmation.
2. **Badge signing key suspected compromised** — revoke the published key at
   `/.well-known/vibefycode-badge-key`, generate a new key pair, re-sign every active badge, and
   publish what happened. Do not quietly rotate.
3. **Runaway assessment cost** — the global daily spend cap pauses new runs automatically. Check
   the internal cost dashboard, then `cost_records` for the assessment responsible.
4. **A finding turns out to be wrong** — correct it under the Appeals & Corrections Policy,
   whether or not the customer raised it, and whether or not the correction favours them.
