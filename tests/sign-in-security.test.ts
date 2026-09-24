/**
 * Getting in, and getting back in.
 *
 * Four things were missing from the sign-in surface at once, and they are the
 * same omission wearing four hats: every route was built for somebody arriving
 * for the first time.
 *
 *   · The landing page offered three buttons, none of them "Sign in".
 *   · There was no password reset at all. The first person it locked out was
 *     the owner of this product, out of his own account.
 *   · A password field with a twelve-character minimum and no way to see what
 *     had been typed, on a form with no second field to catch the typo.
 *   · No second step available to accounts that can issue a badge, invite a
 *     colleague or read a client's findings.
 *
 * The tests that matter most here are the last group. Enrolling an
 * authenticator app is the visible half and enforces nothing on its own:
 * `signInWithPassword` succeeds against an enrolled account and hands back a
 * session at assurance level one. A settings page that says "enrolled" over a
 * sign-in that never asks is worse than no second step, because the owner
 * stops worrying.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decideSecondStep } from '../apps/web/lib/second-step.ts';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('a returning customer', () => {
  it('is offered a way in from the landing page, as a button rather than a footnote', () => {
    /*
     * A line of muted text under the row was not a fix, and Anré said so.
     *
     * On a phone `.nav-panel` is `display: none` until the hamburger is opened,
     * and the navigation's "Sign in" lives inside it — so a returning customer
     * arriving on a phone had no visible way in anywhere on this page. A small
     * grey sentence under three chunky buttons is not one either, which is why
     * this asserts the styling and not merely the href.
     */
    const page = read('apps/web/app/page.tsx');
    const hero = page.slice(
      page.indexOf('<div className="flex flex-wrap justify-center gap-3">'),
      page.indexOf('<InShort'),
    );
    expect(hero).toContain('href="/sign-in"');
    // The same button treatment the other three carry, so it reads as one.
    expect(hero).toMatch(
      /href="\/sign-in"\s*\n?\s*className="rounded-lg border border-line-strong px-5 py-3 font-medium"/,
    );
    // Beside the other account action rather than at the end of the row.
    expect(hero.indexOf('/sign-in')).toBeLessThan(hero.indexOf('/how-it-works'));
  });

  it('does not rely on the navigation, which a phone hides until it is opened', () => {
    // The root cause, held so it cannot come back as "it is in the nav".
    const css = read('apps/web/app/globals.css');
    expect(css).toMatch(
      /@media \(max-width: 62rem\)[\s\S]{0,200}\.nav-panel\s*\{[\s\S]{0,80}display: none/,
    );
    const nav = read('apps/web/components/site-nav.tsx');
    // The nav's own sign-in is inside the panel, which is the thing that hides.
    expect(nav).toMatch(/nav-panel[\s\S]*href="\/sign-in"/);
  });

  it('is offered a reset before being offered a second account', () => {
    const page = read('apps/web/app/sign-in/page.tsx');
    expect(page).toContain('href="/forgot-password"');
    // Order matters: somebody locked out does not want a new account, because
    // the organisation and the assessments are attached to the old one.
    expect(page.indexOf('/forgot-password')).toBeLessThan(page.indexOf('/sign-up'));
  });

  it('is never told whether an address has an account', () => {
    /*
     * A form that says "no account with that address" is a way for anybody to
     * enumerate our customers, one address at a time, without signing in. The
     * component therefore does not branch on the result at all.
     */
    const form = read('apps/web/components/forgot-password-form.tsx');
    expect(form).toMatch(/If that address has an account/);
    expect(form).not.toMatch(/if \(error\)/);
    expect(form).not.toMatch(/setStatus\(\s*\{\s*kind: 'error'/);
  });

  it('cannot reach the new-password page without following the link', () => {
    const page = read('apps/web/app/auth/new-password/page.tsx');
    expect(page).toContain("redirect('/forgot-password')");
    expect(page).toContain('getUser()');
  });
});

describe('seeing what you typed', () => {
  it.each([
    ['apps/web/components/auth-form.tsx', 'password'],
    ['apps/web/components/new-password-form.tsx', 'new-password'],
  ])('%s can reveal the password it is asking for', (path, id) => {
    const source = read(path);
    expect(source).toMatch(/type=\{revealed \? 'text' : 'password'\}/);
    expect(source).toContain(`aria-controls="${id}"`);
    // A button that says what it will do next, not a checkbox whose state a
    // screen reader has to work out.
    expect(source).toMatch(/\{revealed \? 'Hide' : 'Show'\}/);
    expect(source).toContain('<span className="sr-only"> password</span>');
  });

  it('says out loud when the password is on screen', () => {
    for (const path of [
      'apps/web/components/auth-form.tsx',
      'apps/web/components/new-password-form.tsx',
    ]) {
      expect(read(path)).toMatch(/Your password is visible on screen/);
    }
  });
});

describe('a second step that is actually enforced', () => {
  it('sends an account that needs one to the code, not to the console', () => {
    // The defect this exists for. A session at aal1 on an account whose next
    // level is aal2 has had its password accepted and nothing else.
    expect(decideSecondStep({ currentLevel: 'aal1', nextLevel: 'aal2' })).toEqual({
      kind: 'second_step',
    });
  });

  it('lets an account with no second step straight through', () => {
    expect(decideSecondStep({ currentLevel: 'aal1', nextLevel: 'aal1' })).toEqual({
      kind: 'continue',
    });
  });

  it('lets a session that already answered the code through', () => {
    expect(decideSecondStep({ currentLevel: 'aal2', nextLevel: 'aal2' })).toEqual({
      kind: 'continue',
    });
  });

  it.each([
    null,
    { currentLevel: 'aal1', nextLevel: null },
    { currentLevel: null, nextLevel: null },
  ])('refuses rather than guessing when it cannot tell (%j)', (assurance) => {
    /*
     * A lookup we could not complete is not a pass. Continuing here would be
     * a guess in the customer's favour on precisely the question they asked
     * us to be strict about.
     */
    const decision = decideSecondStep(assurance);
    expect(decision.kind).toBe('refuse');
    expect(decision.kind === 'refuse' && decision.because).toMatch(/could not check/i);
  });

  it('ends the session rather than leaving a half-authorised one in the browser', () => {
    const form = read('apps/web/components/auth-form.tsx');
    expect(form).toMatch(/decision\.kind === 'refuse'[\s\S]{0,200}signOut\(\)/);
  });

  it('does not navigate on a password alone', () => {
    /*
     * The shape of the original bug: `signInWithPassword` succeeding and a
     * `router.push` on the next line. Between them there must be a decision.
     */
    const form = read('apps/web/components/auth-form.tsx');
    const afterPassword = form.slice(form.indexOf('signInWithPassword'));
    const push = afterPassword.indexOf('router.push');
    const decide = afterPassword.indexOf('decideSecondStep');
    expect(decide).toBeGreaterThan(-1);
    expect(decide).toBeLessThan(push);
  });

  it('tells somebody the truth before they lock themselves out', () => {
    // A reset email lands at the second step too, so it does not get anybody
    // past a phone they no longer have. That is said while they are deciding,
    // not in a document afterwards.
    const panel = read('apps/web/components/mfa-panel.tsx');
    expect(panel).toMatch(/Losing the device means losing the account/);
    expect(panel).toMatch(/Enrol two devices/);
    expect(panel).toMatch(/Nothing changes until the code is accepted/);
  });

  it('does not report a failed lookup as having no second step', () => {
    // Rendering "no second step is set up" when the call simply failed would
    // tell somebody who has one that they do not, which is the one answer here
    // that could get them to turn it off.
    const panel = read('apps/web/components/mfa-panel.tsx');
    expect(panel).toMatch(/if \(error\)[\s\S]{0,400}Could not read your current settings/);
    expect(panel).toContain('factors === null');
  });
});

describe('signing up with a provider', () => {
  it('is absent rather than broken where the provider is not enabled', () => {
    /*
     * Still absent rather than broken — a button that redirects to an error
     * teaches people the product is broken. What changed is who is asked.
     *
     * It used to be `NEXT_PUBLIC_GOOGLE_SIGN_IN=on`, which is a second thing
     * that can be wrong, and when it was wrong the page rendered nothing —
     * indistinguishable from the feature never having been built. Anré asked
     * twice where the Google sign-in was. Supabase publishes a boolean per
     * provider, so the source of truth is now the thing that actually decides
     * whether the button can work. See `tests/providers-enabled.test.ts`.
     */
    const gate = read('apps/web/components/provider-sign-in.tsx');
    expect(gate).toContain('enabledProviders()');
    expect(gate).toContain('return null');
    expect(gate).not.toContain('NEXT_PUBLIC_GOOGLE_SIGN_IN');
    // Decided on the server, so it is not a flag in the browser.
    expect(gate).not.toContain("'use client'");
  });

  it('still records which version of the documents was accepted', () => {
    /*
     * The defect this exists for. A password sign-up carries the accepted
     * versions in its metadata because acceptance happens before there is a
     * session; an OAuth sign-up has no such moment, so without this an account
     * created with Google had no consent record at all — and that table is
     * append-only precisely because the record is evidence.
     */
    const callback = read('apps/web/app/auth/callback/route.ts');
    expect(callback).toContain('recordProviderConsents');
    expect(callback).toContain("searchParams.get('accepted')");
  });

  it('checks the claim against what we publish rather than trusting the URL', () => {
    const consent = read('apps/web/lib/consent.ts');
    const fn = consent.slice(consent.indexOf('export async function recordProviderConsents'));
    // Iterates the registry and asks whether each entry was named, never the
    // other way round — so a forged entry cannot introduce a document type,
    // a version or a hash we do not publish.
    expect(fn).toContain('for (const entry of current)');
    expect(fn).toMatch(/declared\.split\('\|'\)\.includes\(/);
    expect(fn).toContain('has_current_consent');
  });

  it('records nothing when somebody is only signing in', () => {
    // Clicking a button under the sentence that says so is the acceptance. A
    // sign-in is not one, so it carries nothing to record.
    const button = read('apps/web/components/provider-button.tsx');
    expect(button).toMatch(/mode === 'sign-up' && accepted/);
    const gate = read('apps/web/components/provider-sign-in.tsx');
    expect(gate).toMatch(/mode === 'sign-up' \? await declaredConsents\(\) : undefined/);
  });

  it('says the same sentence beside the button as beside the password form', () => {
    const gate = read('apps/web/components/provider-sign-in.tsx');
    const form = read('apps/web/components/auth-form.tsx');
    for (const source of [gate, form]) {
      expect(source).toMatch(/records your acceptance of the/);
      expect(source).toMatch(/the version, the timestamp and a\s*\n?\s*hash of the exact wording/);
    }
  });
});
