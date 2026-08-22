# Authorisation to Test & Customer Warranty

> **DRAFT — REQUIRES REVIEW BY QUALIFIED COUNSEL IN [JURISDICTION] BEFORE USE.**
> Not legal advice. Not a substitute for a lawyer.

**Version:** 1.0.0-draft · **Status:** not in force · **Baseline:** GDPR-grade

---

This is the document you accept before any assessment runs. Your acceptance is recorded with
the version, a hash of these exact words, the timestamp, your IP address and your user agent,
in an append-only record that we cannot subsequently edit. That record is the evidence that our
testing was lawful.

## 1. Why this exists

Testing a computer system without authorisation is a criminal offence in most jurisdictions,
including under the UAE Cybercrime Law, the US Computer Fraud and Abuse Act, the UK Computer
Misuse Act and the South African ECT Act. Vibefy's adversarial pass makes that risk real rather
than theoretical. We therefore do not begin any run until this warranty is in place.

## 2. What you warrant

By accepting, you warrant that:

1. **You are entitled to authorise testing** of the target application, either because you own
   it or because you are contractually authorised by its owner to authorise testing on their
   behalf;
2. **You have identified every third party** whose infrastructure or platform is involved —
   your host, your database provider, your authentication provider, any payment processor —
   and you have satisfied yourself that testing is permitted under their terms;
3. **The scope you declared is accurate**: the in-scope domains and endpoints are yours to
   authorise, and the exclusions are complete;
4. **No third party's production data** will be exposed to testing, and any account we are
   asked to use is a **synthetic test account** created for this purpose;
5. You have the authority to bind the organisation on whose behalf you are accepting.

## 3. What you authorise

You authorise Vibefy, for the period stated, to perform against the declared scope:

- Automated retrieval and inspection of publicly reachable resources;
- Automated browsing of the application, including sign-up, sign-in and core flows, using the
  test account you provide;
- Non-destructive probing for the classes of defect described in the published methodology.

## 4. What you do not authorise, and what we will not do

We will not, and the sandbox is configured so that we cannot:

- Modify, delete or exfiltrate data;
- Perform denial-of-service or load testing;
- Attempt to escalate outside the declared scope;
- Test any host not on the allowlist you declared;
- Persist anything on your systems;
- Use real end-user credentials or process your end users' personal data.

These constraints are enforced as runner configuration at network level. They are not
instructions to a model, and the model cannot widen them.

## 5. Intensity ceiling

Requests are rate-limited, the run has a hard time ceiling, and the run is killed on breach of
either. The exact ceilings applied to your run are recorded with the authorisation.

## 6. Withdrawal

You may withdraw this authorisation at any time from your console. Withdrawal is immediate:
in-flight runs abort, and no new run starts. Withdrawal is recorded as a new authorisation
record superseding this one — nothing is deleted, because the history is the evidence.

## 7. Your indemnity

You indemnify Vibefy against any claim, loss or reasonable cost arising from this warranty
being untrue, including any claim by an owner, host or platform provider whose system was
tested in reliance on it.

## 8. If we find a live exposure

If we discover an exposure of third-party personal data, the Responsible Disclosure Policy
applies: we will tell you first, on a stated deadline, before any other step.
