# Open items

Everything stubbed, deferred or awaiting a founder decision. Anything named `STUB_` in the
codebase must appear here. Nothing leaves this list silently.

## Awaiting founder input

| Item | Blocking | Notes |
|---|---|---|
| Legal entity and jurisdiction | Legal drafts can be finalised, not started | Drafts are written GDPR-grade; selecting a jurisdiction is a variant switch |
| Primary domain (`vibefy.app` / `.io` / `getvibefy.com`) | Badge origin, email sending domain, OAuth callbacks | `verify.<domain>` must be a separate subdomain from the app |
| Contact email | Legal documents, transactional email `From` address | |
| Trademark search for "Vibefy" and "Verified by Vibefy", classes 42 and 35 | Brand spend, launch | See `BUSINESS_CHECKLIST.md`; a trust mark we do not own is not a trust mark |
| Lossless originals of the two brand marks | Highest-fidelity derivative export | Supplied artwork is 300dpi JPEG; vector or PNG originals would improve the traced marks |

## Deferred by milestone

| Item | Deferred to | Reason |
|---|---|---|
| Assessment engine pipeline | M1 | M0 is foundations only |
| Stripe integration, invoices, tax | M2 | |
| Badge issuance, signing, verification page | M3 | The Ed25519 key pair is not generated until M3 so it is never committed to a repo that predates it |
| Continuous monitoring and drift detection | M4 | |
| Agency and organisation surfaces, SSO | M5 | |
| Expo mobile app | M6 | |
| Public directory | M7 | Cold-start: a directory of nothing helps nobody |
| Marketing arm | M8 | Blocked on the independence policy being implemented and documented |

## Stubs in the codebase

| Symbol | File | Replaced by |
|---|---|---|
| _(none yet)_ | | |
