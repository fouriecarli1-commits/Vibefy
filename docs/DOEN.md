# Wat jy moet doen

Alles wat op jou wag, in volgorde. Niks hiervan kan ek vir jou doen nie — ek het
nie toegang tot Vercel, Supabase, Render of Resend nie.

Laas nagegaan 2026-10-11.

> **Eerste, en dit neem een minuut: Vercel → Deployments → boonste een → ⋯ →
> Redeploy.**
>
> Die badge behoort daarna te werk sonder dat jy iets anders regmaak. Die badge
> en `/verify` het elkeen net een ry nodig, en daardie ry is openbaar: Supabase
> se eie API kan dit oor HTTPS gee met die publieke sleutel wat jou konsole al
> die tyd gebruik, sonder enige databasis-URL. Niks het daardie pad gebruik nie.
> Nou probeer dit eers die direkte verbinding, en val dan daarop terug.
>
> Vier ander foute in die badge-pad self is sedertdien reggemaak. Een daarvan
> het elke badge sonder `?size=` in die URL as 'n klein grys raampie van 64
> pixels gewys in plaas van volle grootte — dit is wat jy op die toets-URL
> hieronder sou gesien het. Die badge op futurebox is 'n ander saak: daardie
> snit wys na 'n adres wat nie meer bestaan nie, en afdeling 1b hanteer dit.
> Die redeploy bring die vier saam.
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
> Daar is negentien migrasies in `docs/sql/OUTSTANDING.sql`. Sewe is van
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
> skryf. Die laaste twee is klein en nie gate nie: een voeg 'n waarde by 'n
> lys sodat ons jou kan sê wanneer 'n baadjie verstryk het, en een voeg 'n
> kolom by 'n lys wat ons publiseer, sodat die etiket "hierdie eienaar koop
> bemarking by ons" ook daar verskyn. Ons beleid belowe dit oral waar 'n
> telling verskyn, en op die twee masjien-adresse was dit nie. Elke migrasie
> verduidelik homself bo-aan sy eie blok — jy hoef dit nie hier te lees nie.
>
> Supabase se SQL-venster werk ongeag of Vercel die databasis kan bereik, so die
> badge hoef nie eers reg te wees nie.
>
> **Klaar as:** jy het al negentien blokke uit `docs/sql/OUTSTANDING.sql` in
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

Die boodskap daar is nou 'n vol sin wat sê wat om te verander. Elke vorm wat dit
kan wees, en wat dit beteken:

| Die sin bevat                           | Beteken                                           |
| --------------------------------------- | ------------------------------------------------- |
| `is not a URL`                          | Nie 'n adres nie — kopieer die string weer heel   |
| `which is not a database address`       | Verkeerde soort adres — moet `postgresql://` wees |
| `still contains [YOUR-PASSWORD]`        | Die plekhouer is nie vervang nie                  |
| `which is the dedicated pooler`         | Nog die verkeerde pooler — terug stap B           |
| `which is the direct connection`        | Die direkte verbinding — terug stap B             |
| `publishes no IPv4 address`             | Daardie gasheer werk nooit — terug stap B         |
| `uses the pooler host but the username` | Shared pooler, verkeerde gebruikersnaam           |
| `temporarily blocked new connections`   | Render hamer nog — terug stap A                   |

Die laaste een se **rou** fout — die `error:`-reël bo die verduideliking — sê
`circuit breaker` of `too many authentication failures`. Die tabel hierbo kyk na
die verduideliking, nie na die rou fout nie.

### Nooit nodig nie

- Die wagwoord weer reset. Dit was nooit die probleem nie.
- Die **Enable IPv4 add-on** koop. Dit sou werk en dit kos maandeliks; die
  gedeelde pooler is gratis en doen dieselfde.
- Enigiets in die kode verander.

---

## 1b · Futurebox — die badge is uit, en hoe dit terugkom

Jy het op 11 Oktober gevra dat dit afkom totdat die badge reg is. Dit is uit
op die branch `claude/badge-af-vir-nou` in `futurebox-app`. Dit is **nog nie
live nie** — jou eie briefing (`docs/ANTIGRAVITY.md`) sê geen agent stoot na
`main` nie, want `main` is direk aan Vercel.

**Om dit live te kry:** merge daardie branch op GitHub, of sê vir my "stoot dit
na main" en ek doen dit.

Die branch is bygewerk met `main` soos dit vanaand is — drie nuwe commits het
intussen op `main` geland en nie een van hulle raak die voetstuk of die
beeldbeleid nie, so die merge is skoon en daar is niks om op te los nie.

**Klaar as:** die voetstuk op futurebox wys niks waar die badge was nie.

### Wanneer jy dit terugsit

Dit was nooit 'n badge-fout aan ons kant nie. Die snit op futurebox is in
Augustus gekopieer en wys na `vibefy-web-lyart.vercel.app`, wat nie meer
bestaan nie — daarom het daar net woorde gewys, selfs met alles reg aan ons
kant. 'n Redeploy sou dit nie regmaak nie.

Sodra die databasis antwoord:

1. Teken in by `https://vibefycode.com/console`
2. Gaan na die futurebox-toepassing se bladsy
3. Onder **Your badge** → **Embed it**, kopieer die nuwe snit (dié een wys na
   `vibefycode.com`)
4. Sit dit terug in `app/components/SiteFooter.tsx`
5. **Sit ook die `img-src`-reël vir die nuwe host terug in `next.config.mjs`**,
   in dieselfde commit. Sonder dit blok die CSP-kop die prentjie: die voetstuk
   wys niks en die enigste spoor is 'n fout in die console.

Stap 5 staan ook boaan `SiteFooter.tsx` self, waar jy sal wees as jy dit
terugsit.

**Klaar as:** die badge wys op futurebox.

## 1c · Die badge-sleutel — twee plekke, en dit het nooit hier gestaan nie

Hierdie lys het nog nooit van die badge-sleutel gepraat nie, en sonder dit kan
die werker **geen badge uitreik nie**. Dit sê dit een keer in die Render-log en
die reël lees soos iets normaals, so niks sou jou vertel het nie.

Daar is twee helftes. Die een onderteken (geheim, net Render), die ander
bevestig (openbaar, net Vercel). Tot vandag het die konsole die openbare helfte
uit die geheime een afgelei — wat beteken die een plek wat nie 'n
ondertekensleutel mag hê nie, moes een hê. Dit is nou twee aparte veranderlikes.

**Eers: kyk of daar al 'n sleutel is.** Render → `vibefycode-worker` → Logs.

_As jy hierdie reël sien_ — `badge signing key loaded; publish its public half`
— dan bestaan die sleutel al. Kopieer die hele `VIBEFYCODE_BADGE_PUBLIC_KEYS=[{...}]`
reël uit die log en gaan na stap 3. Dit is openbare data; dit mag in 'n log wees.

_As jy hierdie reël sien_ — `no badge signing key in this process` — dan is daar
nog geen sleutel nie. Doen al drie stappe:

1. Maak die sleutel. In die Vibefy-gids op jou eie masjien:

   ```
   pnpm badge:keygen
   ```

   Dit druk drie reëls en skryf niks na 'n lêer nie. Kan jy dit nie daar
   hardloop nie, sê vir my — ek kan dit nie vir jou in hierdie gesprek maak nie,
   want die geheime helfte mag nie in 'n gesprek of in die repo wees nie, maar
   daar is 'n paar ander plekke wat veilig is en ek wys jou die naaste een.

2. Render → `vibefycode-worker` → Environment: die eerste twee reëls
   (`VIBEFYCODE_BADGE_KEY_ID` en `VIBEFYCODE_BADGE_SIGNING_KEY_B64`). Save
   Changes. **Hierdie twee hoort net hier** — as daardie sleutel uitlek is elke
   badge wat ons ooit uitgereik het namaakbaar.

3. Vercel → `vibefy-web` → Settings → Environment Variables → Add:
   `VIBEFYCODE_BADGE_PUBLIC_KEYS` = die derde reël se waarde (die `[{...}]`
   deel). Production, Preview, Development almal gemerk. Dan **Deployments →
   boonste → ⋯ → Redeploy**.

4. Vee jou terminaal-geskiedenis skoon.

**Klaar as:** `https://vibefycode.com/.well-known/vibefycode-badge-key` wys 'n
`keys`-lys met een sleutel in. Wys dit 'n fout, dan is stap 3 nie klaar nie — en
tot dit klaar is sê `/verify` vir elke besoeker dat dit nie 'n badge kan nagaan
nie, wat van 'n egte badge lees soos 'n vals een.

## 2 · Resend — druk Verify

Die ses DNS-rye is in en reg. Daar is niks meer by Spaceship te doen nie.

Resend → Domains → `send.vibefycode.com` → **Verify**.

Misluk dit, probeer nog een keer voor jy iets verander.

## 3 · Render — drie veranderlikes, en vier reëls om na te kyk

`vibefycode-worker` → Environment:

```
RESEND_API_KEY       = die re_... sleutel
ALERT_EMAIL_FROM     = VibefyCode <alerts@vibefycode.com>
NEXT_PUBLIC_SITE_URL = https://vibefycode.com
```

Sonder aanhalingstekens. Save Changes.

**Klaar as:** Logs wys **geen** van hierdie vier reëls nie:

```
email not configured — alerts will reach the console and phones only
no model key — every submission waits for a reviewer at /review/screening
no verification origin — badges will be issued and never announced
no badge signing key — no customer can be issued a badge, however many pass
```

Die vierde is nuut en dit is die grootste van die vier: sonder daardie sleutel
kan die werker niks uitreik nie, hoeveel beoordelings ook al deurgaan. Afdeling
1c hierbo is die regmaak.

## 4 · Supabase — negentien migrasies

> **Op ys, op jou versoek, 11 Oktober saans.** Jy is op Antigravity besig en
> daar mag nog blokke bykom. Niks hiervan verval — die vier gate bly oop tot
> die blokke geloop het — en wanneer jy terugkom hoef jy niks te onthou nie:
> as daar nuwe migrasies by is, nommer ek die lêer oor (`pnpm sql:blocks`) en
> hierdie afdeling sê weer hoeveel daar is.

Wanneer jy wel begin: **begin hier, nie by 0 nie.** 0 tot 3 is die badge, en
die badge is 'n uitval, nie 'n gat nie.

**Alles in een keer, nie blok vir blok nie.** Dit was my fout: ek het vroeër
gesê plak een blok op 'n slag, en toe moes jy weet waar 'n blok begin. Dit hoef
jy nie.

1. Maak `docs/sql/OUTSTANDING.sql` oop
2. **Ctrl+A** (Mac: Cmd+A) — dit merk die hele lêer
3. **Ctrl+C** (Mac: Cmd+C)
4. Supabase → jou projek → **SQL Editor** → **New query** → plak
5. **Run**

Die eerste twintig reëls van die lêer sê dieselfde vyf stappe, as jy dit later
weer nodig het. Die volgorde is reeds reg, en alles in een keer is veiliger as
stukke: 'n blok wat na 'n vroeëre een se tabel verwys, misluk as jy spring.

Ek het dit getoets soos jy dit gaan hardloop — al negentien blokke in een plak,
teen 'n databasis wat hulle nog nie het nie. Dit loop deur sonder 'n fout, en
die skema wat oorbly is presies dié waarteen die toetse loop.

**Klaar as:** dit loop deur sonder 'n fout. Loop dit 'n tweede keer en niks
gebeur — elke blok slaan homself oor as dit al gedoen is.

**As dit ergens stop:** bo elke blok staan nou 'n reël soos `-- BLOK 12 VAN 19`.
Sê vir my die nommer. In `docs/sql/een-vir-een/` staan dieselfde negentien
blokke as negentien aparte lêers, `01-` tot `19-`, as jy van daar af
een-vir-een wil aangaan.

As een misluk met iets soos "already exists", neem die nommer boaan daardie
blok — die lang getal, soos `20261008030000` — en gee dit saam:

```
node tools/idempotent-catch-up.mjs 20261008030000 > catch-up.sql
```

Dit skryf daardie blok en al die oorblywendes oor in 'n vorm wat twee keer
geplak kan word; alles wat al daar is word stil oorgeslaan. Plak `catch-up.sql`
in plaas van die een wat misluk het, en jy is klaar met die res ook.

**Gee altyd die nommer.** Sonder dit herskryf dit al vier-en-sestig migrasies —
sowat agt-en-half-duisend reëls wat jy nie nodig het nie. Met die nommer van die
een wat misluk het, is dit sowat agthonderd.

Tik jy die nommer verkeerd, weier dit en skryf niks: `No migration starts
with …`. Tik dit dan net weer. En as dit wel loop, wys dit op jou skerm hoeveel
migrasies dit oorgeskryf het — daardie getal moet klop met hoeveel blokke ná
daardie een oor is.

En as jy nie weet waar jou databasis staan nie:

```
node tools/migration-audit.mjs > audit.sql
```

Plak `audit.sql`. Dit lees net en skryf niks. Die laaste reël is die antwoord:
"nothing missing", of 'n lys van die wat weg is — met die getal migrasies wat dit
nagegaan het daarnaas.

Maak dit elke keer nuut. 'n Ou `audit.sql` noem migrasies as weg wat lankal daar
is; die boonste reël van die lêer sê wanneer dit gemaak is.

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

| Vraag                                                                           | Wat dit blokkeer                          |
| ------------------------------------------------------------------------------- | ----------------------------------------- |
| Watter bladsy lees te veel? Noem een, ek sny dit.                               | Niks                                      |
| Mag 'n eienaar sy naam op sy verifikasie-bladsy sit?                            | Niks                                      |
| Moet die tweede stap verpligtend wees vir 'n rekening wat badges uitreik?       | Niks                                      |
| Regsentiteit en jurisdiksie                                                     | Die regsdokumente kan nie finaal word nie |
| Handelsmerk-soektog vir "VibefyCode"                                            | Bemarkingsbesteding en bekendstelling     |
| 'n Vektor-oorspronklike van die kleurmerk                                       | Die laaste getrekte weergawe              |
| Wat 'n eenmalige aankoop daarna toelaat (dit laat nou alles toe)                | Niks — dit kos net geld                   |
| Of ons glad analitika wil hê (die koekie-nota het dit belowe)                   | Niks                                      |
| Of die rubriek 'n dekkingshek moet publiseer                                    | Niks in kode — 'n rubriek-weergawe        |
| Hoe ons die gratis gereedskap teen misbruik beperk                              | Niks — vier opsies staan reeds daar       |
| Of 'n beoordelaar 'n bevinding moet kan terugtrek (die appèl-beleid belowe dit) | Niks — net die beleid                     |
