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
 */
import { describe, expect, it } from 'vitest';
import { announcementOrigin } from '../apps/worker/src/badge.ts';
import { startupWarnings } from '../apps/worker/src/main.ts';

const CONFIGURED: Record<string, string> = {
  SUPABASE_DB_URL: 'postgresql://localhost/x',
  ANTHROPIC_API_KEY: 'sk-ant-test',
  RESEND_API_KEY: 're_test',
  ALERT_EMAIL_FROM: 'VibefyCode <alerts@vibefycode.com>',
  NEXT_PUBLIC_SITE_URL: 'https://vibefycode.com',
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

  it('reports all three at once rather than the first one only', () => {
    // A deployment that is missing everything should learn everything in one
    // read of the log, not one restart at a time.
    expect(warn({ SUPABASE_DB_URL: 'postgresql://localhost/x' })).toHaveLength(3);
  });
});
