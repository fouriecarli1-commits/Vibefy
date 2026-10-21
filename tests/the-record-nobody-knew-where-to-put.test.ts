/**
 * An instruction that named the value and never the field.
 *
 * The page showed the contents of a DNS TXT record and the contents of a file.
 * A registrar asks for three things — a type, a name and a value — and "a DNS
 * TXT record" names none of them, so the half of the instruction a person
 * already has was the half they were given. The founder, stuck on her own
 * product on 2026-10-21: "Ek weet nie hoe om hierdie authorisation te doen nie.
 * Help my asb, en maak seker sulke tipe verduidelikings word baie beter
 * verduidelik."
 *
 * The host is the part that bites. `verifyDnsTxt` resolves the exact host in
 * scope, so a record published on `futurebox.studio` for a scope that names
 * `www.futurebox.studio` never verifies — and the file check sets
 * `redirect: 'manual'`, so the `www`-to-apex redirect that most sites have
 * fails it too. Neither was said anywhere.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { howToProve } from '../apps/web/lib/prove-the-domain.ts';
import { CHALLENGE_PATH, DNS_RECORD_PREFIX } from '../packages/engine/src/authorisation/index.ts';
import { commentsBlanked } from './setup/source.ts';

describe('what to type where', () => {
  it('names the record a registrar asks for', () => {
    const proof = howToProve('www.futurebox.studio', 'token-123');
    expect(proof.dns.type).toBe('TXT');
    expect(proof.dns.name, 'the subdomain goes in the Name field').toBe('www');
    expect(proof.dns.nameInFull).toBe('www.futurebox.studio');
    expect(proof.dns.value).toBe(`${DNS_RECORD_PREFIX}token-123`);
  });

  it('calls the domain itself what every registrar calls it', () => {
    expect(howToProve('futurebox.studio', 't').dns.name).toBe('@');
    expect(howToProve('vibefycode.com', 't').dns.name).toBe('@');
  });

  it('keeps deeper names whole', () => {
    expect(howToProve('app.staging.futurebox.studio', 't').dns.name).toBe('app.staging');
  });

  it('gives both spellings, because the short one cannot always be right', () => {
    /*
     * Two labels are treated as the domain itself, which is right for
     * `futurebox.studio` and wrong for a `co.uk`-style one: the registrable
     * domain there is `example.co.uk`, so the Name field wants `shop` and this
     * says `shop.example`. Getting it right needs the public suffix list,
     * which is a dependency and a download for one field.
     *
     * So the full name is always shown beside it, and the page says to use that
     * if the registrar rejects the short one. A registrar that wants the full
     * name accepts it; one that wants the short name rejects the long one
     * visibly, which is the failure that can be acted on rather than the one
     * that looks like it worked.
     */
    const proof = howToProve('shop.example.co.uk', 't');
    expect(proof.dns.name).toBe('shop.example');
    expect(proof.dns.nameInFull).toBe('shop.example.co.uk');
  });

  it('says where the file goes and where it has to answer', () => {
    const proof = howToProve('www.futurebox.studio', 'token-123');
    expect(proof.file.url).toBe(`https://www.futurebox.studio${CHALLENGE_PATH}`);
    expect(proof.file.inProject).toBe(`public${CHALLENGE_PATH}`);
    expect(proof.file.contents, 'the file carries the token and nothing else').toBe('token-123');
  });
});

describe('what the page now says', () => {
  const page = commentsBlanked(readFileSync('apps/web/app/console/apps/[id]/page.tsx', 'utf8'));

  it('asks for the record by its fields', () => {
    expect(page).toMatch(/Name \/ Host/);
    expect(page).toMatch(/proof\.dns\.value/);
    expect(page).toMatch(/proof\.dns\.name/);
  });

  it('warns about the host the record goes on', () => {
    // The failure that cost an evening: the scope named `www` and the record
    // would have gone on the domain without it.
    expect(page).toMatch(/is read on/);
    expect(page).toMatch(/without the/);
  });

  it('warns about the redirect that fails the file check', () => {
    expect(page).toMatch(/No redirect/);
    expect(page).toMatch(/sends the browser anywhere else/);
  });

  it('says what a project folder looks like, not just a path', () => {
    expect(page).toMatch(/proof\.file\.inProject/);
    expect(page).toMatch(/Next\.js/);
  });

  it('tells somebody which one to pick', () => {
    // Two options presented flat is a decision somebody has to make with no
    // information. One sentence removes it.
    expect(page).toMatch(/Pick <strong>one<\/strong>/);
  });
});
