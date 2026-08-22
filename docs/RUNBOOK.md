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

## Changing the rubric

Rubric versions are immutable once published — the database refuses to edit one, and issued
scores are never recomputed against a different version.

1. Copy `packages/rubric/versions/1.0.0.json` to the new version.
2. Register it in `packages/rubric/src/rubric.ts`.
3. Update `CURRENT_RUBRIC_VERSION`.
4. Announce the change with notice before it takes effect, per the Independence Policy.

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
