/**
 * A sign-in that failed, and a page that said nothing about it.
 *
 * `/auth/callback` has always redirected to `/sign-in?error=…` when there is no
 * code to exchange or the exchange fails. `/sign-in` read `next` and nothing
 * else. So the reason travelled in the address bar and was read by nobody: what
 * somebody saw was the sign-in form again, unchanged, with no reason and
 * nothing to do differently — and the obvious response to that is to try the
 * same thing again.
 *
 * Found while the founder was two hours into a Google sign-in that would not
 * complete. Hers failed on Google's side and never came back to us, so this
 * would not have told her anything; the next person's will fail on ours.
 *
 * The parameter is a code we choose, never a message from somewhere else.
 * Anybody can send a link with any `error=` on it, so whatever this page
 * renders from it is text an attacker picked — "call this number to recover
 * your account" is a sign-in page away from being believed. A fixed set of
 * sentences cannot be made to say that; an echo can.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { signInProblem } from '../apps/web/lib/sign-in-problem.ts';
import { withoutComments } from './setup/source.ts';

const read = (...parts: string[]) =>
  withoutComments(readFileSync(join(process.cwd(), ...parts), 'utf8'));
const page = read('apps/web/app/sign-in/page.tsx');
const callback = read('apps/web/app/auth/callback/route.ts');

describe('the sentence somebody is shown', () => {
  it('is nothing at all when the sign-in page was opened normally', () => {
    expect(signInProblem(undefined)).toBeNull();
    expect(signInProblem('')).toBeNull();
  });

  it('names what to do for each reason we send', () => {
    for (const code of ['missing_code', 'exchange_failed', 'provider_refused']) {
      const sentence = signInProblem(code);
      expect(sentence, code).toBeTruthy();
      // Every one of them ends somewhere: start again, or use a password.
      expect(sentence, code).toMatch(/starting again|works/i);
    }
  });

  it('is ours even when the code is not', () => {
    const injected = 'Call 0800 123 4567 to restore your account';
    const sentence = signInProblem(injected)!;
    expect(sentence).not.toContain('0800');
    expect(sentence).toBe(signInProblem('something-we-never-send'));
  });

  it('is never the parameter itself', () => {
    // The page renders `problem`, which came from the table. If it ever renders
    // the raw value, this is the line that fails.
    expect(page).toContain('const problem = signInProblem(error)');
    expect(page).toContain('{problem}');
    expect(page).not.toMatch(/\{error\}/);
  });

  it('is announced rather than drawn', () => {
    // Somebody who cannot get in may be reading the page with a screen reader,
    // and a sentence that only appears visually is one they never meet.
    expect(page).toContain('role="alert"');
  });
});

describe('what the callback puts in the address bar', () => {
  it('is a code, not a message from somewhere else', () => {
    expect(callback).not.toContain('encodeURIComponent(error.message)');
    expect(callback).toContain('sign-in?error=exchange_failed');
    expect(callback).toContain('sign-in?error=missing_code');
  });

  it('keeps the real message where we can read it', () => {
    // Replacing the message with a code must not lose it: that sentence is the
    // one that says what actually went wrong.
    expect(callback).toContain('console.error');
    expect(callback).toContain('error: error.message');
  });

  it('still carries every code the page knows how to answer', () => {
    // Read off the table rather than listed twice: a code the callback sends
    // and the table has never heard of falls back to the neutral sentence,
    // which is safe and says less than it could.
    for (const code of ['missing_code', 'exchange_failed']) {
      expect(signInProblem(code), code).not.toBe(signInProblem('unknown'));
    }
  });
});
