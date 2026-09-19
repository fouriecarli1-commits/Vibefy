# Data map and lawful basis register

Baseline: **GDPR-grade**. Jurisdiction variants (UAE PDPL, South Africa POPIA, US state laws) are
selected later via the jurisdiction layer without changing the processing described here.

**Hosting region:** EU (Frankfurt or Ireland) for database, storage and evidence artefacts.

## Processing activities

| #   | Activity                                 | Data classes                                                               | Lawful basis (GDPR)                                                                 | Retention                                                                             | Notes                                                                                                               |
| --- | ---------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | Account creation and sign-in             | Email, name, hashed credentials or OAuth identity, IP, user agent          | Contract (Art. 6(1)(b))                                                             | Life of account + 90 days                                                             | Handled by Supabase Auth                                                                                            |
| 2   | App submission and intake                | App name, URL, description, stack, self-declared data-processing answers   | Contract                                                                            | Life of account + 90 days                                                             | No end-user personal data accepted                                                                                  |
| 3   | Authorisation-to-test record             | Accepted text version, timestamp, IP, user agent, user ID                  | Legal obligation / legitimate interest (Art. 6(1)(f)) — evidence of lawful testing  | **10 years, append-only**                                                             | This is our defence if testing is ever challenged; it is deliberately long-lived                                    |
| 4   | Assessment execution                     | HTTP exchanges, DOM snapshots, console logs from the customer's app        | Contract                                                                            | 90 days default                                                                       | May contain incidental personal data; short retention is the mitigation                                             |
| 5   | Evidence artefacts (screenshots, traces) | Images and traces of the customer's app                                    | Contract                                                                            | **30 days default**, extendable by the customer to 12 months                          | Shortest retention of any class, because screenshots are the highest incidental-data risk                           |
| 6   | Customer source code (paid tier)         | Repository contents                                                        | Contract                                                                            | **Not retained.** Processed in the ephemeral runner volume, deleted on run completion | Only derived findings and file-path references survive                                                              |
| 7   | Reports and rubric scores                | Scores, findings, remediation text                                         | Contract                                                                            | Life of account + 7 years for issued certifications                                   | Certification history must outlive the badge for audit                                                              |
| 8   | Badge issuance and events                | Badge ID, status transitions, referrer/origin of embeds                    | Contract / legitimate interest (anti-abuse)                                         | **Append-only, life of business**                                                     | Origin logging is anti-spoofing, not analytics                                                                      |
| 9   | Payments                                 | Stripe customer ID, invoice records, billing country                       | Contract / legal obligation (tax)                                                   | 7 years                                                                               | **No card data ever touches our systems**                                                                           |
| 10  | Human review actions                     | Reviewer identity, decision, written reason                                | Legitimate interest — rating integrity                                              | Append-only, life of business                                                         | Auditable per the independence policy                                                                               |
| 11  | Cost records                             | Token counts, compute seconds, cost                                        | Legitimate interest — business operation                                            | 24 months                                                                             | No personal data                                                                                                    |
| 12  | Transactional email                      | Email address, delivery status                                             | Contract                                                                            | 24 months                                                                             | Marketing consent tracked separately and never assumed                                                              |
| 13  | Support correspondence                   | Whatever the customer writes to us                                         | Contract / legitimate interest                                                      | 24 months after closure                                                               |                                                                                                                     |
| 14  | Cookie and analytics data                | Session cookie; analytics only with consent                                | Contract (session) / consent (analytics)                                            | Session; analytics 14 months                                                          | Genuine consent mechanism, not a banner that only says "OK"                                                         |
| 15  | Builder profile                          | Chosen handle, display name, one line of self-description, published state | Consent (Art. 6(1)(a)) — it exists only because somebody asked for it               | Until deleted by its owner; taking it down is immediate and needs nobody's agreement  | The first thing here that describes a **person** rather than an application, which is why it is off until published |
| 16  | Decision to show an application publicly | Application, organisation, the user who decided, and when                  | Consent — one row is one decision, and deleting it is how the decision is withdrawn | Until withdrawn; the user reference is nulled if the account goes                     | Included in a subject access export, because it is an act by a person rather than a property of a page              |
| 17  | Trust page written by the owner          | Support address, security contact, status and policy links, a short note   | Contract / legitimate interest — the owner publishing their own contact details     | Until deleted or unpublished by its owner                                             | Business contact details, not personal ones. Shown under the owner's name with a line saying we did not check it    |

## Data we refuse to collect

- End-user personal data belonging to the customer's users.
- Real user credentials for the customer's app. Test accounts must be **synthetic**, provisioned by
  the customer for the purpose, and we say so in writing before any run.
- Payment card data.
- Special-category data of any kind.

## Data subject rights

Access, correction, deletion, portability and objection are implemented as **working in-product
flows** backed by the `data_requests` table, not as an email address in a footer. Append-only tables
(`audit_log`, `badge_events`, `authorisations`) are exempt from deletion where retention is required
to establish or defend legal claims; the exemption and its basis are shown to the requester rather
than silently applied.

## Sub-processors

| Sub-processor                                 | Purpose                           | Region                       |
| --------------------------------------------- | --------------------------------- | ---------------------------- |
| Anthropic                                     | AI analysis and synthesis         | US                           |
| Supabase                                      | Database, authentication, storage | EU                           |
| Vercel                                        | Web hosting                       | EU edge, global CDN          |
| Stripe                                        | Payments and tax                  | Global                       |
| Sentry                                        | Error monitoring                  | EU                           |
| Email provider (Resend or Postmark)           | Transactional email               | US/EU — decide before launch |
| Sandbox host (Fly Machines / Cloud Run / E2B) | Ephemeral test runners            | EU — decide before M1        |

Customers are notified before a sub-processor is added or changed.
