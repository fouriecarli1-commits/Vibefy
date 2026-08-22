/**
 * Ownership verification — the gate in front of the gate.
 *
 * A signed authorisation warranty from someone who does not control the target
 * is not a defence to anything. These tests cover the checks that make the
 * warranty mean something, and the scope derivation that stops a customer
 * authorising testing of a domain they merely named.
 */
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CHALLENGE_PATH,
  DNS_RECORD_PREFIX,
  createChallenge,
  permittedScopeFor,
  verifyDnsTxt,
  verifyWellKnownFile,
} from '../packages/engine/src/index.ts';

describe('the challenge', () => {
  it('is unguessable and tells the customer exactly what to do', () => {
    const challenge = createChallenge('kettle.example');
    expect(challenge.token.length).toBeGreaterThanOrEqual(30);
    expect(challenge.dnsRecord).toBe(`${DNS_RECORD_PREFIX}${challenge.token}`);
    expect(challenge.filePath).toBe(CHALLENGE_PATH);
    expect(challenge.instructions).toContain('kettle.example');
    expect(challenge.instructions).toContain(challenge.token);
  });

  it('is different every time', () => {
    expect(createChallenge('a.example').token).not.toBe(createChallenge('a.example').token);
  });
});

describe('DNS verification', () => {
  it('does not verify a domain with no matching record', async () => {
    // example.com is a reserved documentation domain; it will never carry our token.
    const outcome = await verifyDnsTxt('example.com', 'a-token-nobody-published');
    expect(outcome.verified).toBe(false);
    expect(outcome.method).toBe('dns_txt');
  }, 20_000);

  it('reports clearly when a domain does not resolve at all', async () => {
    const outcome = await verifyDnsTxt('this-domain-does-not-exist.invalid', 'token');
    expect(outcome.verified).toBe(false);
    expect(outcome.detail).toMatch(/No TXT records/i);
  }, 20_000);

  it('keeps only our own records, not the customer’s other DNS', async () => {
    const outcome = await verifyDnsTxt('example.com', 'token');
    expect(outcome.observed.every((record) => record.startsWith(DNS_RECORD_PREFIX))).toBe(true);
  }, 20_000);
});

describe('well-known file verification', () => {
  it('refuses a host that resolves to a private address', async () => {
    const outcome = await verifyWellKnownFile('localhost', 'token');
    expect(outcome.verified).toBe(false);
    expect(outcome.detail).toMatch(/non-public address|does not resolve/i);
  }, 20_000);
});

describe('the scope a verification permits', () => {
  it('covers the verified host and its subdomains', () => {
    const { allowed, refused } = permittedScopeFor('kettle.example', [
      'kettle.example',
      'app.kettle.example',
      'api.eu.kettle.example',
    ]);
    expect(allowed).toHaveLength(3);
    expect(refused).toHaveLength(0);
  });

  it('refuses anything the customer merely named', () => {
    const { allowed, refused } = permittedScopeFor('kettle.example', [
      'kettle.example',
      'someone-elses-site.example',
      'kettle.example.attacker.test',
      'notkettle.example',
    ]);
    expect(allowed).toEqual(['kettle.example']);
    expect(refused).toEqual([
      'someone-elses-site.example',
      'kettle.example.attacker.test',
      'notkettle.example',
    ]);
  });

  it('treats www as the same site', () => {
    expect(permittedScopeFor('www.kettle.example', ['kettle.example']).allowed).toEqual([
      'kettle.example',
    ]);
  });
});

describe('the file check is the narrowest request we make', () => {
  let server: Server;
  let port = 0;
  const seen: { path: string; method: string }[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      seen.push({ path: request.url ?? '', method: request.method ?? '' });
      response.writeHead(302, { location: 'https://elsewhere.example/' });
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  });

  it('never reaches a loopback host, so the redirect is never followed', async () => {
    const outcome = await verifyWellKnownFile(`127.0.0.1:${port}`, 'token');
    expect(outcome.verified).toBe(false);
    expect(seen).toHaveLength(0);
  }, 20_000);
});
