# Wat jy moet doen

Alles wat op jou wag, in volgorde. Niks hiervan kan ek vir jou doen nie — ek het
nie toegang tot Vercel, Supabase, Render of Resend nie.

Laas nagegaan 2026-10-05.

---

## 1 · Vercel — die badge is hierdeur af

**Bevestig op 2026-10-06 uit die produksie-log:**

```
getaddrinfo ENOTFOUND db.laootpvjfsrvllmxjzgu.supabase.co
```

`SUPABASE_DB_URL` is die **direkte** gasheer. Dié gasheer publiseer geen
IPv4-adres nie en Vercel se funksies kan nie oor IPv6 uitgaan nie, so die adres
word nie eers opgesoek nie. Elke navraag misluk voordat enige wagwoord gebruik
word.

### Kry die regte string

1. Supabase → Settings → Database → **Connection string**
2. Bo-aan die boks is keuses: **Direct connection** · **Transaction pooler** ·
   **Session pooler**. Dit kan ook 'n aftrek-lysie wees wat "Direct connection"
   sê.
3. **Klik "Transaction pooler".** Die paneel wys standaard die direkte een — dit
   is die hele strik.
4. Kopieer dié een.

Die string moet al drie hê:

| Deel          | Moet wees                                 |
| ------------- | ----------------------------------------- |
| Gebruikersnaam | `postgres.laootpvjfsrvllmxjzgu` — met die punt |
| Gasheer       | bevat `pooler.supabase.com`               |
| Poort         | `6543`                                    |

Bevat dit nog `db.laootpvjfsrvllmxjzgu.supabase.co`, is dit die verkeerde een.

### Die wagwoord

Die databasis het sy eie wagwoord, gestel toe die projek geskep is. Dit is
**nie** jou Supabase-, GitHub- of Google-aanmelding nie. Supabase wys dit nooit
— daarom staan daar `[YOUR-PASSWORD]`.

Onseker? Settings → Database → **Reset database password**, en kies een met net
letters en syfers. Dan is daar niks om te omskakel nie.

Bevat die wagwoord `@`, `:`, `/`, `?`, `#`, `%`, `&` of 'n spasie, moet dit
omgeskakel word (`@` word `%40`, ensovoorts). Daar moet presies **een** `@` in
die hele string wees, net voor die gasheer.

'n Nuwe wagwoord moet op **twee** plekke in: Vercel én Render.

### Sit dit in

1. Vercel → Settings → Environment Variables → `SUPABASE_DB_URL` → **Edit**
2. Vervang die hele waarde. Vervang `[YOUR-PASSWORD]` — hakkies en al.
3. Production, Preview en Development almal gemerk → **Save**
4. Ook `NEXT_PUBLIC_SITE_URL` = `https://vibefycode.com`
5. **Deployments → boonste → `⋯` → Redeploy**

**Klaar as:** die badge is terug op futurebox.

### Hoe jy nagaan of dit gewerk het

Ek kan nie van my omgewing af by vibefycode.com uitkom nie — die netwerkbeleid
blokkeer dit. Jy moet dit meet. Drie dinge, in hierdie volgorde:

1. **Maak https://vibefycode.com oop.**
   - Laai → die ontplooiing is gesond.
   - "Application error" of 500 → die app bou nie, nie die databasis nie.

2. **Maak https://vibefycode.com/directory oop.** Dit lees die databasis.
   - Laai, selfs leeg → die konneksiestring werk.
   - 500 of 'n fout → `SUPABASE_DB_URL` is steeds verkeerd.

3. **Maak die futurebox-bladsy oop** waar die badge was.
   - Badge wys → klaar.
   - Grys raampie wat "status unavailable" sê → die app leef maar die databasis
     antwoord nie. Dis die konneksiestring.
   - Net woorde, geen prentjie → die roete self antwoord nie. Sê my.

Sê my net watter van die drie breek, en by watter stap. Dan weet ek presies
waar om te kyk.

## 1b · Futurebox — die embed wys na 'n dooie adres

Aparte probleem van bo, en dit moet ná stap 1.

Die snit op futurebox is in Augustus gekopieer en wys na
`vibefy-web-lyart.vercel.app`, wat nie meer bestaan nie. Daarom wys daar net
woorde, selfs al werk alles aan ons kant.

Sodra die databasis antwoord:

1. Teken in by `https://vibefycode.com/console`
2. Gaan na die futurebox-toepassing se bladsy
3. Onder **Your badge** → **Embed it**, kopieer die nuwe snit (dié een wys na
   `vibefycode.com`)
4. Vervang die ou snit op futurebox se bladsy

**Klaar as:** die badge wys op futurebox.

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
