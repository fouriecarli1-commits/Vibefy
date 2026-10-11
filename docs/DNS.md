# Waar jy is

Nagegaan om 22:40 op 2026-09-24, teen Spaceship se eie nameservers.

## Die ses rye is in, en hulle is reg

| Host                     | Type    | Value                                 |
| ------------------------ | ------- | ------------------------------------- |
| `@`                      | `A`     | `216.150.1.1`                         |
| `www`                    | `CNAME` | `9e97ba8a7b989954.vercel-dns-017.com` |
| `rsend.send`             | `CNAME` | `rsend-euw1.forge.rmta.net`           |
| `send.send`              | `CNAME` | `send.forge.rmta.net`                 |
| `resend._domainkey.send` | `TXT`   | `p=MIGfMA0GCSqG...`                   |
| `_dmarc`                 | `TXT`   | `v=DMARC1; p=none;`                   |

Moenie hulle aanraak nie.

## Volgende: druk Verify

Resend → Domains → `send.vibefycode.com` → **Verify**.

Een klein ding om te weet, sodat jy nie skrik nie: die DKIM-ry antwoord uit my
houer gesien ongeveer agt uit tien keer op een van die twee nameservers, en
altyd op die ander. Dit kan net my pad daarheen wees. As Verify eerste keer
misluk, **probeer nog een keer** voordat jy iets verander.

Misluk dit twee keer agtermekaar: maak die `resend._domainkey.send`-ry oop,
verander die TTL na `1 hour`, Save, verander dit terug na `30 min`, Save. Dit
dwing 'n vars stoot. Dan weer Verify.

## Daarna

Render → `vibefycode-worker` → Environment:

```
RESEND_API_KEY      = die re_... sleutel
ALERT_EMAIL_FROM    = VibefyCode <alerts@vibefycode.com>
NEXT_PUBLIC_SITE_URL = https://vibefycode.com
```

Sonder aanhalingstekens. Save Changes, wag vir die herbou, kyk in Logs.

Jy wil **geen** van die reëls sien wat `docs/DOEN.md` afdeling 3 se "Klaar as"
oplys nie. Die lys staan net daar, en net een keer: hierdie bladsy het sy eie
afskrif gehad met drie reëls in, en toe die werker 'n vierde begin sê het, het
hierdie afskrif stil verkeerd geword. 'n Reël wat jy nie gesê is om voor te kyk
nie, se afwesigheid lees presies soos sukses.

Elkeen daar noem die veranderlike wat kort. Niks sien nie, is die doel.

## Nie vanaand nie

'n Posbus by `support@vibefycode.com` — iets waarby jy inteken en pos lees — is
'n aparte diens van Resend. Niks in die produk wag daarop nie.
