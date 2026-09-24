# vibefycode.com

Registered 2026-09-24 at **$9.08 per year**. This file is the one place that says
what lives on that domain, what each address is for, and what it costs to keep.

Two things in here are certain and two are not, and the difference matters more
than anything else on the page:

- **Certain:** which addresses the product needs, which environment variables
  read them, and how the sending domain is split. Those are facts about this
  codebase, checked against it.
- **Not certain:** the exact DNS record values for Zoho and for Resend. Their own
  setup wizards print those, per account and per region, and they change. Where a
  value below is theirs rather than mine it is marked **[from their dashboard]**.
  Take theirs, not mine.

---

## 1. What the domain serves

| Host                  | Serves                                             | Where it points                   |
| --------------------- | -------------------------------------------------- | --------------------------------- |
| `vibefycode.com`      | The console, the verification pages, the directory | Vercel                            |
| `www.vibefycode.com`  | A redirect to the apex                             | Vercel                            |
| `send.vibefycode.com` | Outbound email only. No web content.               | Resend **[from their dashboard]** |

`NEXT_PUBLIC_SITE_URL=https://vibefycode.com` on Vercel **and** on the worker's
own environment. A full URL: scheme, host, no trailing slash, no path. The worker
has no request to fall back on, and without it badges are issued and the
announcement email is skipped with `badge issued but not announced` in the log.

## 2. Why the sending domain is a subdomain

Zoho owns the apex, Resend owns `send.vibefycode.com`, and nothing overlaps.

Two systems sharing one apex have to share one SPF record, because a domain may
publish exactly one — a second SPF record makes both invalid, not one. Merging
two `include:` mechanisms by hand is then a manual step that has to be redone
every time either provider changes theirs, and the failure is silent: mail keeps
being accepted and starts landing in spam weeks later, in bulk, with nothing in
any log.

On a subdomain each side publishes its own SPF, its own DKIM and its own MX, and
neither can break the other. It also means a reputation problem on our automated
mail never touches the mailbox a customer replies to.

**This is worth doing before the first email goes out and unpleasant afterwards.**
Reputation attaches to a domain over time; moving the sending domain later throws
that away and starts again.

## 3. Mailboxes on Zoho

Four addresses, all of them read by a person. None of them a no-reply.

| Address                   | What it is for                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `support@vibefycode.com`  | The address a customer writes to. **Our own rubric checks other people's applications for one of these (PRI-07)** and a no-reply address fails it, so ours answering is not optional. |
| `security@vibefycode.com` | Where somebody reports a defect in _our_ product. We ask every customer for one; a rating service without one is not in a position to.                                                |
| `privacy@vibefycode.com`  | The data-subject route. The drafted privacy notice names an address and a person has to read it — a POPIA or GDPR request has a clock on it from the moment it arrives.               |
| `alerts@vibefycode.com`   | The worker's outbound sender. Mail _from_ here, over `send.vibefycode.com`; replies go to `support@`.                                                                                 |

Read by:

```
ALERT_EMAIL_FROM="VibefyCode <alerts@vibefycode.com>"
ALERT_EMAIL_REPLY_TO=support@vibefycode.com
```

`support@` has no variable yet, because nothing in the product renders it yet.
That is on `docs/OPEN_ITEMS.md`, and a variable nothing reads is worse than an
absent one — it reports success.

`legal@` and `dpo@` are worth adding as **aliases onto `privacy@`** rather than as
mailboxes. A drafted document that names an address nobody watches is worse than
one that names a shared inbox.

## 4. DNS

In this order. Zoho first, because its verification has to complete before
mailboxes can receive.

### Zoho, on the apex

1. **Domain verification** — a TXT or CNAME record, value **[from their
   dashboard]**. Zoho will not create mailboxes until it resolves.
2. **MX**, on the apex. Zoho's current set is three records at priorities 10, 20
   and 50 **[from their dashboard]** — confirm the hostnames there rather than
   from any article, including this one. They have changed.
3. **DKIM** — a TXT record at a selector Zoho chooses **[from their dashboard]**.
   Turn DKIM on in Zoho after publishing it; publishing without enabling, or
   enabling without publishing, both end in unsigned mail.
4. **SPF**, on the apex, exactly one record:

   ```
   v=spf1 include:zoho.com ~all
   ```

   No Resend include here. That is the entire point of the split.

### Resend, on `send.vibefycode.com`

Everything Resend needs is under that label: its own SPF, its own DKIM, and an MX
for return-path handling. All **[from their dashboard]** — Resend's values depend
on the region the account sits in, and a record copied from the wrong region
fails verification with a message that does not say why.

### DMARC, once both of the above verify

One record, at `_dmarc.vibefycode.com`:

```
v=DMARC1; p=none; rua=mailto:dmarc@vibefycode.com; fo=1
```

`p=none` first, on purpose. It changes nothing about delivery and starts the
reports arriving, so the first thing you learn is what is _already_ sending as
you — which on a new domain is usually nothing, and occasionally a surprise.
Leave it two weeks, read the reports, then move to `p=quarantine` and later
`p=reject`. Going straight to `p=reject` on a domain whose DKIM has a typo in it
means every email vanishes and no bounce explains it.

Point `dmarc@` at `privacy@` or a folder. The reports are XML and nobody reads
them by hand; a free aggregator is fine and none of it is customer data.

## 5. What it costs to keep

The domain is the first standing cost this business has. It is small and it is
not the point — the point is that the list exists and has one honest number in it,
because a business plan with no fixed costs is the one that runs out of money
while the unit economics look fine.

| Standing cost    | Per year   | Per month  | Basis                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------- | ---------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vibefycode.com` | **$9.08**  | **$0.76**  | Paid 2026-09-24. Renews annually.                                                                                                                                                                                                                                                                                                                                                                                                             |
| Zoho Mail        | to fill in | to fill in | Free for one mailbox on one domain with limits; four addresses may need the paid tier. Put the real number here once you pick.                                                                                                                                                                                                                                                                                                                |
| Vercel           | to fill in | to fill in | Free while it is one person and hobby usage. Becomes real at the first paid seat.                                                                                                                                                                                                                                                                                                                                                             |
| Supabase Pro     | ~$300      | **$25**    | Upgraded 2026-09-24. $25 is the plan's base; compute above the included size and any add-on are billed on top, so confirm against the first invoice rather than this row. What it bought that matters: the project no longer pauses when idle, which on the free tier was a production incident dressed as a saving, and daily backups with a seven-day window now exist. Point-in-time recovery is a separate paid add-on and is **not** on. |
| Resend           | to fill in | to fill in | Free to a monthly volume; the first paid tier arrives with the customers.                                                                                                                                                                                                                                                                                                                                                                     |
| The worker host  | to fill in | to fill in | A machine that can hold Chromium open for minutes. Vercel functions cannot — see the runbook.                                                                                                                                                                                                                                                                                                                                                 |

**Where this sits against the prices.** A limited assessment costs us about $1 to
run (`config/pricing.json`, `ceilings.perRunCostUsd.limited`); a full one about
$4, against $79 for the one-off deep report and $49 a month for Certified.

So the domain is covered by **one free assessment's worth of margin, once a year**.
Supabase Pro is the number that actually matters now: **$25 a month is one
Certified customer, or one deep report every three months.** That is the first
real break-even this business has, and it is a low bar — which is worth saying
plainly, because the temptation with a standing bill is to stop looking at it.

The table exists to stop the arithmetic on
`/admin/costs` from looking like the whole picture. That dashboard shows unit
economics: cost per run against price per run. It does not know this table exists,
which is correct — mixing a standing cost into a per-run margin makes both numbers
mean nothing — and it is exactly why the table has to be written down somewhere.

Fill the rows in as you sign up for each. A row reading "to fill in" is honest; a
row reading "$0" because nobody checked is not.
