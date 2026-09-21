/**
 * Ownership verification — the gate in front of the gate.
 *
 * A signed authorisation warranty from someone who does not control the target
 * is not a defence to anything. These tests cover the checks that make the
 * warranty mean something, and the scope derivation that stops a customer
 * authorising testing of a domain they merely named.
 */
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

  it('checks the address at connect time as well as before', async () => {
    // Resolving the host and connecting to it are two separate resolutions. A
    // record that answers publicly for the first can answer 127.0.0.1 for the
    // second — DNS rebinding, and not exotic. The pre-check cannot see that;
    // only the dispatcher can, so the request carries one.
    const source = readFileSync(
      join(process.cwd(), 'packages/engine/src/authorisation/ownership.ts'),
      'utf8',
    );
    expect(source).toContain('dispatcher: createScopedDispatcher(');
    // And the pre-check stays: it is what turns a refusal into a sentence the
    // customer can act on rather than a bare "fetch failed".
    expect(source).toContain('isPrivateAddress');
    expect(source.indexOf('isPrivateAddress(entry.address)')).toBeLessThan(
      source.indexOf('dispatcher: createScopedDispatcher('),
    );
  });
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

  it('lets a www host cover the domain it sits on', () => {
    // A site served from www.x whose canonical domain is x is the ordinary
    // case, and refusing it would read as a fault.
    expect(permittedScopeFor('www.kettle.example', ['kettle.example']).allowed).toEqual([
      'kettle.example',
    ]);
  });

  it('does not let a www host cover its siblings', () => {
    // It used to. `www.` was stripped before the comparison, so verifying
    // www.kettle.example produced a base of kettle.example and authorised every
    // subdomain of it. Serving a file at www.x shows that whoever runs the x
    // zone pointed www at you; it does not show that you run the zone, and on a
    // shared or delegated domain the sibling belongs to somebody else. This is
    // the record that stands behind a computer-misuse defence.
    const { allowed, refused } = permittedScopeFor('www.kettle.example', [
      'www.kettle.example',
      'kettle.example',
      'admin.kettle.example',
      'mail.kettle.example',
    ]);
    expect(allowed).toEqual(['www.kettle.example', 'kettle.example']);
    expect(refused).toEqual(['admin.kettle.example', 'mail.kettle.example']);
  });

  it('says on the screen exactly what it does, and no more', () => {
    // The console told the customer "you can only authorise testing of the host
    // you verify and its subdomains" while granting more than that. The code
    // and the sentence have to be the same rule; whichever of them is wrong,
    // a customer reading one and getting the other is the failure.
    const action = readFileSync(
      join(process.cwd(), 'apps/web/app/console/apps/actions.ts'),
      'utf8',
    );
    expect(action).toContain('when you verify a www host');
    expect(action).toContain('verify the domain itself');
  });
});

describe('the address the challenge is fetched from', () => {
  it('refuses a host that is not a plain hostname', async () => {
    // `host` comes from an application's own primary_url. A string like
    // `good.test/#` concatenated into a template produces a URL pointing
    // somewhere else. The only thing standing in the way was the resolver
    // declining to look up a malformed name — true today, and an accident.
    for (const host of [
      'good.test/#',
      'good.test@elsewhere.test',
      'good.test:8443',
      'good.test?x=1',
    ]) {
      const outcome = await verifyWellKnownFile(host, 'token');
      expect(outcome.verified, host).toBe(false);
      expect(outcome.detail, host).toMatch(/not a plain hostname/i);
    }
  });

  it('gives the nameservers a deadline, like the file check has always had', () => {
    // `resolveTxt` from node:dns/promises takes no timeout and inherits the
    // resolver's own, which retries its way well past a minute against a
    // nameserver that accepts packets and never answers. This runs inside a web
    // request somebody is sitting in front of.
    const source = readFileSync(
      join(process.cwd(), 'packages/engine/src/authorisation/ownership.ts'),
      'utf8',
    );
    expect(source).toContain('new Resolver({ timeout: DNS_TIMEOUT_MS, tries: DNS_TRIES })');
    expect(source).not.toMatch(/\bawait resolveTxt\(/);
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
