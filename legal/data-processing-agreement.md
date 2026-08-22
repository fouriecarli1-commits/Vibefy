# Data Processing Agreement

> **DRAFT — REQUIRES REVIEW BY QUALIFIED COUNSEL IN [JURISDICTION] BEFORE USE.**
> Not legal advice. Not a substitute for a lawyer.

**Version:** 1.0.0-draft · **Status:** not in force · **Baseline:** GDPR-grade

---

This Agreement applies where Vibefy processes personal data on your behalf. It forms part of
the Terms of Service.

## 1. Roles

You are the **controller** for personal data within your application and for any data you
direct us to process. Vibefy is the **processor** for that data. Vibefy is an independent
**controller** for its own account, billing, audit and badge-integrity records, described in
the Privacy Policy.

## 2. Subject matter and duration

Subject matter: assessment of the application you nominate. Duration: the term of the Terms of
Service, plus the retention periods stated in the Privacy Policy.

## 3. Nature and purpose

Automated inspection and browsing of your application within the scope you authorised, static
analysis of source where your tier includes it, and generation of an evidenced report.

## 4. Categories of data and data subjects

By design, the categories are deliberately narrow: your personnel's account data, and whatever
incidentally appears in evidence artefacts captured from your application while operating a
**synthetic test account**. **We instruct you not to place real end-user personal data within
our scope, and we do not accept real user credentials.** No special-category data. No payment
card data.

## 5. Our obligations

We will: process only on your documented instructions; ensure personnel are bound by
confidentiality; apply the security measures in the Privacy Policy; engage sub-processors only
under equivalent terms; assist you with data-subject requests, impact assessments and
regulator consultations, taking into account the nature of the processing; notify you without
undue delay on becoming aware of a personal data breach; and delete or return the data on
termination, save where retention is legally required.

## 6. Sub-processors

| Sub-processor                                   | Purpose                           | Region                                |
| ----------------------------------------------- | --------------------------------- | ------------------------------------- |
| Anthropic                                       | AI analysis and synthesis         | United States                         |
| Supabase                                        | Database, authentication, storage | European Union                        |
| Vercel                                          | Web hosting                       | European Union edge, global CDN       |
| Stripe                                          | Payments and tax                  | Global                                |
| Sentry                                          | Error monitoring                  | European Union                        |
| [Email provider — Resend or Postmark]           | Transactional email               | To be fixed before launch             |
| [Sandbox host — Fly Machines, Cloud Run or E2B] | Ephemeral assessment runners      | European Union, to be fixed before M1 |

We give at least 30 days' notice before adding or replacing a sub-processor. You may object on
reasonable data-protection grounds; if we cannot accommodate the objection, you may terminate
the affected service and receive a pro-rata refund.

## 7. International transfers

Primary processing is in the European Union. Where a sub-processor processes outside it, the
transfer relies on the appropriate mechanism for the selected jurisdiction — Standard
Contractual Clauses under GDPR, and the equivalent instrument under UAE PDPL, South Africa
POPIA or applicable US state law once the operating jurisdiction is fixed.

## 8. Audit

We will make available the information needed to demonstrate compliance with this Agreement,
and will contribute to audits conducted by you or an auditor you mandate, no more than once a
year absent a breach, on reasonable notice and subject to confidentiality.

## 9. Breach notification

On becoming aware of a personal data breach affecting your data we will notify you without
undue delay and in any event within 48 hours, with the information available at the time and
updates as we learn more, so that you can meet your own 72-hour obligation.

## 10. Deletion

On termination we delete your data within 30 days, save for records we are legally required to
retain, which remain subject to this Agreement until deleted.
