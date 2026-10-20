/**
 * Every confirmation link that is not a `code`, answered as though it were one.
 *
 * `/auth/callback` read `?code=` and nothing else. Three shapes arrive there:
 *
 *   · a `code` to exchange;
 *   · a `token_hash` and a `type`, which is what Supabase's newer email
 *     templates send, and which is verified rather than exchanged;
 *   · a refusal — `?error=access_denied&error_code=otp_expired` — with no code
 *     on it at all.
 *
 * The second and third both looked like "no code", so both got the sentence
 * written for the first: "that link had nothing left to exchange — it was
 * probably opened twice, or opened after it expired." Probably. The parameter
 * saying which was on the same URL, and nothing was written to any log, so from
 * the inside a deployment where every confirmation failed looked like a
 * deployment nobody was using.
 *
 * Reported from the product on 2026-10-19: every address tried ended on the
 * sign-in page under that sentence.
 *
 * The three have different answers, which is why telling them apart is the
 * whole point. An expired link needs a new one. A spent link usually was not
 * spent by the person holding it — mail clients and security scanners follow
 * links before anybody clicks, and the token is one-use — so "try again" is
 * advice they cannot act on. And a project on the newer template was never
 * broken at all; this route simply did not read its links.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EMAIL_LINK_TYPES,
  PROVIDER_REFUSALS,
  readSignInLink,
} from '../apps/web/lib/sign-in-link.ts';
import { signInProblem } from '../apps/web/lib/sign-in-problem.ts';
import { commentsBlanked } from './setup/source.ts';

const read = (query: string) => readSignInLink(new URLSearchParams(query));

describe('what a confirmation link is carrying', () => {
  it('reads a code', () => {
    expect(read('code=abc123&next=/console')).toEqual({ kind: 'code', code: 'abc123' });
  });

  it('reads the token hash the newer email templates send', () => {
    expect(read('token_hash=pkce_x&type=signup')).toEqual({ kind: 'email_link', type: 'signup' });
  });

  it('accepts every kind of email link Supabase sends, and nothing else', () => {
    for (const type of EMAIL_LINK_TYPES) {
      expect(read(`token_hash=x&type=${type}`), type).toEqual({ kind: 'email_link', type });
    }
    // `type` comes off the address bar, and verifying one is the call that
    // takes a session out of a token somebody else chose.
    expect(read('token_hash=x&type=phone_change')).toEqual({ kind: 'email_link_unknown_type' });
    expect(read('token_hash=x&type=../admin')).toEqual({ kind: 'email_link_unknown_type' });
  });

  it('reads an expired or already-used link as refused, not as a missing code', () => {
    const spent = read('error=access_denied&error_code=otp_expired&error_description=Email+link');
    expect(spent).toEqual({ kind: 'refused', refusal: 'otp_expired' });
    expect(read('error_code=otp_expired')).toEqual({ kind: 'refused', refusal: 'otp_expired' });
  });

  it('tells a spent link apart from a consent screen somebody closed', () => {
    /*
     * Supabase sends `error=access_denied&error_code=otp_expired` for the
     * first and a bare `error=access_denied` for the second. Read loosely they
     * both say access denied, and the first draft of this matched on that — so
     * somebody who changed their mind at Google was told their confirmation
     * link had expired, which is advice about a thing they were not doing.
     */
    expect(read('error=access_denied')).toEqual({ kind: 'refused', refusal: 'access_denied' });
    expect(read('error=access_denied&error_code=otp_expired')).toEqual({
      kind: 'refused',
      refusal: 'otp_expired',
    });
  });

  it('names the refusals it has a sentence for', () => {
    for (const code of PROVIDER_REFUSALS) {
      expect(read(`error_code=${code}`), code).toEqual({ kind: 'refused', refusal: code });
      // And every one of them reaches a sentence, rather than the neutral one.
      expect(signInProblem(code), code).not.toBe(signInProblem('something-nobody-wrote'));
    }
  });

  it('refuses to carry a code it does not know, which is the whole safety of it', () => {
    // Anybody can send a link with any `error_code` on it. What the page
    // renders has to be one of our sentences, so an unknown code is no code.
    expect(read('error=call+0800+555+now&error_code=ring+this+number')).toEqual({
      kind: 'refused',
      refusal: null,
    });
    // A known `error` beside an invented `error_code` still carries the known
    // half: the signal is real, and only the unrecognised part is dropped.
    expect(read('error=access_denied&error_code=call+0800+555+now')).toEqual({
      kind: 'refused',
      refusal: 'access_denied',
    });
    expect(read('error_code=<script>alert(1)</script>')).toEqual({
      kind: 'refused',
      refusal: null,
    });
  });

  it('reads a refusal before a code, when a link carries both', () => {
    // A URL with both is a link that failed. Answering it as a code sends
    // somebody into an exchange that cannot succeed, and reports the failure as
    // ours rather than as the provider's.
    expect(read('code=abc&error=access_denied&error_code=otp_expired')).toEqual({
      kind: 'refused',
      refusal: 'otp_expired',
    });
  });

  it('still has one shape for a link with nothing on it', () => {
    expect(read('next=/console')).toEqual({ kind: 'nothing' });
    expect(read('token_hash=x')).toEqual({ kind: 'nothing' });
    expect(read('type=signup')).toEqual({ kind: 'nothing' });
  });
});

describe('what the person is told', () => {
  it('has a sentence for a link that was expired or already spent', () => {
    const sentence = signInProblem('otp_expired');
    expect(sentence).toBeTruthy();
    // The part that matters: it says this is often not their doing, because the
    // alternative sends them round the same loop blaming themselves.
    expect(sentence).toMatch(/scanners|before you do|not something you did/i);
    expect(sentence, 'the code itself must never be echoed').not.toContain('otp_expired');
  });

  it('no longer blames a missing code on opening a link twice', () => {
    // That sentence belongs to `otp_expired` now, and saying it here is how a
    // browser mismatch gets diagnosed as carelessness.
    expect(signInProblem('missing_code')).not.toMatch(/opened twice/i);
  });

  it('keeps the sentence for each code distinct', () => {
    const sentences = ['missing_code', 'otp_expired', 'exchange_failed', 'provider_refused'].map(
      (code) => signInProblem(code),
    );
    expect(new Set(sentences).size).toBe(sentences.length);
  });

  it('says something different for a closed consent screen and a spent link', () => {
    // The two the first draft gave one sentence to.
    expect(signInProblem('access_denied')).not.toBe(signInProblem('otp_expired'));
    expect(signInProblem('access_denied')).toMatch(/consent screen|did not finish/i);
  });

  it('says which failures are ours, where they are', () => {
    // A person who cannot sign in has one question: is this me or them. A
    // provider that is switched off, or a failure between us, is not something
    // they can fix by trying harder, and saying so is the difference between
    // five more attempts and one email to us.
    for (const code of ['provider_disabled', 'server_error', 'validation_failed']) {
      expect(signInProblem(code), code).toMatch(/ours to (fix|look at)/i);
    }
  });

  it('tells somebody whose browser lost the other half what to do', () => {
    for (const code of ['bad_oauth_state', 'flow_state_not_found']) {
      expect(signInProblem(code), code).toMatch(/same|one window/i);
      expect(signInProblem(code), code).toMatch(/cookies/i);
    }
  });
});

describe('the route that decides from it', () => {
  const route = commentsBlanked(readFileSync('apps/web/app/auth/callback/route.ts', 'utf8'));

  it('reads the link through the one function that knows the shapes', () => {
    expect(route).toMatch(/readSignInLink\(/);
    // Not by hand beside it: two readings of the same URL is how one of them
    // starts disagreeing with the other.
    expect(route).not.toMatch(/searchParams\.get\('code'\)/);
  });

  it('verifies a token-hash link rather than dropping it', () => {
    expect(route).toMatch(/verifyOtp\(/);
  });

  it('writes down every way a link can fail', () => {
    for (const branch of ['refused', 'email_link_unknown_type', 'nothing']) {
      const at = route.indexOf(`'${branch}'`);
      expect(at, `${branch} is not handled`).toBeGreaterThan(-1);
      // Wide enough to hold the branch. The empty one grew a session check in
      // front of its line, and a window that stops short reads as silence.
      expect(route.slice(at, at + 2000), `${branch} fails silently`).toMatch(/console\.error\(/);
    }
  });

  it('lets somebody who is already signed in through, rather than alarming them', () => {
    /*
     * This address lands in a browser's history and its autocomplete, so it
     * gets opened again — after a sign-in that worked, from a second tab, from
     * the bar. There is nothing on it, and the only answer this route had was
     * the one written for a link that failed, shown to somebody who is signed
     * in and could have been let through. To the person, every one of those
     * looks exactly like the failure they have been fighting.
     *
     * The session cookie is the one source that can tell the two apart, so it
     * is asked before the error is chosen.
     */
    const nothing = route.slice(route.indexOf("'nothing'"));
    const asked = nothing.indexOf('getUser()');
    const refused = nothing.indexOf('missing_code');
    expect(asked, 'the empty callback never asks whether there is a session').toBeGreaterThan(-1);
    expect(asked, 'it decides before it asks').toBeLessThan(refused);
    expect(nothing.slice(0, refused)).toMatch(/if \(user\) return NextResponse\.redirect/);
  });

  it('names the setting that sends every fallback here empty', () => {
    // A Site URL pointing at this path rather than at the origin produces
    // exactly this, for every flow, and it is the one cause on the list that
    // nobody would guess from the symptom.
    const nothing = route.slice(route.indexOf("'nothing'"));
    expect(nothing).toMatch(/Site URL/);
  });

  it('never puts a token or an address in the log', () => {
    // The parameter names are reported; their values are a session. The
    // provider's own message is logged and never rendered.
    const nothing = route.slice(route.indexOf("'nothing'"));
    expect(nothing).toMatch(/searchParams\.keys\(\)/);
    expect(route).not.toMatch(/email:/);
  });

  it('signs in through one path, whichever link it was', () => {
    // Consent records and the door that refuses the console without them hang
    // off this. A second route to a session that skipped it would be an account
    // inside with nothing recording that anybody agreed to anything.
    const calls = route.match(/onceSignedIn\(/g) ?? [];
    expect(calls.length, 'each path records consent its own way').toBeGreaterThanOrEqual(3);
    expect(route).toMatch(/missingConsents\(/);
  });
});
