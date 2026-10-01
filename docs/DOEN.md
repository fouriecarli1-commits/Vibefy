# Wat jy moet doen

Alles wat op jou wag, in volgorde. Niks hiervan kan ek vir jou doen nie — ek het
nie toegang tot Vercel, Supabase, Render of Resend nie.

Laas nagegaan 2026-10-01.

---

## 1 · Vercel — die badge is hierdeur af

`SUPABASE_DB_URL` wys na die **direkte** databasis-gasheer. Dié gasheer het
**geen IPv4-adres** nie, en Vercel se funksies kan nie oor IPv6 uitgaan nie. Elke
navraag misluk. Daarom wys futurebox woorde in plaas van die badge.

1. Supabase → Settings → Database → Connection string → **Transaction pooler**
2. Kopieer dit **heel**. Vervang net `[YOUR-PASSWORD]`.
3. Vercel → Settings → Environment Variables → `SUPABASE_DB_URL` → plak → Save
4. Ook `NEXT_PUBLIC_SITE_URL` = `https://vibefycode.com`
5. **Deployments → boonste → `⋯` → Redeploy**

Die gebruikersnaam moet `postgres.laootpvjfsrvllmxjzgu` wees — met die punt. Net
`postgres` is die direkte een en dit werk nie.

**Klaar as:** die badge is terug op futurebox.

## 2 · Resend — druk Verify

Die ses DNS-rye is in en reg. Daar is niks meer by Spaceship te doen nie.

Resend → Domains → `send.vibefycode.com` → **Verify**.

Misluk dit, probeer nog een keer voor jy iets verander.

## 3 · Render — drie veranderlikes

`vibefycode-worker` → Environment:

```
RESEND_API_KEY       = die re_... sleutel
ALERT_EMAIL_FROM     = VibefyCode <alerts@vibefycode.com>
NEXT_PUBLIC_SITE_URL = https://vibefycode.com
```

Sonder aanhalingstekens. Save Changes.

**Klaar as:** Logs wys **geen** van hierdie drie reëls nie:

```
email not configured — alerts will reach the console and phones only
no model key — every submission waits for a reviewer at /review/screening
no verification origin — badges will be issued and never announced
```

## 4 · Supabase — ses migrasies

`docs/sql/OUTSTANDING.sql`, in volgorde, in die SQL-venster.

Die vyfde en sesde maak die meeste saak: die een keer 'n verwerping wat 'n
goedkeuring magtig, die ander 'n betaling wat twee keer toegepas kan word.

Pro gee daaglikse rugsteun met 'n sewe-dae-venster. Point-in-time recovery is 'n
aparte betaalde byvoeging en is **af** — die herstelverhaal vir 'n slegte
migrasie is "gister".

## 5 · Supabase — SMTP

Project Settings → Authentication → **SMTP Settings** → Resend.

Supabase se eie sender is 'n handjievol per uur op **elke** plan. Dit is waarom
jou reset-password nie gekom het nie.

Wag vir stap 2.

---

# Later, nie dringend nie

**Posbus.** `support@`, `security@`, `privacy@` op `vibefycode.com`. Zoho se
gratis plan bestaan nie meer vir nuwe rekeninge nie; Cloudflare Email Routing is
gratis en stuur na jou Gmail aan. Niks in die produk wag hierop nie.

**Google-aanmelding.** Die OAuth-kliënt se Client ID en secret in Supabase →
Authentication → Providers → Google. En jou epos as Test user, anders kry jy
`Error 403: access_denied`.

**Apex opruiming.** `vibefycode.com` het drie A-rekords; net `216.150.1.1` hoort
daar. Die webwerf werk, so dit is netheid.

---

# Besluite wat ek van jou nodig het

Nie werk nie — net 'n antwoord. Al die detail staan in `docs/OPEN_ITEMS.md`.

| Vraag                                                                     | Wat dit blokkeer                          |
| ------------------------------------------------------------------------- | ----------------------------------------- |
| Watter bladsy lees te veel? Noem een, ek sny dit.                         | Niks                                      |
| Mag 'n eienaar sy naam op sy verifikasie-bladsy sit?                      | Niks                                      |
| Moet die tweede stap verpligtend wees vir 'n rekening wat badges uitreik? | Niks                                      |
| Regsentiteit en jurisdiksie                                               | Die regsdokumente kan nie finaal word nie |
| Handelsmerk-soektog vir "VibefyCode"                                      | Bemarkingsbesteding en bekendstelling     |
| 'n Vektor-oorspronklike van die kleurmerk                                 | Die laaste getrekte weergawe              |
