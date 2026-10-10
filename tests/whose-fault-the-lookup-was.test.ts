/**
 * "`host` does not resolve", said about our own resolver failing.
 *
 * `verifyWellKnownFile` read the host's addresses through
 * `lookup(host, { all: true }).catch(() => [])` and then checked for a
 * zero-length list. So every way a lookup can fail arrived at the same
 * sentence: a resolver that timed out, a nameserver that answered SERVFAIL, no
 * network at all, and a host that genuinely does not exist.
 *
 * The *outcome* is the same either way and correctly so — an unverified host
 * must not be tested, and the brief is explicit that no assessment step runs
 * without a verified authorisation record. What is not the same is where
 * somebody goes to fix it. Sending a customer to their registrar over our own
 * timeout costs them an afternoon looking at DNS that was never wrong.
 *
 * `verifyDnsTxt`, forty lines up in the same file, already said "No TXT records
 * could be read for ${host}: ${message}". The two were written together and
 * only one of them said what happened — the third time tonight that pattern has
 * turned up, and the argument recorded in decision 789 for holding a rule over
 * a file rather than fixing its instances.
 *
 * Found by a sweep for `catch` blocks that produce a value reading as an answer
 * rather than as the absence of one. Four in the repository; three were already
 * right, with the reason written beside each.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyWellKnownFile } from '../packages/engine/src/authorisation/ownership.ts';

describe('a host that genuinely does not exist', () => {
  it('is told it does not resolve', async () => {
    // `.invalid` is reserved by RFC 2606 and never resolves, so a resolver
    // answers NXDOMAIN rather than failing.
    const outcome = await verifyWellKnownFile('this-domain-does-not-exist.invalid', 'token');
    expect(outcome.verified).toBe(false);
    expect(outcome.detail).toMatch(/does not resolve/i);
  }, 20_000);

  it('is not blamed for something on our side', async () => {
    const outcome = await verifyWellKnownFile('this-domain-does-not-exist.invalid', 'token');
    expect(outcome.detail).not.toMatch(/not necessarily yours/i);
  }, 20_000);
});

describe('a lookup that failed for some other reason', () => {
  /** The code, without comments — which quote the defect on purpose. */
  const source = readFileSync(
    join(import.meta.dirname, '..', 'packages/engine/src/authorisation/ownership.ts'),
    'utf8',
  )
    .replace(/^[ \t]*\/\/.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');

  it('is not caught into an empty list', () => {
    expect(source).not.toMatch(/lookup\([^)]*\)\s*\.catch/);
  });

  it('reads the error rather than only its absence', () => {
    expect(source).toMatch(/addresses = await lookup\(/);
    expect(source).toMatch(/code === 'ENOTFOUND'/);
  });

  it('says plainly that it may not be the customer’s fault', () => {
    expect(source).toContain('not necessarily yours');
  });

  it('still refuses, because an unverified host must not be tested', () => {
    // The direction this fix must not fail in: a softer sentence that also
    // softens the outcome.
    const branch = /could not be looked up[\s\S]{0,400}?observed: \[\],/.exec(source)?.[0] ?? '';
    expect(branch).not.toContain('verified: true');
    expect(source).toMatch(/verified: false,\s*method: 'well_known_file'/);
  });
});

describe('what has to keep holding', () => {
  it('a host resolving to a private address is still refused', async () => {
    const outcome = await verifyWellKnownFile('localhost', 'token');
    expect(outcome.verified).toBe(false);
    expect(outcome.detail).toMatch(/non-public address|does not resolve/i);
  }, 20_000);

  it('the TXT path still names the error, which is where the sentence came from', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'packages/engine/src/authorisation/ownership.ts'),
      'utf8',
    );
    expect(source).toContain('No TXT records could be read for');
  });
});
