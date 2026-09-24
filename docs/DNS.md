# Spaceship DNS — die ses rye

Maak oop: `spaceship.com` → Manage → `vibefycode.com` → DNS records.

Wanneer die blad hierdie ses wys, is dit klaar. Niks meer nie.

| Host                     | Type    | Value                                 |
| ------------------------ | ------- | ------------------------------------- |
| `@`                      | `A`     | `216.150.1.1`                         |
| `www`                    | `CNAME` | `9e97ba8a7b989954.vercel-dns-017.com` |
| `resend._domainkey.send` | `TXT`   | kopieer uit Resend                    |
| `rsend.send`             | `CNAME` | `rsend-euw1.forge.rmta.net`           |
| `send.send`              | `CNAME` | `send.forge.rmta.net`                 |
| `_dmarc`                 | `TXT`   | `v=DMARC1; p=none;`                   |

Daar is tans drie `@` `A`-rye. Hou `216.150.1.1`. Vee die ander twee uit.

**Druk Save Changes onderaan die blad.** Sonder dit gebeur niks, en die blad lyk reg.

Vra Claude om na te gaan voordat jy Resend se Verify druk.
