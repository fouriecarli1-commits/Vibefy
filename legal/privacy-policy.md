# Privacy Policy

> **DRAFT — REQUIRES REVIEW BY QUALIFIED COUNSEL IN [JURISDICTION] BEFORE USE.**
> Not legal advice. Not a substitute for a lawyer.

**Version:** 1.0.0-draft · **Status:** not in force · **Baseline:** GDPR-grade

---

## 1. Who is responsible

[LEGAL_ENTITY], [JURISDICTION], is the controller of the personal data described here. Contact
[CONTACT_EMAIL]. Where a data protection officer or EU/UK representative is required, their
details will be published here before launch.

## 2. Our starting position

We are a security-assessment business, so the least risky data is the data we never hold. We
collect what the rubric needs and nothing else. **We do not collect your end users' personal
data, we do not accept real user credentials, and we never see payment card details.**

## 3. What we collect, why, and for how long

| What                                                                                     | Why                                        | Lawful basis                                                  | Kept for                                                                             |
| ---------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Name, email, authentication identifiers                                                  | To give you an account                     | Contract                                                      | Account life + 90 days                                                               |
| App name, URL, description, self-declared answers at intake                              | To perform the assessment you asked for    | Contract                                                      | Account life + 90 days                                                               |
| Authorisation-to-test records: accepted text version and hash, timestamp, IP, user agent | Evidence that our testing was lawful       | Legitimate interest — establishing and defending legal claims | **10 years, append-only**                                                            |
| HTTP exchanges, console logs and DOM snapshots from your application                     | To produce evidenced findings              | Contract                                                      | 90 days                                                                              |
| Screenshots and browser traces                                                           | Evidence for findings                      | Contract                                                      | **30 days by default**, extendable by you to 12 months                               |
| Your source code, on tiers that include it                                               | Static analysis                            | Contract                                                      | **Not retained** — processed in an ephemeral container and deleted when the run ends |
| Reports, scores and findings                                                             | The product                                | Contract                                                      | Account life; certifications 7 years                                                 |
| Badge issuance and embed telemetry, including requesting origin                          | Anti-spoofing and licence enforcement      | Legitimate interest                                           | Append-only, life of the business                                                    |
| Stripe customer and invoice records, billing country                                     | Billing and tax                            | Contract and legal obligation                                 | 7 years                                                                              |
| Human review actions and written reasons                                                 | Rating integrity and auditability          | Legitimate interest                                           | Append-only, life of the business                                                    |
| Support correspondence                                                                   | To answer you                              | Contract                                                      | 24 months after closure                                                              |
| Session cookie; analytics only where you consent                                         | To keep you signed in; to understand usage | Contract; consent                                             | Session; analytics 14 months                                                         |

Retention is enforced by scheduled deletion jobs, not by intention.

## 4. Evidence artefacts and incidental data

A screenshot of your application may incidentally capture personal data — a test account's
name, a seeded record. This is why evidence carries the shortest retention of anything we hold,
why we require synthetic test accounts, and why you can delete evidence from your console at
any time without deleting the finding it supports.

## 5. Who we share with

Our sub-processors, listed in the Data Processing Agreement: our AI provider, our database and
storage provider, our hosting provider, our payment processor, our error-monitoring provider,
our email provider, and our sandbox host. We notify customers before adding or changing one. We
do not sell personal data, and we do not share it for advertising.

## 6. Where data is held

The database, storage and evidence artefacts are hosted in the **European Union**. Some
sub-processors process data outside it; those transfers rely on the appropriate safeguards for
the selected jurisdiction, documented in the Data Processing Agreement.

## 7. Your rights

You may request access, correction, deletion, portability, restriction, or object to
processing. **These are working flows in the product, not an email address in a footer.** We
respond within 30 days.

Two limits, stated plainly rather than applied quietly: records we must keep to establish or
defend legal claims — authorisation warranties, badge events, the audit log — are retained even
after an account is deleted, and we will tell you which of your records fall into that category
and why. Where consent is the basis, you can withdraw it at any time without affecting
processing already carried out.

You may complain to your supervisory authority. For GDPR that is the authority where you live,
work, or where the issue arose.

## 8. Security

Row-level security on every table, so one customer's data is not reachable from another's
session by construction. Encryption in transit and at rest. Assessments run in ephemeral,
network-restricted containers with no production credentials. Append-only audit, consent and
authorisation logs. Secret scanning on every commit. Least-privilege access, reviewed
periodically.

No system is without risk, and we do not claim ours is an exception. Our breach-response
process, including notification within 72 hours where required, is in `docs/BUSINESS_CHECKLIST.md`
and will be published before launch.

## 9. Children

The service is not directed at children and we do not knowingly collect their personal data.

## 10. Changes

We will give notice of material changes and record which version you accepted, with a hash of
its exact wording.
