/**
 * The outage is worth reporting. The pageview rate is not.
 *
 * Once the badge can be served from Supabase's API while `SUPABASE_DB_URL` is
 * wrong, that state can hold for days — and both new log lines sit on the
 * hottest path in the product, the badge image embedded on every customer's
 * website. A line per impression would bury the one line that matters under
 * the traffic it is measuring.
 *
 * The worker already had this lesson written down, beside `announceSpendPause`:
 * a condition checked every few seconds and reported every time was
 * "seventeen thousand identical lines a day — and the lift, which is the line
 * somebody is actually waiting for, would have arrived indistinguishable from
 * all of them".
 *
 * Keyed on the failure, not on the badge, which is the part worth a test: a key
 * carrying a badge id or a timestamp never repeats, so the guard would hold its
 * tongue about nothing and say everything.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { forgetWhatWasSaid, sayItAgain } from '../apps/web/lib/said-recently.ts';
import { withoutComments } from './setup/source.ts';

beforeEach(() => {
  forgetWhatWasSaid();
});

describe('saying it once', () => {
  it('says it the first time', () => {
    expect(sayItAgain('refused:ENOTFOUND')).toBe(true);
  });

  it('holds its tongue for a minute after that', () => {
    const start = 1_000_000;
    expect(sayItAgain('refused:ENOTFOUND', start)).toBe(true);
    expect(sayItAgain('refused:ENOTFOUND', start + 1)).toBe(false);
    expect(sayItAgain('refused:ENOTFOUND', start + 59_999)).toBe(false);
    expect(sayItAgain('refused:ENOTFOUND', start + 60_000)).toBe(true);
  });

  it('says a different failure at once rather than waiting its turn', () => {
    // The failure changing is news. A password error following an ENOTFOUND
    // means somebody changed something, and that is the line being waited for.
    const start = 1_000_000;
    expect(sayItAgain('refused:ENOTFOUND', start)).toBe(true);
    expect(sayItAgain('refused:password authentication failed', start + 1)).toBe(true);
  });

  it('keeps nothing across a reset, so a test cannot inherit another’s silence', () => {
    expect(sayItAgain('refused:ENOTFOUND')).toBe(true);
    forgetWhatWasSaid();
    expect(sayItAgain('refused:ENOTFOUND')).toBe(true);
  });
});

describe('where it is used', () => {
  const sql = withoutComments(readFileSync('apps/web/lib/sql.ts', 'utf8'));
  const lookup = withoutComments(readFileSync('apps/web/lib/badge-verification.ts', 'utf8'));

  it('guards the connection refusal', () => {
    expect(sql).toMatch(/sayItAgain\(`refused:\$\{detail\}`\)/);
  });

  it('guards the fallback notice', () => {
    expect(lookup).toMatch(/sayItAgain\(`fallback:\$\{detail\}`\)/);
  });

  it('keys both on the failure rather than on the badge', () => {
    // `publicId` is still *in* the line — it is useful — but it must not be in
    // the key, or every impression is a new key and the guard does nothing.
    const fallback = lookup.slice(lookup.indexOf('sayItAgain'));
    const key = fallback.slice(
      fallback.indexOf('`'),
      fallback.indexOf('`', fallback.indexOf('`') + 1),
    );
    expect(key).not.toMatch(/publicId/);
    expect(lookup).toMatch(/publicId,/);
  });
});
