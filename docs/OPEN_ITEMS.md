# Open items

Everything stubbed, deferred or awaiting a founder decision. Anything named `STUB_` in the
codebase must appear here. Nothing leaves this list silently.

## Awaiting founder input

| Item                                                                      | Blocking                                            | Notes                                                                                   |
| ------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Legal entity and jurisdiction                                             | Legal drafts can be finalised, not started          | Drafts are written GDPR-grade; selecting a jurisdiction is a variant switch             |
| Primary domain (`vibefy.app` / `.io` / `getvibefy.com`)                   | Badge origin, email sending domain, OAuth callbacks | `verify.<domain>` must be a separate subdomain from the app                             |
| Contact email                                                             | Legal documents, transactional email `From` address |                                                                                         |
| Trademark search for "Vibefy" and "Verified by Vibefy", classes 42 and 35 | Brand spend, launch                                 | See `BUSINESS_CHECKLIST.md`; a trust mark we do not own is not a trust mark             |
| Lossless originals of the two brand marks                                 | Highest-fidelity derivative export                  | Supplied artwork is 300dpi JPEG; vector or PNG originals would improve the traced marks |

## Deferred by milestone

| Item                                       | Deferred to | Reason                                                                                             |
| ------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------- |
| Assessment engine pipeline                 | M1          | M0 is foundations only                                                                             |
| Stripe integration, invoices, tax          | M2          |                                                                                                    |
| Badge issuance, signing, verification page | M3          | The Ed25519 key pair is not generated until M3 so it is never committed to a repo that predates it |
| Continuous monitoring and drift detection  | M4          | Delivered — see MILESTONES.md                                                                      |
| Agency and organisation surfaces, SSO      | M5          | Delivered — see MILESTONES.md                                                                      |
| Expo mobile app                            | M6          | Delivered — see MILESTONES.md                                                                      |
| Public directory                           | M7          | Cold-start: a directory of nothing helps nobody                                                    |
| Marketing arm                              | M8          | Blocked on the independence policy being implemented and documented                                |

## Known gaps in shipped code

Things that work but are narrower than they will need to be. Each is here so it cannot be
mistaken for finished.

| Gap | Where | Why it is acceptable for now |
| --- | --- | --- |
| Email alerts are not sent | `alerts.delivery_channel` is only ever `push` | M6 delivers to phones that have the app installed. For everyone else the console is still the only place an alert appears. Adding an email sender is another sweep beside `sweepAlertPush`, not a migration. |
| EAS build and store submission are not configured | `apps/mobile` | The app runs in Expo Go and a development build. `eas.json`, signing credentials and store listings need the Apple and Google accounts, which follow the legal-entity decision. |
| The liveness probe bypasses the scope guard | `apps/worker/src/monitoring.ts`, `httpLivenessProbe` | It is a single GET to the badge's own certified origin, which is narrower than any authorised scope. It should still go through the guarded dispatcher so there is one egress path, not two. |
| Badge fidelity against the supplied artwork | `packages/badge/src/render.ts` | The marks are traced from 300dpi JPEG; vector originals would close the delta. |
| The `verify.` subdomain is not deployed | Routing | The routes exist and work; host-based routing is blocked on the domain decision. |
| Key-compromise re-signing is manual | `docs/RUNBOOK.md` | Planned rotation is covered by keeping retired keys published. A bulk re-signing script is not written. |
| Identity-provider registration is an operator step | `/console/workspace/<id>/sso` | The domain claim, DNS verification, enforcement and sign-in routing are built. Registering the SAML/OIDC provider with the auth service is manual, and the console says so. |
| Invitation emails are not sent | `/console/workspace/<id>/team` | The link is shown once to the inviter, who passes it on. Stated plainly rather than implied — same missing email sender as the alerts. |
| The portfolio evaluates a policy without findings | `apps/web/app/console/portfolio/page.tsx` | The dashboard row carries the score and dimensions but not the findings, so a profile's severity ceiling is evaluated on the report instead. A row that carried every finding for every application would be a portfolio page that loads in seconds. |
| Domain discovery on sign-in is unauthenticated | `public.sso_routing` | It confirms that one exact domain enforces single sign-on. Every enterprise sign-in performs the same step; it reveals no organisation name, size or unenforced connection. |

## Stubs in the codebase

| Symbol       | File | Replaced by |
| ------------ | ---- | ----------- |
| _(none yet)_ |      |             |
