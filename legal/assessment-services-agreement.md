# Assessment Services Agreement

> **DRAFT — REQUIRES REVIEW BY QUALIFIED COUNSEL IN [JURISDICTION] BEFORE USE.**
> Not legal advice. Not a substitute for a lawyer.

**Version:** 1.0.0-draft · **Status:** not in force · **Baseline:** GDPR-grade

---

## 1. What we do

We assess the application you nominate, within the scope you authorise, against a published
version of the Vibefy Rubric, using a combination of deterministic automated checks, an
AI-driven functional walkthrough, a non-destructive adversarial pass, and human review. We
return a scored report with findings, evidence and prioritised remediation.

## 2. What an assessment is not

> This assessment is a point-in-time, scope-limited, AI-assisted and human-reviewed evaluation
> of the application identified above, conducted by Vibefy against published Vibefy Rubric
> version X on [date]. "Verified by Vibefy" means only that the application was assessed
> against that rubric and met the published threshold on that date. It is not a penetration
> test, a security audit, a code audit, a legal or regulatory compliance certification, or a
> guarantee of any kind. It does not certify that the application is secure, error-free,
> lawful, or fit for any particular purpose. Findings are limited to what was observable within
> the authorised scope using the methods described in the methodology document. Absence of a
> finding is not evidence of absence of a defect.

In particular:

- We do not exploit. The adversarial pass is **non-destructive, read-only, rate-limited** and
  confined to the scope you declared.
- We do not test what you did not authorise. Out-of-scope requests are blocked by the sandbox
  at network level, not merely discouraged.
- We do not review code we were not given. On the free tier we assess a running application
  only, so security findings are necessarily shallower than on a tier where source is provided.
- We do not certify legal or regulatory compliance in any jurisdiction.

## 3. Scope

The in-scope domains, endpoints and exclusions are those recorded in your Authorisation to
Test. Changing scope requires a new authorisation record; the previous one is superseded, never
edited.

## 4. Evidence and findings

**No finding without evidence.** Every published finding carries a severity, a rubric
dimension, an evidence artefact — a screenshot, a browser trace, an HTTP exchange or a
dependency report — a confidence level and a remediation step. Findings the engine asserts but
cannot evidence are withheld with a stated reason and do not affect your score.

## 5. Human review

An assessment is not complete until a human reviewer has confirmed it, adjusted it with a
written reason, or rejected it. Adjustments are recorded in an append-only log with the
reviewer's identity and reason. **AI never certifies alone.**

## 6. Test accounts and data

If a flow requires authentication, you provision a **dedicated synthetic test account**. We
will not ask for, accept, or store credentials for a real user account, and we will not ingest
your end users' personal data. Evidence artefacts may capture incidental data; they carry the
shortest retention of anything we hold and can be deleted on request.

## 7. Your source code

Where a tier includes repository analysis, your source is processed inside an ephemeral,
network-restricted container and **deleted when the run completes**. We retain the derived
findings and file-path references, not the code. Retention beyond the run happens only with
your explicit opt-in and a stated period.

## 8. Turnaround and availability

We aim to return an assessment within the period stated at purchase. Long-running assessments
are queued; we do not guarantee a completion time, and delay is not a breach. Where we fail to
deliver an assessment at all, the Refund & Cancellation Policy applies.

## 9. Re-assessment and drift

On continuous plans we re-assess on the schedule of your plan, compare against the previous
run, and alert you to material change. A material regression may suspend your mark; suspension
is notified, is appealable, and does not entitle us to withhold the finding that caused it.

## 10. Fees

Fees buy depth, re-testing, monitoring and support. They do not buy a score, the suppression of
a finding, or a delay to a suspension.

## 11. Liability

The limitation of liability, the disclaimer of warranties, your indemnity, and the exclusion of
third-party reliance in the Terms of Service apply to this Agreement and are incorporated here.

## 12. If we find something serious

If an assessment reveals a live exposure of third-party personal data, the Responsible
Disclosure Policy governs what we do, on what deadline, and when we escalate.
