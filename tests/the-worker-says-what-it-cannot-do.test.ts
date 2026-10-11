/**
 * Everything the worker cannot do, said at startup rather than discovered later.
 *
 * A healthy worker is silent: it polls every five seconds and prints nothing
 * while the queue is empty. That is the right design and it has a consequence —
 * the only moment it can tell anybody what it is missing is the moment it
 * starts, because after that silence means both "fine" and "broken".
 *
 * It already did this for two settings. Without `RESEND_API_KEY` and
 * `ALERT_EMAIL_FROM` it says email is not configured; without `ANTHROPIC_API_KEY`
 * it says every submission will wait for a reviewer. Both name the variable, both
 * say what the effect is, and both arrive before anything has gone wrong.
 *
 * The third said nothing. The announcement email that tells a customer their
 * badge exists is built against `NEXT_PUBLIC_VERIFY_URL ?? NEXT_PUBLIC_SITE_URL`,
 * and `badgeEmbedSnippet` refuses a non-HTTPS origin — correctly, since a badge
 * snippet on somebody's website cannot be a relative path. So a worker with that
 * variable unset, or set to a bare `vibefycode.com` with no scheme, starts
 * cleanly, runs cleanly, issues the badge, and then skips the announcement with
 * one line per badge. The owner is never told the badge they paid for exists,
 * and the first anybody hears of it is the customer asking.
 *
 * The bare-host case is the one that will actually happen. `originFrom` in
 * `apps/web` repairs a host with no scheme, and that repair does not reach here —
 * the worker has no request to infer anything from, which is exactly why it needs
 * to be told. Found while writing the deployment instructions for it.
 *
 * One rule, two readers: `announcementOrigin` decides it, `announceIssuedBadge`
 * acts on it and `startupWarnings` reports it. Two copies of "is this origin
 * usable" would disagree within a release, and the copy that disagreed silently
 * would be this one.
 *
 * ## The fourth, and what this file's own fixture was saying
 *
 * There was no warning about the badge signing key, which is the one whose
 * absence means no badge can be issued at all — not late, not unannounced, not
 * issued. `CONFIGURED` below was this file's picture of a properly configured
 * worker and it did not have the key in it, so "is silent once it is set
 * properly" was asserting that a worker which cannot issue a single badge has
 * nothing to say. A fixture named for a correct deployment is a claim about
 * what a correct deployment is.
 *
 * The key is loaded rather than looked for, so a truncated paste is reported at
 * start-up instead of throwing on the first sweep that finds a candidate, where
 * it is a line in a catch block every thirty seconds with the customer waiting.
 */
import { describe, expect, it } from 'vitest';
import { announcementOrigin } from '../apps/worker/src/badge.ts';
import { startupWarnings } from '../apps/worker/src/main.ts';
import { generateSigningKey } from '../packages/badge/src/keys.ts';

/** A real key, because the check parses it rather than noting it is set. */
const generated = generateSigningKey('startup-warnings-key');

const CONFIGURED: Record<string, string> = {
  SUPABASE_DB_URL: 'postgresql://localhost/x',
  ANTHROPIC_API_KEY: 'sk-ant-test',
  RESEND_API_KEY: 're_test',
  ALERT_EMAIL_FROM: 'VibefyCode <alerts@vibefycode.com>',
  NEXT_PUBLIC_SITE_URL: 'https://vibefycode.com',
  VIBEFYCODE_BADGE_SIGNING_KEY_B64: generated.privateKeyB64,
  VIBEFYCODE_BADGE_KEY_ID: generated.kid,
};

const warn = (env: Record<string, string | undefined>) =>
  startupWarnings(env).map((entry) => entry.message);

describe('the verification origin', () => {
  it('is reported at startup when it is missing', () => {
    const { NEXT_PUBLIC_SITE_URL: _unset, ...without } = CONFIGURED;
    expect(warn(without).join(' ')).toMatch(/badge/i);
  });

  it('is reported when it carries no scheme, which is what a person writes', () => {
    // The exact shape that was put on the deployment: a host, no https://.
    const bare = warn({ ...CONFIGURED, NEXT_PUBLIC_SITE_URL: 'vibefycode.com' });
    expect(bare.join(' ')).toMatch(/badge/i);
  });

  it('names the variable and says what the customer loses', () => {
    const { NEXT_PUBLIC_SITE_URL: _unset, ...without } = CONFIGURED;
    const entry = startupWarnings(without).find((w) => /badge/i.test(w.message));
    expect(String(entry?.detail['needs'])).toContain('NEXT_PUBLIC_SITE_URL');
    // Not merely "not configured". What stops happening, in the customer's terms.
    expect(String(entry?.detail['effect'])).toMatch(/never|not told|no email/i);
  });

  it('is silent once it is set properly', () => {
    expect(warn(CONFIGURED)).toEqual([]);
  });
});

describe('the rule about what origin is usable', () => {
  it('lives in one place, so the two readers cannot disagree', () => {
    expect(announcementOrigin({ NEXT_PUBLIC_SITE_URL: 'https://vibefycode.com' })).toBe(
      'https://vibefycode.com',
    );
    expect(announcementOrigin({ NEXT_PUBLIC_SITE_URL: 'https://vibefycode.com/' })).toBe(
      'https://vibefycode.com',
    );
    expect(announcementOrigin({ NEXT_PUBLIC_SITE_URL: 'vibefycode.com' })).toBeNull();
    expect(announcementOrigin({ NEXT_PUBLIC_SITE_URL: 'http://vibefycode.com' })).toBeNull();
    expect(announcementOrigin({})).toBeNull();
  });

  it('still prefers an explicitly configured verification host', () => {
    expect(
      announcementOrigin({
        NEXT_PUBLIC_VERIFY_URL: 'https://verify.vibefycode.com',
        NEXT_PUBLIC_SITE_URL: 'https://vibefycode.com',
      }),
    ).toBe('https://verify.vibefycode.com');
  });
});

describe('the two warnings that already existed', () => {
  it('still reports email', () => {
    const { RESEND_API_KEY: _key, ...without } = CONFIGURED;
    expect(warn(without).join(' ')).toMatch(/email not configured/);
  });

  it('still reports a missing model key', () => {
    const { ANTHROPIC_API_KEY: _key, ...without } = CONFIGURED;
    expect(warn(without).join(' ')).toMatch(/no model key/);
  });

  it('reports all of them at once rather than the first one only', () => {
    // A deployment that is missing everything should learn everything in one
    // read of the log, not one restart at a time. Four today;
    // `tests/the-lines-he-is-told-to-look-for.test.ts` is what holds the count
    // equal to the list the founder is told to search for.
    expect(warn({ SUPABASE_DB_URL: 'postgresql://localhost/x' })).toHaveLength(4);
  });
});

describe('the badge signing key', () => {
  it('is reported when it is missing, which is the worker issuing nothing at all', () => {
    const {
      VIBEFYCODE_BADGE_SIGNING_KEY_B64: _key,
      VIBEFYCODE_BADGE_KEY_ID: _kid,
      ...without
    } = CONFIGURED;
    expect(warn(without)).toEqual([
      'no badge signing key — no customer can be issued a badge, however many pass',
    ]);
  });

  it('is reported when the key id is set and the key is not, which is half a paste', () => {
    const { VIBEFYCODE_BADGE_SIGNING_KEY_B64: _key, ...without } = CONFIGURED;
    expect(warn(without).join(' ')).toMatch(/no badge signing key/);
  });

  it('says what it needs and what the customer loses', () => {
    const {
      VIBEFYCODE_BADGE_SIGNING_KEY_B64: _key,
      VIBEFYCODE_BADGE_KEY_ID: _kid,
      ...without
    } = CONFIGURED;
    const entry = startupWarnings(without).find((w) => /badge signing key/.test(w.message));
    expect(String(entry?.detail['needs'])).toContain('VIBEFYCODE_BADGE_SIGNING_KEY_B64');
    // Both ends of it: nothing issued here, and nothing verifiable there.
    expect(String(entry?.detail['effect'])).toMatch(/returns zero/);
    expect(String(entry?.detail['effect'])).toMatch(/empty key set|nothing verifies/);
    // And where to go, because "set this variable" is not the whole job.
    expect(String(entry?.detail['fix'])).toContain('DOEN.md');
  });

  it('distinguishes a key that cannot be read from one that is not there', () => {
    // A truncated paste is the case that will happen, and it is a different
    // instruction: not "set this" but "what you set is not a key".
    const truncated = warn({ ...CONFIGURED, VIBEFYCODE_BADGE_SIGNING_KEY_B64: 'not-a-key' });
    expect(truncated).toHaveLength(1);
    expect(truncated[0]).toMatch(/cannot be read/);
    expect(truncated[0]).not.toMatch(/^no badge signing key/);
  });

  it('is silent when the key actually parses', () => {
    expect(warn(CONFIGURED)).toEqual([]);
  });
});
