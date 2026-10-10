/**
 * The sentence that calls a customer's real badge a forgery.
 *
 * `/verify` asks `verifyBadge` whether a signature is genuine and renders the
 * answer as "Yes — VibefyCode issued this." or "No.", with the explanation
 * underneath. When no published key matched the badge's key id, that
 * explanation read:
 *
 *     This badge names signing key "k1", which VibefyCode does not publish.
 *     VibefyCode did not issue it.
 *
 * Stated as a fact, and `unknown_key` had two causes. The second is a key set
 * that is empty — the signing variables unset in this deployment, or every
 * retired entry dropped. `loadSigningKey` returns null when they are missing
 * rather than throwing, so the page said "No." and that sentence about a badge
 * we really did issue, because of an environment variable on our side.
 *
 * Nothing logged it, nothing alerted, and a visitor had no way to tell. For a
 * product whose only asset is being believed, telling somebody a real badge is
 * forged over our own misconfiguration is the worst sentence it can emit.
 *
 * The distinction is the one this codebase keeps having to make, in the place
 * it matters most: "we could not look" is not "there is nothing there".
 */
import { describe, expect, it } from 'vitest';
import { canonicalise, signBadge, verifyBadge, toJwk } from '../packages/badge/src/index.ts';
import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { withoutComments } from './setup/source.ts';
import { readFileSync } from 'node:fs';

const key = (() => {
  const { privateKey } = generateKeyPairSync('ed25519');
  return { kid: 'test-key-1', privateKey, jwk: toJwk(createPublicKey(privateKey), 'test-key-1') };
})();

const payload = {
  v: 1,
  kid: key.kid,
  badgeId: 'b1',
  slug: 'an-app',
  appName: 'An App',
  certifiedOrigin: 'https://an-app.example',
  rubricVersion: '1.1.0',
  score: 85,
  assessedOn: '2026-10-01',
  issuedAt: '2026-10-01T00:00:00.000Z',
  expiresAt: '2027-10-01T00:00:00.000Z',
  ownerIsMarketingClient: false,
} as const;

const signed = signBadge(payload as never, key as never);

describe('a genuine badge checked against no keys at all', () => {
  const result = verifyBadge(signed, { keys: [] });

  it('does not say we did not issue it, because we did', () => {
    expect(result.failures).toEqual(['no_published_keys']);
    expect(result.explanation, 'a real badge was called a forgery').not.toMatch(
      /did not issue it/i,
    );
  });

  it('says it is our fault and says so about us', () => {
    expect(result.explanation).toMatch(/fault on our side/i);
    expect(result.explanation).toMatch(/says nothing about the badge/i);
  });

  it('still refuses to call the signature genuine, because it was not checked', () => {
    // The honest answer is neither yes nor no, and the one thing it must not
    // become is yes.
    expect(result.signatureValid).toBe(false);
    expect(result.withinValidity).toBe(false);
  });
});

describe('a badge naming a key we really do not publish', () => {
  const stranger = { ...payload, kid: 'somebody-elses-key' } as const;
  const result = verifyBadge(
    { payload: stranger, signature: signed.signature },
    { keys: [key.jwk] },
  );

  it('still says we did not issue it, which is the case that sentence is for', () => {
    // The positive control. A fix that softened every answer would have taken
    // the real refusal with it.
    expect(result.failures).toEqual(['unknown_key']);
    expect(result.explanation).toMatch(/did not issue it/i);
  });
});

describe('a genuine badge checked against its own key', () => {
  it('verifies, so none of the above is a fix that broke verification', () => {
    const result = verifyBadge(signed, { keys: [key.jwk] });
    expect(result.failures).toEqual([]);
    expect(result.signatureValid).toBe(true);
    expect(canonicalise(payload as never)).toContain('"score":85');
  });

  it('is not called genuine when the bytes were tampered with', () => {
    const tampered = { ...payload, score: 99 } as const;
    const result = verifyBadge(
      { payload: tampered, signature: signed.signature },
      { keys: [key.jwk] },
    );
    expect(result.failures).toContain('bad_signature');
  });
});

describe('what the page does with the third answer', () => {
  const page = withoutComments(readFileSync('apps/web/app/verify/page.tsx', 'utf8'));

  it('renders three answers rather than two', () => {
    expect(page).toMatch(/couldNotCheck/);
    expect(page).toMatch(/We cannot tell you right now/);
  });

  it('does not render it as a refusal', () => {
    // "No." in the same red as a forged badge is the defect, not the wording.
    const verdict = /result\.signatureValid[\s\S]{0,400}?'No\.'/.exec(page);
    expect(verdict, 'the verdict is no longer rendered here').not.toBeNull();
    expect(verdict![0]).toMatch(/couldNotCheck/);
  });

  it('says so in the log, because nothing else in the system can see it', () => {
    expect(page).toMatch(/we publish no signing keys/);
    expect(page).toMatch(/console\.error/);
  });
});
