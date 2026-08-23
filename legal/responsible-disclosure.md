# Responsible Disclosure Policy

> **DRAFT — REQUIRES REVIEW BY QUALIFIED COUNSEL IN [JURISDICTION] BEFORE USE.**
> Not legal advice. Not a substitute for a lawyer.

**Version:** 1.0.0-draft · **Status:** not in force · **Baseline:** GDPR-grade

---

This policy has two halves: what we do when we find something in **your** application, and what
we ask of you when you find something in **ours**. Both are decided in advance, deliberately,
because deciding during an incident is how the wrong call gets made.

## Part 1 — When an assessment finds a live exposure

An assessment may reveal that your application is exposing personal data belonging to real
people. That is a different situation from an ordinary finding, and it is handled differently.

1. **We tell you first, immediately.** Out of band — by email and in your console — flagged as
   urgent, before the report is finished and before any other step.
2. **We do not access, download, enumerate or retain the exposed data.** We record only what is
   needed to demonstrate the exposure exists: the request, the response status, and the shape of
   what was returned. Any incidental sample is redacted at capture and deleted immediately.
3. **We give you 30 days** to remediate, or 90 days where the fix is genuinely structural and
   you are demonstrably working on it.
4. **We do not publish**, and we do not certify the application while the exposure stands.
5. **Escalation.** If you do not remediate and do not notify the affected people or the relevant
   authority, and the exposure is serious and ongoing, we may — after telling you we intend to —
   notify the hosting provider or the relevant supervisory authority. We will not publish
   technical detail publicly. This is a last resort, and the affected people's interests are
   what decides it, not our relationship with you.
6. **Immediate danger** — a live credential set, an exposed payment dataset, an open medical or
   children's dataset — shortens every timeline above, and we will say so when we tell you.

Nothing here transfers your obligations to you. You remain the controller of your users' data
and the person who must notify them.

## Part 2 — Reporting a vulnerability in VibefyCode

We would rather hear from you than read about it.

**Contact:** [CONTACT_EMAIL], subject line beginning `SECURITY:`. A `security.txt` will be
published at `/.well-known/security.txt` before launch.

**What we commit to:** acknowledgement within 2 business days; an assessment and a remediation
plan within 10 business days; credit in our disclosure log if you want it; and no legal action
against you for good-faith research that follows the rules below.

**What we ask:** test only against your own account; do not access, modify or exfiltrate other
people's data; no denial-of-service, spam or social engineering of our staff or customers; give
us 90 days before publishing; and tell us immediately if you encounter personal data so we can
handle it properly.

**Out of scope:** findings from automated scanners with no demonstrated impact, missing headers
with no exploit path, rate-limit findings on unauthenticated endpoints without a demonstrated
consequence, and issues in third-party services that we do not control.

We do not currently run a paid bounty. We will say so plainly rather than implying one.
