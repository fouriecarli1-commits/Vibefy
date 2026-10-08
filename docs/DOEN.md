# Wat jy moet doen

Alles wat op jou wag, in volgorde. Niks hiervan kan ek vir jou doen nie — ek het
nie toegang tot Vercel, Supabase, Render of Resend nie.

Laas nagegaan 2026-10-08.

> **Eerste, en dit neem een minuut: Vercel → Deployments → boonste een → ⋯ →
> Redeploy.**
>
> Die badge behoort daarna te werk sonder dat jy iets anders regmaak. Die badge
> en `/verify` het elkeen net een ry nodig, en daardie ry is openbaar: Supabase
> se eie API kan dit oor HTTPS gee met die publieke sleutel wat jou konsole al
> die tyd gebruik, sonder enige databasis-URL. Niks het daardie pad gebruik nie.
> Nou probeer dit eers die direkte verbinding, en val dan daarop terug.
>
> **Klaar as:** die badge wys 'n telling in plaas van grys.
>
> **Maak dit steeds reg.** Die terugvalpad werk net vir die badge en
> `/verify`. Jou konsole, die verslae en die werker het nog die direkte
> verbinding nodig, en elke keer wat dit terugval skryf dit 'n fout in die log —
> 'n badge wat werk oor 'n stukkende verbindingstring is nog steeds stukkend.
> Stappe 0 tot 3 hieronder.

> **Tweede, en dit is die belangrike een.** Die badge was 'n uitval; hierdie
> is gate.
>
> Daar is sewentien migrasies in `docs/sql/OUTSTANDING.sql`. Sewe is van
> vanaand, en vier van daardie sewe is gate wat iemand vandag kan gebruik:
>
> - 'n Kliënt kon hul **eie telling** skryf — 100 uit 100, met nul bevindinge,
>   en dit gaan voor 'n beoordelaar.
> - 'n Kliënt kon hul **eie toepassing goedkeur** nadat ons dit onder die
>   Aanvaarbare-Gebruik-beleid geweier het.
> - 'n Kliënt kon sê hulle **besit 'n domein wat nie hulle s'n is nie**, en ons
>   sou dit gaan toets. Dit is die een met regsgevolge, want die skade val op
>   iemand anders.
> - 'n Kliënt kon hul **eie plan en bestedingsplafon** skryf.
>
> Die ander drie is 'n admin wat hulself eienaar maak, iemand wat 'n
> e-pos-domein eis en almal daar uitsluit, en rekords wat hul eie subjek kon
> skryf. Elke migrasie verduidelik homself bo-aan sy eie blok — jy hoef dit nie
> hier te lees nie.
>
> Supabase se SQL-venster werk ongeag of Vercel die databasis kan bereik, so die
> badge hoef nie eers reg te wees nie.
>
> **Klaar as:** jy het al sewentien blokke uit `docs/sql/OUTSTANDING.sql` in
> volgorde geplak en elkeen het sonder 'n fout geloop. Onseker wat jou databasis
> al het? `node tools/migration-audit.mjs > audit.sql`, plak daardie navraag, en
> dit sê jou — dit lees net.

---

## 0 · Stel die databasiswagwoord nuut

Op 2026-10-06 het die wagwoord in 'n skermskoot in die gespreksvenster beland —
Supabase se "Connect"-venster wys dit in gewone teks in die konneksiestring, en
daardie skermskoot is gestuur.

Niemand anders het dit gesien nie, en niks dui op misbruik nie. Maar 'n wagwoord
wat buite 'n wagwoordbestuurder beland het, is nie meer 'n geheim nie, en die
bouopdrag se eie reël is dat ons nie die diens kan wees wat geloofsbriewe lek nie.

Supabase → Settings → Database → **Reset database password**. Kies een met net
letters en syfers.

Daarna gaan dit op twee plekke in: Vercel en Render, soos in stap A en C hieronder.
Doen hierdie eerste, dan is daar net een rondte.

**Klaar as:** die nuwe wagwoord is in 'n wagwoordbestuurder, en in albei panele.

---

## 1 · Die badge — drie stappe

Op 2026-10-06 uitgepluis tot op die bodem. Geen raaiwerk oor nie.

**Wat verkeerd is:** Supabase bied twee poolers aan. Die een wat jou paneel
standaard wys — **Dedicated pooler** — sit op `db.laootpvjfsrvllmxjzgu.supabase.co`,
dieselfde gasheernaam as die direkte verbinding. Daardie naam publiseer **geen
IPv4-adres** nie, net IPv6, en Vercel se funksies het geen IPv6-roete nie. Supabase
se eie banier in daardie venster sê dit: _"Transaction pooler uses IPv6 by default."_

Die **Shared pooler** is die een wat werk. Ander gasheer, ander gebruikersnaam.

---

### Stap A · Render eerste

Doen hierdie vóór Vercel. Die werker probeer met 'n ou wagwoord inteken, en
Supabase se pooler het 'n stroombreker getrek wat **alle** nuwe konneksies blokkeer
— ook Vercel s'n. Solank dit loop, kan niks anders getoets word nie.

Render → `vibefycode-worker` → **Environment** → `SUPABASE_DB_URL` → vervang net
die stukkie tussen die `:` en die `@` met die huidige wagwoord → **Save Changes**.

**Klaar as:** Render se Logs wys geen `password authentication failed` meer nie.

Kry jy nie die wagwoord nie: Render → die diens → regs bo **⋯** → **Suspend
Service**. Dit stop die hamer ook.

---

### Stap B · Supabase → die regte string

1. Supabase → **Connect** (die knoppie bo-aan, langs die tak-kieser)
2. Die venster wys standaard **Dedicated pooler**. Daar is 'n keuse — 'n tab of
   'n aftrek-lysie. Kies **Shared pooler**.
3. Kopieer daardie string.

Hoe jy weet jy het die regte een:

| Deel | Shared pooler (reg)             | Dedicated pooler (werk nie)           |
| ---- | ------------------------------- | ------------------------------------- |
| host | eindig op `pooler.supabase.com` | `db.laootpvjfsrvllmxjzgu.supabase.co` |
| user | `postgres.laootpvjfsrvllmxjzgu` | `postgres`                            |
| port | `6543`                          | `6543`                                |

Die **user** is die vinnigste toets. Staan daar net `postgres`, is dit die
verkeerde een.

---

### Stap C · Vercel

1. Vercel → `vibefy-web` → Settings → **Environment Variables**
2. `SUPABASE_DB_URL` → **⋯** → Edit → vervang die hele waarde met die shared
   pooler-string, met die wagwoord ingevul (geen `[` `]` oor nie)
3. Production, Preview, Development almal gemerk → **Save**
4. **Deployments → boonste → ⋯ → Redeploy**, "Use existing Build Cache" ongemerk

'n Nuwe waarde raak nooit 'n bestaande ontplooiing nie. Sonder die redeploy
gebeur niks.

---

### Toets

In 'n privaat venster:

```
https://vibefycode.com/badge/nonexistent-test-id.svg
```

- **Badge wat "revoked" sê** → klaar. Gaan na stap 1b.
- **Grys raampie** → Vercel → Logs (tyd-kieser op **Live**) → tref die bladsy
  weer → klik die `/badge/...`-reël → maak die **Logs**-paneel onder oop.

Die boodskap daar is nou 'n vol sin wat sê wat om te verander. Sy drie vorms:

| Begin met                                               | Beteken                                 |
| ------------------------------------------------------- | --------------------------------------- |
| `...which is the dedicated pooler`                      | Nog die verkeerde pooler — terug stap B |
| `...uses the pooler host but the username "postgres"`   | Shared pooler, verkeerde gebruikersnaam |
| `...still contains [YOUR-PASSWORD]`                     | Die plekhouer is nie vervang nie        |
| `circuit breaker` of `too many authentication failures` | Render hamer nog — terug stap A         |

### Nooit nodig nie

- Die wagwoord weer reset. Dit was nooit die probleem nie.
- Die **Enable IPv4 add-on** koop. Dit sou werk en dit kos maandeliks; die
  gedeelde pooler is gratis en doen dieselfde.
- Enigiets in die kode verander.

---

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

## 4 · Supabase — sewentien migrasies

**Begin hier, nie by 0 nie.** Hierdie afdeling is die een wat nie kan wag nie;
0 tot 3 is die badge, en die badge is 'n uitval, nie 'n gat nie.

`docs/sql/OUTSTANDING.sql`, van bo na onder, in Supabase se SQL-venster. Plak
een blok op 'n slag. Elke blok begin met 'n verduideliking van wat dit regmaak
en hoekom — jy hoef niks daarvan hier te lees nie.

**Klaar as:** al sewentien het sonder 'n fout geloop.

As een misluk met iets soos "already exists":

```
node tools/idempotent-catch-up.mjs > catch-up.sql
```

Dit skryf dieselfde migrasies oor in 'n vorm wat twee keer geplak kan word —
alles wat al daar is word stil oorgeslaan. Plak `catch-up.sql` in plaas van die
een wat misluk het.

En as jy nie weet waar jou databasis staan nie:

```
node tools/migration-audit.mjs > audit.sql
```

Plak `audit.sql`. Dit lees net, skryf niks, en gee jou een reël per migrasie met
"missing" of "nothing missing".

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
