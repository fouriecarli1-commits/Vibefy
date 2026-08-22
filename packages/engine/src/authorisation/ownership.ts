/**
 * Ownership verification.
 *
 * The gate in front of the gate. Before a customer's signed authorisation
 * warranty means anything, they have to demonstrate they actually control the
 * thing they are authorising us to test — otherwise the warranty is just a
 * checkbox, and a checkbox is not a defence to a computer-misuse charge.
 *
 * Two methods are implemented here, both of which require access a bystander
 * does not have: publishing a DNS TXT record, or placing a file at a well-known
 * path. Neither can be satisfied by someone who merely knows the domain exists.
 *
 * The single request this module makes to a customer's host happens *before* any
 * authorisation exists, so it is deliberately the narrowest request we ever
 * make: one GET, to one fixed path, over HTTPS, to a public address, with no
 * redirects followed.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import { lookup } from 'node:dns/promises';
import { isPrivateAddress } from '../runtime/addresses.ts';

export const CHALLENGE_PATH = '/.well-known/vibefy-challenge.txt';
export const DNS_RECORD_PREFIX = 'vibefy-site-verification=';

export type OwnershipMethod =
  | 'dns_txt'
  | 'well_known_file'
  | 'verified_email_domain'
  | 'oauth_repository';

export interface OwnershipChallenge {
  readonly token: string;
  readonly dnsRecord: string;
  readonly filePath: string;
  readonly fileContents: string;
  readonly instructions: string;
}

export interface VerificationOutcome {
  readonly verified: boolean;
  readonly method: OwnershipMethod;
  readonly host: string;
  readonly checkedAt: string;
  readonly detail: string;
  /** What we actually saw, kept so a disputed verification can be re-examined. */
  readonly observed: readonly string[];
}

/** A fresh, unguessable token. Stored with the pending verification. */
export function createChallenge(host: string): OwnershipChallenge {
  const token = randomBytes(24).toString('base64url');
  return {
    token,
    dnsRecord: `${DNS_RECORD_PREFIX}${token}`,
    filePath: CHALLENGE_PATH,
    fileContents: token,
    instructions: [
      `Prove you control ${host} by doing either of these, then press Verify:`,
      '',
      `1. Add a DNS TXT record on ${host} with the value:`,
      `   ${DNS_RECORD_PREFIX}${token}`,
      '',
      `2. Or serve this exact text, and nothing else, at https://${host}${CHALLENGE_PATH}:`,
      `   ${token}`,
      '',
      'DNS records can take a few minutes to propagate. The file method is usually immediate.',
    ].join('\n'),
  };
}

/** Constant-time comparison: a verification check is an authentication check. */
function tokensMatch(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function verifyDnsTxt(host: string, token: string): Promise<VerificationOutcome> {
  const checkedAt = new Date().toISOString();
  let records: string[][] = [];
  try {
    records = await resolveTxt(host);
  } catch (error) {
    return {
      verified: false,
      method: 'dns_txt',
      host,
      checkedAt,
      detail: `No TXT records could be read for ${host}: ${error instanceof Error ? error.message : String(error)}`,
      observed: [],
    };
  }

  const flattened = records.map((chunks) => chunks.join(''));
  const matched = flattened.some(
    (value) =>
      value.startsWith(DNS_RECORD_PREFIX) &&
      tokensMatch(token, value.slice(DNS_RECORD_PREFIX.length).trim()),
  );

  return {
    verified: matched,
    method: 'dns_txt',
    host,
    checkedAt,
    detail: matched
      ? `A TXT record on ${host} carries the challenge token.`
      : `${flattened.length} TXT record(s) were found on ${host}, none carrying the challenge token. DNS changes can take a few minutes to propagate.`,
    // Only Vibefy's own records are kept. A customer's other TXT records are
    // their business, not evidence we have any reason to retain.
    observed: flattened.filter((value) => value.startsWith(DNS_RECORD_PREFIX)),
  };
}

export async function verifyWellKnownFile(
  host: string,
  token: string,
): Promise<VerificationOutcome> {
  const checkedAt = new Date().toISOString();
  const url = `https://${host}${CHALLENGE_PATH}`;

  const addresses = await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) {
    return {
      verified: false,
      method: 'well_known_file',
      host,
      checkedAt,
      detail: `${host} does not resolve.`,
      observed: [],
    };
  }
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    return {
      verified: false,
      method: 'well_known_file',
      host,
      checkedAt,
      detail: `${host} resolves to a non-public address, so it cannot be verified this way.`,
      observed: [],
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual', // a redirect could carry us to a host nobody authorised
      signal: controller.signal,
      headers: { 'user-agent': 'VibefyOwnershipCheck/1.0', accept: 'text/plain' },
    });

    if (response.status !== 200) {
      return {
        verified: false,
        method: 'well_known_file',
        host,
        checkedAt,
        detail: `${url} returned HTTP ${response.status}. The file must be served directly, with no redirect.`,
        observed: [String(response.status)],
      };
    }

    const body = (await response.text()).slice(0, 512).trim();
    const matched = tokensMatch(token, body);
    return {
      verified: matched,
      method: 'well_known_file',
      host,
      checkedAt,
      detail: matched
        ? `${url} serves the challenge token.`
        : `${url} responded, but its contents do not match the challenge token. The file must contain the token and nothing else.`,
      observed: [matched ? 'token matched' : `${body.length} characters, no match`],
    };
  } catch (error) {
    return {
      verified: false,
      method: 'well_known_file',
      host,
      checkedAt,
      detail: `${url} could not be reached: ${error instanceof Error ? error.message : String(error)}`,
      observed: [],
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tries both methods and reports the first that succeeds. A customer should not
 * have to tell us which one they used.
 */
export async function verifyOwnership(host: string, token: string): Promise<VerificationOutcome> {
  const dns = await verifyDnsTxt(host, token);
  if (dns.verified) return dns;
  const file = await verifyWellKnownFile(host, token);
  if (file.verified) return file;
  return {
    ...dns,
    detail: `Neither method verified yet. DNS: ${dns.detail} File: ${file.detail}`,
    observed: [...dns.observed, ...file.observed],
  };
}

/**
 * The hosts an authorisation may cover, derived from the host that was actually
 * verified. A customer who proves control of `kettle.example` may authorise
 * testing of it and its subdomains — and nothing else, however much they ask.
 */
export function permittedScopeFor(
  verifiedHost: string,
  requested: readonly string[],
): {
  allowed: string[];
  refused: string[];
} {
  const base = verifiedHost.toLowerCase().replace(/^www\./, '');
  const allowed: string[] = [];
  const refused: string[] = [];

  for (const candidate of requested) {
    const host = candidate.toLowerCase().trim().replace(/^\*\./, '');
    if (host === base || host.endsWith(`.${base}`)) allowed.push(host);
    else refused.push(host);
  }

  return { allowed, refused };
}
