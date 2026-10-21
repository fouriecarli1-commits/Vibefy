import { CHALLENGE_PATH, DNS_RECORD_PREFIX } from '@vibefycode/engine/authorisation';

/**
 * The two ways to prove a domain, written as the things somebody actually types.
 *
 * The page used to show the value of a DNS record and the contents of a file,
 * which is the half of the instruction a person already has. What it never said
 * was where either one goes: a registrar asks for a type, a name and a value,
 * and "a DNS TXT record" names none of those. The founder, stuck on her own
 * product on 2026-10-21: "Ek weet nie hoe om hierdie authorisation te doen nie."
 *
 * The host matters more than it looks. The record is read on the exact host in
 * scope — `www.futurebox.studio` is not `futurebox.studio` — so a record
 * published on the apex for a scope that names `www` never verifies, and
 * nothing on the old page would have told anybody why.
 */
export interface ProofInstructions {
  readonly host: string;
  readonly dns: {
    readonly type: 'TXT';
    /** What a registrar's Name or Host field wants. */
    readonly name: string;
    /** And the same thing written in full, which some registrars want instead. */
    readonly nameInFull: string;
    readonly value: string;
  };
  readonly file: {
    /** Where it has to answer, which is the thing to open in a browser. */
    readonly url: string;
    /** Where it goes in a project that serves a folder of static files. */
    readonly inProject: string;
    readonly contents: string;
  };
}

export function howToProve(host: string, token: string): ProofInstructions {
  const labels = host.toLowerCase().split('.').filter(Boolean);
  /*
   * `@` means the domain itself, which is what every registrar calls the apex.
   * Anything deeper is the labels in front of the registrable domain — `www`
   * for `www.futurebox.studio`.
   *
   * Two labels is treated as the apex, which is right for `futurebox.studio`
   * and wrong for a `co.uk`-style domain — the registrable domain there is
   * `example.co.uk`, so `shop.example.co.uk` wants `shop` and this says
   * `shop.example`. Getting that right needs the public suffix list, which is a
   * dependency and a download for one field.
   *
   * So both spellings are given rather than guessed between, and the page says
   * to use the full one if the registrar refuses the short one. A registrar
   * that wants the full name accepts it; one that wants the short name rejects
   * the long one visibly, which is a failure somebody can act on rather than
   * one that looks like it worked.
   */
  const name = labels.length > 2 ? labels.slice(0, -2).join('.') : '@';

  return {
    host,
    dns: {
      type: 'TXT',
      name,
      nameInFull: host,
      value: `${DNS_RECORD_PREFIX}${token}`,
    },
    file: {
      url: `https://${host}${CHALLENGE_PATH}`,
      inProject: `public${CHALLENGE_PATH}`,
      contents: token,
    },
  };
}
