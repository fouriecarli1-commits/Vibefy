/**
 * Two true sentences that could not both be followed.
 *
 * `docs/RUNBOOK.md` has a section called "The two that must never cross":
 *
 *     VIBEFYCODE_BADGE_SIGNING_KEY_B64 and VIBEFYCODE_BADGE_KEY_ID belong on
 *     Render and nowhere else. … the console gains nothing by holding it —
 *     verification needs only the public half, which is published.
 *
 * Right, for the right reason: every instance that can sign is another place
 * the one key whose loss ends the business can leak from. The key generator
 * agreed in its own words — the public half "is derived from the private key at
 * start-up, so it does not need to be configured" — and that was true of the
 * code. `/.well-known/vibefycode-badge-key` built its answer from
 * `loadSigningKey()`, and so did `/verify`.
 *
 * Follow both and the console has no key to derive anything from. The published
 * key set is empty, which is not a quiet degradation:
 *
 *   · Every badge on every customer's website fails to verify, for everybody.
 *   · `/verify` tells each visitor it cannot check the badge they were shown.
 *   · The conclusion a stranger reaches about a genuine badge is the one the
 *     page used to reach: that VibefyCode never issued it.
 *
 * And nothing in the system could notice, because from the inside it is
 * indistinguishable from a deployment that is not meant to verify anything —
 * which is precisely what `loadSigningKey` returning null is documented to
 * mean. The fix anybody reaches for under pressure is the signing key on
 * Vercel, which is the rule the runbook calls the one that must never cross.
 *
 * So the serving side reads public halves: `VIBEFYCODE_BADGE_PUBLIC_KEYS`,
 * merged with the retired list. This asserts the chain an outsider walks, with
 * the private key absent from the serving environment the whole way, and it
 * asserts the rule itself — no file under `apps/web` reads the signing pair,
 * which is what turns a promise in a document into a property of the code.
 *
 * The database is not in this test. `tests/journey.test.ts` already issues a
 * badge for real and verifies it after the jsonb round trip; what was untested
 * was never the arithmetic, it was which process is holding which half.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  generateSigningKey,
  loadPublishedKeys,
  loadSigningKey,
  privateKeyFromBase64,
  publishedKeysLine,
  signBadge,
  toJwk,
  verifyBadge,
  type BadgePayload,
  type SigningKey,
} from '../packages/badge/src/index.ts';
import { createPublicKey } from 'node:crypto';
import { withoutComments } from './setup/source.ts';

/** A signing key, as the worker holds one. */
function aSigningKey(kid: string): { key: SigningKey; privateKeyB64: string } {
  const generated = generateSigningKey(kid);
  const privateKey = privateKeyFromBase64(generated.privateKeyB64);
  return {
    key: { kid, privateKey, jwk: toJwk(createPublicKey(privateKey), kid) },
    privateKeyB64: generated.privateKeyB64,
  };
}

const payloadFor = (kid: string): BadgePayload =>
  ({
    v: 1,
    kid,
    badgeId: 'a-real-badge',
    slug: 'an-app',
    appName: 'An App',
    certifiedOrigin: 'https://an-app.example',
    rubricVersion: '1.1.0',
    score: 86,
    assessedOn: '2026-10-01',
    issuedAt: '2026-10-01T00:00:00.000Z',
    expiresAt: '2027-10-01T00:00:00.000Z',
    ownerIsMarketingClient: false,
  }) as BadgePayload;

/** The environment of a deployment that serves and verifies and never signs. */
const servingEnv = (line: string): NodeJS.ProcessEnv => {
  const [, value] = line.split(/=(.*)/s);
  return { VIBEFYCODE_BADGE_PUBLIC_KEYS: value } as NodeJS.ProcessEnv;
};

describe('a console that does not hold the signing key', () => {
  it('still publishes a key set', () => {
    const { key } = aSigningKey('k-serving-1');
    const published = loadPublishedKeys(servingEnv(publishedKeysLine(key.jwk)));
    expect(published.keys).toHaveLength(1);
    expect(published.keys[0]!.kid).toBe('k-serving-1');
    expect(published.keys[0]).not.toHaveProperty('d');
  });

  it('verifies a badge the worker signed, from that key set alone', () => {
    const { key } = aSigningKey('k-serving-2');
    const signed = signBadge(payloadFor('k-serving-2'), key);

    // The whole claim, in one line: the environment below has no private key
    // in it, and this is the answer a stranger gets.
    const keys = loadPublishedKeys(servingEnv(publishedKeysLine(key.jwk))).keys;
    const result = verifyBadge(signed, { keys }, { now: new Date('2026-11-01') });

    expect(result.signatureValid).toBe(true);
    expect(result.withinValidity).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('is handed that line by the process that does hold the key', () => {
    // So nobody has to derive the public half from the private one, which means
    // the signing key on a laptop and in a shell history.
    const { key } = aSigningKey('k-serving-3');
    const line = publishedKeysLine(key.jwk);
    expect(line.startsWith('VIBEFYCODE_BADGE_PUBLIC_KEYS=[{')).toBe(true);
    expect(line).not.toContain('"d"');
    expect(loadPublishedKeys(servingEnv(line)).keys[0]!.kid).toBe('k-serving-3');
  });
});

describe('the deployment the runbook describes', () => {
  const { key, privateKeyB64 } = aSigningKey('k-render-only');

  const renderOnly = {
    VIBEFYCODE_BADGE_SIGNING_KEY_B64: privateKeyB64,
    VIBEFYCODE_BADGE_KEY_ID: 'k-render-only',
  } as NodeJS.ProcessEnv;

  it('can sign, which is the half that was always right', () => {
    const loaded = loadSigningKey(renderOnly);
    expect(loaded?.kid).toBe('k-render-only');
  });

  it('publishes nothing from the signing pair, which is the point', () => {
    // Not a regression to fix by widening `loadPublishedKeys`: a serving
    // deployment holding the signing key is the failure, not the remedy. The
    // route turns this into a 503 and says which variable to set.
    expect(loadPublishedKeys(renderOnly).keys).toEqual([]);
  });

  it('would have failed every badge, which is what the empty set used to mean', () => {
    const signed = signBadge(payloadFor('k-render-only'), key);
    const result = verifyBadge(signed, { keys: loadPublishedKeys(renderOnly).keys });
    expect(result.signatureValid).toBe(false);
    expect(result.failures).toContain('no_published_keys');
    // And the sentence a visitor got said so about us rather than about them.
    expect(result.explanation).toMatch(/fault on our side/i);
  });
});

describe('the rule, as a property of the code', () => {
  function sourcesUnder(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', '.next'].includes(entry.name)) continue;
        found.push(...sourcesUnder(full));
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        found.push(full);
      }
    }
    return found;
  }

  const web = sourcesUnder('apps/web').map((path) => ({
    path,
    code: withoutComments(readFileSync(path, 'utf8')),
  }));

  it('found the console to search', () => {
    expect(web.length).toBeGreaterThan(100);
    expect(web.map((file) => file.path)).toContain(
      'apps/web/app/.well-known/vibefycode-badge-key/route.ts',
    );
  });

  it('is that nothing in the console asks for a signing key', () => {
    const asking = web.filter((file) =>
      /\bloadSigningKey\b|\brequireSigningKey\b|VIBEFYCODE_BADGE_SIGNING_KEY_B64/.test(file.code),
    );
    expect(asking.map((file) => file.path)).toEqual([]);
  });

  it('is that the two readers of the key set read the published one', () => {
    for (const path of [
      'apps/web/app/.well-known/vibefycode-badge-key/route.ts',
      'apps/web/app/verify/page.tsx',
    ]) {
      const code = withoutComments(readFileSync(path, 'utf8'));
      expect(code).toContain('loadPublishedKeys');
    }
  });

  it('is written where somebody setting the variables will read it', () => {
    const runbook = readFileSync('docs/RUNBOOK.md', 'utf8');
    const example = readFileSync('.env.example', 'utf8');
    const keygen = readFileSync('tools/generate-badge-key.mts', 'utf8');

    expect(example).toContain('VIBEFYCODE_BADGE_PUBLIC_KEYS=');
    expect(keygen).toContain('publishedKeysLine');
    // In the Vercel table, not only in prose: the table is what somebody copies
    // from when they set a deployment up.
    const vercel = runbook.slice(
      runbook.indexOf('**Vercel — the console and the public pages'),
      runbook.indexOf('**Render — the worker'),
    );
    expect(vercel.length).toBeGreaterThan(200);
    expect(vercel).toContain('VIBEFYCODE_BADGE_PUBLIC_KEYS');
  });
});

/**
 * The route, which is the only thing a stranger actually gets.
 *
 * Loaded through a specifier TypeScript does not follow, like the badge route
 * is elsewhere: `apps/web` resolves `next/server` and the `@` alias and the
 * workspace root resolves neither, so a literal import fails the root typecheck
 * on a file `apps/web` already checks correctly.
 */
interface KeyRoute {
  GET(): Promise<{ status: number; headers: Headers; json(): Promise<unknown> }>;
}

async function loadKeyRoute(): Promise<KeyRoute> {
  const here = '../apps/web/app/.well-known/vibefycode-badge-key/route.ts';
  return (await import(/* @vite-ignore */ here)) as KeyRoute;
}

describe('what the published address answers', () => {
  const before = {
    published: process.env.VIBEFYCODE_BADGE_PUBLIC_KEYS,
    retired: process.env.VIBEFYCODE_BADGE_RETIRED_KEYS,
    signing: process.env.VIBEFYCODE_BADGE_SIGNING_KEY_B64,
    kid: process.env.VIBEFYCODE_BADGE_KEY_ID,
  };

  const restore = () => {
    for (const [name, value] of [
      ['VIBEFYCODE_BADGE_PUBLIC_KEYS', before.published],
      ['VIBEFYCODE_BADGE_RETIRED_KEYS', before.retired],
      ['VIBEFYCODE_BADGE_SIGNING_KEY_B64', before.signing],
      ['VIBEFYCODE_BADGE_KEY_ID', before.kid],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };

  afterAll(restore);

  it('refuses rather than serving an empty set, when nothing is published', async () => {
    const { key, privateKeyB64 } = aSigningKey('k-route-none');
    // The documented Render-only deployment, exactly: the signing pair present
    // and no public list. This is what the live console had.
    delete process.env.VIBEFYCODE_BADGE_PUBLIC_KEYS;
    delete process.env.VIBEFYCODE_BADGE_RETIRED_KEYS;
    process.env.VIBEFYCODE_BADGE_SIGNING_KEY_B64 = privateKeyB64;
    process.env.VIBEFYCODE_BADGE_KEY_ID = key.kid;

    const response = await (await loadKeyRoute()).GET();
    expect(response.status).toBe(503);
    // Not cached, because an hour of a wrong answer is an hour of every badge
    // reading as forged after somebody has already fixed it.
    expect(response.headers.get('cache-control')).toMatch(/no-store/);
  });

  it('serves the key a stranger needs, from the public variable alone', async () => {
    const { key } = aSigningKey('k-route-one');
    delete process.env.VIBEFYCODE_BADGE_SIGNING_KEY_B64;
    delete process.env.VIBEFYCODE_BADGE_KEY_ID;
    process.env.VIBEFYCODE_BADGE_PUBLIC_KEYS = JSON.stringify([key.jwk]);

    const response = await (await loadKeyRoute()).GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { keys: { kid: string; x: string; d?: string }[] };
    expect(body.keys.map((published) => published.kid)).toEqual(['k-route-one']);
    expect(body.keys[0]!.d).toBeUndefined();
    // Anybody may fetch it. That is the point of publishing it.
    expect(response.headers.get('access-control-allow-origin')).toBe('*');

    // And it is the key that checks a badge, not merely a key-shaped object.
    const signed = signBadge(payloadFor('k-route-one'), key);
    expect(
      verifyBadge(signed, { keys: body.keys as never }, { now: new Date('2026-11-01') })
        .signatureValid,
    ).toBe(true);
  });
});

describe('both variables, read together', () => {
  it('publishes the active key first and the retired ones after it', () => {
    const active = aSigningKey('k-active').key;
    const old = aSigningKey('k-old').key;
    const { keys } = loadPublishedKeys({
      VIBEFYCODE_BADGE_PUBLIC_KEYS: JSON.stringify([active.jwk]),
      VIBEFYCODE_BADGE_RETIRED_KEYS: JSON.stringify([old.jwk]),
    } as NodeJS.ProcessEnv);
    expect(keys.map((key) => key.kid)).toEqual(['k-active', 'k-old']);
  });

  it('does not publish a key twice when it is named in both', () => {
    const active = aSigningKey('k-both').key;
    const { keys } = loadPublishedKeys({
      VIBEFYCODE_BADGE_PUBLIC_KEYS: JSON.stringify([active.jwk]),
      VIBEFYCODE_BADGE_RETIRED_KEYS: JSON.stringify([active.jwk]),
    } as NodeJS.ProcessEnv);
    expect(keys.map((key) => key.kid)).toEqual(['k-both']);
  });

  it('strips a private half pasted into either of them, and says which', () => {
    // The new variable is the one people will paste into, and the natural thing
    // to paste is the JWK you have — which for a key you generated yourself has
    // `d` in it. `tests/the-private-half-we-nearly-published.test.ts` is the
    // whole story; this is that it covers the new door as well.
    const active = aSigningKey('k-leaky').key;
    const { keys, carriedPrivate } = loadPublishedKeys({
      VIBEFYCODE_BADGE_PUBLIC_KEYS: JSON.stringify([{ ...active.jwk, d: 'PRIVATE-SCALAR' }]),
    } as NodeJS.ProcessEnv);
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toHaveProperty('d');
    expect(carriedPrivate).toEqual(['k-leaky']);
  });

  it('refuses to answer at all when one of them is not JSON', () => {
    // Rather than publishing a partial set, which would fail exactly the badges
    // signed by whichever key was in the broken half.
    expect(() =>
      loadPublishedKeys({ VIBEFYCODE_BADGE_PUBLIC_KEYS: '{not json' } as NodeJS.ProcessEnv),
    ).toThrow(/VIBEFYCODE_BADGE_PUBLIC_KEYS is not valid JSON/);
  });
});
