/**
 * Which header values survive capture, and which do not.
 *
 * `redactHeaders` runs at capture, not at publication — "an artefact we have
 * to remember to sanitise later is an artefact that eventually gets published
 * unsanitised". It took the value out of five headers named one by one, which
 * is a list of what to strip: a header carrying an opaque token was stored
 * unless somebody had thought of its name. `REDACTION_PATTERNS` catches a
 * value shaped like a known credential, and an opaque random string is shaped
 * like nothing.
 *
 * Named the other way round now: a header whose *name* says it carries a
 * credential has its value taken out, unless a finding is about that value.
 *
 * The keep-list is what makes that safe, and it is not hypothetical.
 * `access-control-allow-credentials` contains the word and its value is
 * exactly what the CORS check reports on. The check reads the live response
 * rather than the artefact, so a name rule alone would not have changed a
 * verdict — it would have removed the line a reviewer confirms that verdict
 * by, from the artefact whose purpose is to carry it. A finding nobody can
 * check is one we may not publish.
 *
 * So the keep-list is tied to the checks: read out of the stage sources, and
 * compared both ways.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HEADERS_FINDINGS_READ,
  isSensitiveHeaderName,
  redactHeaders,
} from '../packages/engine/src/runtime/evidence.ts';

/** Every header name a stage reads from a response. */
const readByChecks = (() => {
  const dir = 'packages/engine/src/stages';
  const names = new Set<string>();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.ts') || file.includes('.test.')) continue;
    const source = readFileSync(join(dir, file), 'utf8');
    for (const match of source.matchAll(
      /headers\[['"]([a-z0-9-]+)['"]\]|headers\.get\(['"]([a-z0-9-]+)['"]\)/g,
    )) {
      names.add((match[1] ?? match[2])!);
    }
  }
  return [...names].sort();
})();

describe('the headers a finding is drawn from', () => {
  it('were found in the stage sources, so the comparison is about something', () => {
    expect(readByChecks.length).toBeGreaterThan(5);
    expect(readByChecks).toContain('set-cookie');
    expect(readByChecks).toContain('access-control-allow-credentials');
  });

  it('are exactly the ones the keep-list names', () => {
    // Both directions. A check that starts reading a new header has to be
    // listed, or its value stops reaching the artefact a reviewer confirms by;
    // a name here that no check reads is an exception nobody needs.
    expect([...HEADERS_FINDINGS_READ].sort()).toEqual(readByChecks);
  });

  it('survive capture, every one of them', () => {
    const captured = redactHeaders(
      Object.fromEntries(readByChecks.map((name) => [name, `VALUE-OF-${name}`])),
    );
    for (const name of readByChecks) {
      if (name === 'set-cookie' || name === 'cookie') continue; // value stripped by design
      expect(captured[name], name).toBe(`VALUE-OF-${name}`);
    }
  });
});

describe('a header whose name says it carries a credential', () => {
  const stripped = [
    'authorization',
    'proxy-authorization',
    'x-api-key',
    'api-key',
    'x-auth-token',
    'x-session-token',
    'x-access-token',
    'x-secret',
    'x-refresh-token',
    'x-user-password',
    'x-apikey',
  ];

  it.each(stripped)('%s has its value taken out', (name) => {
    expect(isSensitiveHeaderName(name), name).toBe(true);
    const captured = redactHeaders({ [name]: 'an-opaque-token-shaped-like-nothing' });
    expect(captured[name], name).not.toContain('an-opaque-token-shaped-like-nothing');
    expect(captured[name], name).toMatch(/REDACTED/);
  });

  it('says how long the value was, which is what a reviewer needs to know', () => {
    expect(redactHeaders({ authorization: 'Bearer abcdef' })['authorization']).toContain('13chars');
  });

  it('is matched whatever case it arrives in', () => {
    expect(isSensitiveHeaderName('X-API-Key')).toBe(true);
    expect(isSensitiveHeaderName('Authorization')).toBe(true);
  });
});

describe('a header that carries nothing private', () => {
  const kept = ['content-type', 'date', 'etag', 'vary', 'location', 'content-length'];

  it.each(kept)('%s is stored as it stands', (name) => {
    // The positive control: a rule that stripped everything would satisfy
    // every assertion above and leave an artefact with nothing in it.
    expect(isSensitiveHeaderName(name), name).toBe(false);
    expect(redactHeaders({ [name]: 'a-plain-value' })[name], name).toBe('a-plain-value');
  });

  it('keeps the keep-listed one that contains the word, which is the whole point', () => {
    expect(isSensitiveHeaderName('access-control-allow-credentials')).toBe(false);
    expect(redactHeaders({ 'access-control-allow-credentials': 'true' })).toEqual({
      'access-control-allow-credentials': 'true',
    });
  });
});
