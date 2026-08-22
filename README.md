# Vibefy

**The vibe app rating system.** Vibefy is the trust and verification layer for AI-built
("vibe-coded") apps: an owner submits an app, we verify they are authorised to let us test it,
we assess it against a published rubric, a human reviews the result, and — for paying
customers — we issue a revocable, cryptographically signed **"Verified by Vibefy"** badge.

Vibefy is not an app store, and a Vibefy badge is not a security guarantee. See
[the scope block](#what-a-vibefy-assessment-is-not).

---

## Status

Milestone **M0 — Foundations**. The assessment engine (M1), payments (M2) and the badge
system (M3) are not built yet. See `docs/OPEN_ITEMS.md` for what is deferred and why.

## Getting started

```bash
pnpm install
cp .env.example .env.local     # fill in the values printed by `supabase start`
pnpm dev                       # one command: database + migrations + web app
```

`pnpm dev` needs [Docker](https://docs.docker.com/get-docker/) and the
[Supabase CLI](https://supabase.com/docs/guides/local-development). It checks for both and
tells you what is missing rather than failing halfway.

## The checks that gate every commit

```bash
pnpm verify
```

Runs, in order:

| Check | What it protects |
|---|---|
| `check:secrets` | No credential ever reaches the repository |
| `check:copy` | No output over-claims — see the forbidden-phrase list in `tools/copy-lint.mjs` |
| `check:contrast` | Every brand colour pair meets WCAG 2.2 AA; we cannot sell an accessibility score from an inaccessible product |
| `check:brand` | The badge and wordmark are used only in their permitted forms |
| `typecheck` | |
| `test` | Including the RLS isolation tests and the rating-independence test |

## Repository layout

```
apps/web           Next.js App Router console and public pages
packages/shared    Types, design tokens, and the guarantees shared by every surface
packages/rubric    The rubric as versioned data, plus the scoring functions
supabase/          Schema migrations — every table ships with its RLS policy
brand/             Brand marks: JPEG originals, SVG masters, generated derivatives
legal/             Drafted legal artefacts — DRAFTS, pending counsel review
docs/              Decisions, open items, data map, policies, runbook
tools/             The CI gates listed above
```

## Principles that are enforced in code, not just written down

1. **The score is never for sale.** Scoring functions receive a type that structurally cannot
   contain a plan, a price or a marketing relationship. A test asserts a maximally-paying
   customer and a free customer get identical scores.
2. **No testing without authorisation.** No assessment step runs against a target without a
   verified, append-only authorisation record, and the sandbox enforces scope at the network
   level rather than trusting a prompt.
3. **No finding without evidence.** Model claims that cannot be evidenced are dropped, not
   published.
4. **Every badge expires and every badge can be revoked**, because we serve the image.

## What a Vibefy assessment is not

> A Vibefy assessment is a point-in-time, scope-limited, AI-assisted and human-reviewed
> evaluation against a published rubric version on a stated date. It is not a penetration
> test, a security audit, a code audit, a legal or regulatory compliance certification, or a
> guarantee of any kind. Absence of a finding is not evidence of absence of a defect.

## Legal notice

Everything in `/legal` is a **draft**. Drafts are not legal advice and are not a substitute
for a qualified lawyer in the operating jurisdiction. See `docs/BUSINESS_CHECKLIST.md`.
