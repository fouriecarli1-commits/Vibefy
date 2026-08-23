# VibefyCode

**The vibe app rating system.** VibefyCode is the trust and verification layer for AI-built
("vibe-coded") apps: an owner submits an app, we verify they are authorised to let us test it,
we assess it against a published rubric, a human reviews the result, and — for paying
customers — we issue a revocable, cryptographically signed **"Verified by VibefyCode"** badge.

VibefyCode is not an app store, and a VibefyCode badge is not a security guarantee. See
[the scope block](#what-a-vibefycode-assessment-is-not).

---

## Status

Milestone **M7 — Public directory**. Intake, ownership verification, the authorisation
gate, the six-stage pipeline, the reviewer queue, reports with PDF export, entitlements, Stripe
billing, the signed "Verified by VibefyCode" badge with its public verification surface, and
continuous monitoring, and the agency and organisation surfaces — shared workspaces, seats and
roles, policy profiles, white-label reports, audit export, single sign-on and the portfolio
dashboard — the Expo mobile app with push notifications, and the public directory are built. The marketing
arm (M8) is deliberately not — its own precondition, a live directory, is not met. See
`docs/MILESTONES.md`.

The spend ceilings, retention deletion, data-subject-rights flows and the appeals route are also
built: the schema had recorded the intent of all four since M1 and nothing had carried any of
them out. See `docs/MILESTONES.md` for what each milestone delivered and `docs/OPEN_ITEMS.md`
for what is deferred and why.

## Getting started

```bash
pnpm install
cp .env.example .env.local     # fill in the values printed by `supabase start`
pnpm dev                       # one command: database + migrations + web app
pnpm dev:worker                # in another terminal: the assessment runner
```

`pnpm dev` needs [Docker](https://docs.docker.com/get-docker/) and the
[Supabase CLI](https://supabase.com/docs/guides/local-development). It checks for both and
tells you what is missing rather than failing halfway.

## The checks that gate every commit

```bash
pnpm verify
```

Runs, in order:

| Check            | What it protects                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `check:secrets`  | No credential ever reaches the repository                                                                     |
| `check:copy`     | No output over-claims — see the forbidden-phrase list in `tools/copy-lint.mjs`                                |
| `check:contrast` | Every brand colour pair meets WCAG 2.2 AA; we cannot sell an accessibility score from an inaccessible product |
| `check:brand`    | The badge and wordmark are used only in their permitted forms, and no master has drifted off-palette          |
| `typecheck`      |                                                                                                               |
| `test`           | Including the RLS isolation tests and the rating-independence test                                            |

## Repository layout

```
apps/web           Next.js App Router console, review queue and public pages
apps/mobile        Expo (React Native): submit, track, read, receive alerts, approve a re-test
apps/worker        The assessment runner: queue consumer, pipeline, persistence, monitoring sweeps
packages/engine    The assessment engine — scope boundary, stages, evidence, cost
packages/report    The report: assembly from stored rows, tier redaction, rendering
packages/billing   Entitlements, the payment boundary, and webhook application
packages/monitoring Drift between two assessments, and what makes a change material
packages/policy    An organisation's own bar, applied over a score and never to it
packages/workspace Invitation tokens, seat arithmetic and the audit export
packages/api       One typed client the console and the phone both use — there is no mobile API
packages/directory Public listing: search, rubric-only ordering, and the disclosures
packages/governance Spend ceilings, the retention schedule, and data-subject rights
packages/notify    The email boundary, its fake, and the alert template
packages/badge     Ed25519 signing, the published key set, and the badge renderer
packages/shared    Types, design tokens, and the guarantees shared by every surface
packages/rubric    The rubric as versioned data, plus the scoring functions
prompts/           Versioned prompts, hashed and recorded in every report
supabase/          Schema migrations — every table ships with its RLS policy
brand/             Brand marks: JPEG originals, SVG masters, generated derivatives
legal/             Drafted legal artefacts — DRAFTS, pending counsel review
config/            Pricing and ceilings, changeable without a deploy
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
5. **The scope boundary is below the model, not in it.** Requests are checked against the
   resolved address, destructive methods never leave the process, and the browser's own
   requests go through the same guard. A model cannot widen what it is allowed to reach.
6. **A badge signature attests a historical fact, not current standing.** That the assessment
   happened stays true forever and can be checked offline against a published key. Whether the
   badge is still live is a separate question, and only our origin answers it — which is why we
   serve the image rather than handing out a file.

## What a VibefyCode assessment is not

> A VibefyCode assessment is a point-in-time, scope-limited, AI-assisted and human-reviewed
> evaluation against a published rubric version on a stated date. It is not a penetration
> test, a security audit, a code audit, a legal or regulatory compliance certification, or a
> guarantee of any kind. Absence of a finding is not evidence of absence of a defect.

## Legal notice

Everything in `/legal` is a **draft**. Drafts are not legal advice and are not a substitute
for a qualified lawyer in the operating jurisdiction. See `docs/BUSINESS_CHECKLIST.md`.
