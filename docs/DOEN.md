# Wat jy moet doen

Alles wat op jou wag, in volgorde. Niks hiervan kan ek vir jou doen nie — ek het
nie toegang tot Vercel, Supabase, Render of Resend nie.

Laas nagegaan 2026-10-08.

> **Daar is nou twaalf SQL-migrasies, nie agt nie.** `docs/sql/OPEN_ITEMS.md` se
> agt was reeds daar; die negende tot twaalfde is bygevoeg op 2026-10-07 en
> 2026-10-08, en staan onderaan `docs/sql/OUTSTANDING.sql`.
>
> **Die twaalfde is 'n tweelingbroer van die elfde, en net so dringend.** 'n
> Werkruimte-eienaar kon hul eie toepassing "cleared" maak onder die
> Aanvaarbare-Gebruik-beleid. Gemeet teen 'n toepassing wat 'n beoordelaar
> geweier het: `update public.apps set screening_status = 'cleared'` het
> `UPDATE 1` gegee. Daardie kolom is die hek wat keer dat ons iets assesseer en
> badge wat ons geweier het. Dieselfde reël het ook toegelaat dat 'n eienaar die
> teller terugstel wat hul badge opskort as hul werf af is. Die migrasie gee die
> sewe kolomme wat óns skryf net vir ons, en die uitspraak word nou deur ons
> bediener geskryf, nie deur die kliënt se aanmeldteken nie.
>
> **Die elfde is die dringendste ding in hierdie dokument, die badge inkluis.**
> 'n Kliënt kon hul eie telling skryf. Gemeet met 'n gewone kliënt se
> aanmeldteken, sonder enige bladsy — net Supabase se eie API: 'n nuwe
> assessering met `status = 'awaiting_review'`, `overall_score = 100` en
> `certification_eligible = true`, en ook 'n bestaande assessering van 39 wat na
> 99 herskryf is. `awaiting_review` is presies die status wat die
> beoordelaarsbladsy lys, so so 'n ry gaan voor 'n mens wat 100 sien en geen
> bevindinge nie. Niks in die produk het hierdie reg nodig nie — die enjin skryf
> assesserings op sy eie verbinding, en 'n kliënt vra een aan deur
> `assessment_requests`. Die migrasie neem die reg weg.
>
> Die negende verander drie vreemde-sleutels op `cost_records` sodat 'n
> werkruimte-verwydering nie die finansiële rekords saamneem wat die
> bewaarskedule sê ons sewe jaar moet hou nie. Niks in die produk vee 'n
> werkruimte uit, so dit is nie dringend nie — dit is 'n valstrik vir die dag
> dat iemand dit met die hand doen.
>
> **Die tiende maak wel saak, en hoe gouer hoe beter.** Postgres gee EXECUTE op
> 'n nuwe funksie by verstek aan almal, en Supabase publiseer elke funksie in
> `public` as `/rpc/<naam>` op die internet. Ses funksies wat met die eienaar se
> regte lees — dus verby elke RLS-reël — was dus vir enigiemand sonder rekening
> beskikbaar. Gemeet: `spend_since` gee $2.31 terug aan die `anon`-rol, teen 'n
> tabel waarvan die reël sê selfs 'n beoordelaar dit nie mag sien nie. Die
> migrasie neem daardie regte weg. Niks in die produk roep die ses deur Supabase
> nie — die werker praat direk met die databasis as die eienaar — so daar is
> niks wat dit kan breek nie.

> **Hoekom dit nou dringender is.** Solank die databasis onbereikbaar is, sê
> `/verify` vir enigiemand wat 'n kliënt se badge natrek: _"VibefyCode has never
> issued that badge — treat the mark as unverified"_, met 'n skakel om dit te
> rapporteer. Dit was 'n `.catch(() => null)` wat "die lees het misluk" en "so 'n
> badge bestaan nie" dieselfde ding gemaak het. Die kode is reg — dit sê nou dat
> dit 'n fout aan ons kant is en dat niks vasgestel is nie — maar dit help eers
> wanneer jy stap 3 hieronder doen en Vercel herontplooi.

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

## 4 · Supabase — twaalf migrasies

`docs/sql/OUTSTANDING.sql`, in volgorde, in die SQL-venster.

Die vyfde en sesde maak die meeste saak: die een keer 'n verwerping wat 'n
goedkeuring magtig, die ander 'n betaling wat twee keer toegepas kan word. Die
sewende hou die telling op die badge en die telling in die verslag dieselfde —
niks het dit voorheen gekeer nie. Die agtste laat die databasis 'n weiering by
inname neerskryf; die bedienerhandeling het dit probeer en is elke keer deur
row-level security geweier, stil. Die tiende neem die EXECUTE-reg weg van ses
funksies wat ons koste- en sitplekgetalle aan 'n onaangemelde besoeker gegee
het. **Die elfde en twaalfde maak die meeste saak van almal:** die een keer dat
'n kliënt hul eie telling skryf, die ander dat hulle hul eie toepassing
goedkeur onder die Aanvaarbare-Gebruik-beleid. Doen daardie twee eerste.

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
