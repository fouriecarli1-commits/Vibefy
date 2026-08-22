# Vibefy — Kick-off record (PART 12 of the build brief)

Recorded 2026-08-22. This file is the answer to PART 12 of the build brief and the
starting point for M0. It is a record, not a specification — the brief remains the
specification.

---

## 1. The brief, read back in fifteen lines

1. Vibefy is a trust layer for AI-built ("vibe-coded") apps, not an app store.
2. An owner submits an app; we prove they are allowed to let us test it; we test it.
3. Testing is deterministic checks plus a Claude-driven Playwright walkthrough plus an adversarial pass.
4. Findings are scored against a published, versioned rubric with six weighted dimensions.
5. Every finding must carry evidence; unverifiable model claims are dropped, never published.
6. A human reviewer must approve before anything is certified. AI never certifies alone.
7. Paying customers get a "Verified by Vibefy" badge, served from our origin as a signed SVG.
8. The badge always links to a public verification page that states exactly what was and was not assessed.
9. Badges expire (12 months maximum) and can be revoked instantly; revocation propagates because we serve the image.
10. Payment buys depth, re-testing and monitoring. It never buys a better score, and a test proves it.
11. Three account types — individual, agency, organisation — share one core engine, not three products.
12. Every run meters its own token and compute cost, with hard ceilings that stop runaway spend.
13. No output ever says "secure", "safe", "guaranteed" or "compliant"; a lint rule fails the build if it does.
14. Legal artefacts are drafted GDPR-grade with a jurisdiction-swap layer, and are drafts pending counsel.
15. **M0 is: monorepo, environments, auth, database schema with row-level security, CI, secret management, the brand asset pipeline, and one command that runs the whole stack locally.**

---

## 2. The five highest-risk decisions, and the defaults chosen

| #   | Decision                                  | Why it is the risk                                                                                                                              | Default chosen                                                                                                                                                                                 |
| --- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Whether we hold customer source code**  | Holding source multiplies our breach blast radius and our privacy obligations, and it is the one asset a customer cannot re-issue after a leak. | **Repo required for the paid tier, free tier is URL-only.** Source is processed in the ephemeral runner, never persisted to our database, and deleted on run completion by default.            |
| 2   | **How the badge is trusted**              | If the badge can be forged or cannot be revoked, the business is over. A static image the customer hosts is both forgeable and unrevocable.     | **Ed25519-signed payload, SVG rendered from our origin on every load, public key at a well-known URL.** Third parties can verify without contacting us; we can revoke without contacting them. |
| 3   | **How authorisation-to-test is enforced** | Testing without authorisation is a criminal offence in every market on the list. A prompt instruction is not an enforcement mechanism.          | **Network-level egress allowlist in the sandbox, derived from an append-only authorisation record.** The model cannot widen its own scope because the scope is enforced below it.              |
| 4   | **Where scoring gets its input**          | "Payment never buys a score" is a claim we sell. If a scoring function can even see the plan field, the claim is unprovable.                    | **Scoring receives a structurally distinct type that has no plan, spend or marketing-client field.** Enforced by TypeScript at compile time and by an independence test at run time.           |
| 5   | **Jurisdiction and data region**          | Getting this wrong means rewriting every legal artefact and migrating data under regulatory pressure.                                           | **GDPR-grade drafts with a jurisdiction-swap layer; data hosted in the EU.** Strictest common standard now, cheap variant selection later.                                                     |

---

## 3. Architecture questions asked, and the founder's answers

| Question                                                | Answer                                                                                                                  |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Primary jurisdiction for legal and privacy artefacts    | **GDPR-grade baseline, jurisdiction decided later**, with UAE PDPL / SA POPIA / US variants swappable without a rewrite |
| Physical region for the database and evidence artefacts | **EU (Frankfurt or Ireland)**                                                                                           |
| Repository access at launch                             | **Required for the paid tier; free tier is URL-only**                                                                   |
| Approval to begin M0 on the structure and schema below  | **Approved**                                                                                                            |

---

## 4. What M0 delivers

- pnpm + TypeScript monorepo with the package layout in `/docs/DECISIONS.md`.
- Database schema written **together with** its row-level-security policies, in one migration pair.
- CI that runs typecheck, tests, the secret scanner, the copy lint and the colour-contrast check.
- The brand pipeline: SVG marks derived from the founder's artwork, plus derived PNG and icon sets.
- Design tokens shared by web, PDF and badge rendering, so the palette has one source of truth.
- `pnpm dev` — one command that brings up the database and the web app locally.

M0 explicitly does **not** include the assessment engine, payments, the badge issuer, or any
customer-facing flow beyond sign-in. Those are M1 to M3.
