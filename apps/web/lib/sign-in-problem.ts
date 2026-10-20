/**
 * Why a sign-in did not complete, in a sentence, for the person it happened to.
 *
 * `/auth/callback` has always redirected to `/sign-in?error=…` when the
 * exchange fails, and `/sign-in` read `next` and nothing else — so the sentence
 * went into the address bar and nowhere else. What somebody saw was the sign-in
 * form again, unchanged, with no reason given and nothing to do differently.
 * That is the shape this codebase keeps finding: a message computed, carried,
 * and read by nobody.
 *
 * The parameter is a code we choose, never a message from somewhere else. Two
 * reasons, and the second is the one that matters:
 *
 *   · a provider's wording is for us and reads as noise to a customer; and
 *   · anybody can send a link with any `error=` on it, so whatever this page
 *     renders from that parameter is text an attacker picked. A fixed set of
 *     sentences cannot be made to say "call this number to recover your
 *     account", and an echo can.
 *
 * So an unrecognised code gets the neutral sentence, and the value itself is
 * never shown.
 */
const PROBLEMS: Readonly<Record<string, string>> = {
  missing_code:
    'That sign-in link arrived with nothing on it to exchange. That usually means it was opened in a different browser from the one that asked for it, or that something along the way shortened the address. Signing in below works.',
  /*
   * One sentence per refusal the provider actually names.
   *
   * The codes are matched against a fixed list in `sign-in-link.ts` before they
   * reach here, so what follows is chosen by a match and never echoed. Each one
   * is here because its answer is different: a spent link needs a new one, a
   * declined consent screen needs nothing but another try, a flow state that
   * has gone needs the sign-in started in the same browser that finishes it,
   * and a provider that is switched off is ours to fix.
   */
  access_denied:
    'You did not finish signing in with that provider — the consent screen was closed or refused. Trying again works, and an email address and a password will get you in either way.',
  bad_oauth_state:
    'The sign-in finished in a different browser or tab from the one that started it, so this deployment could not match the two halves up. Start again in one window, with cookies allowed for this site.',
  flow_state_expired:
    'That sign-in took long enough to expire before it came back. Starting again works.',
  flow_state_not_found:
    'The sign-in finished in a different browser or tab from the one that started it, so this deployment could not match the two halves up. Start again in one window, with cookies allowed for this site.',
  provider_disabled:
    'That way of signing in is switched off for this deployment, so nothing you do on your side will complete it. An email address and a password still work. (This is ours to fix, and it is recorded.)',
  signup_disabled:
    'This deployment is not accepting new accounts through that provider at the moment. An email address and a password still work. (This is ours to fix, and it is recorded.)',
  validation_failed:
    'The provider sent something back that this deployment could not accept. That is ours to look at, and it is recorded. An email address and a password will get you in meanwhile.',
  server_error:
    'Something failed between your provider and us while you were signing in. That is ours to look at, and it is recorded. Trying again often works; an email address and a password will get you in meanwhile.',
  unexpected_failure:
    'Something failed between your provider and us while you were signing in. That is ours to look at, and it is recorded. Trying again often works; an email address and a password will get you in meanwhile.',
  otp_expired:
    'That confirmation link has expired or had already been used. Some mail apps and security scanners open links before you do, which uses them up — so this is often not something you did. Ask for a new one by signing in below; if it keeps happening, an email address and a password will get you in.',
  exchange_failed:
    'Your sign-in could not be completed. Starting again usually works; if it does not, an email address and a password will get you in.',
  provider_refused:
    'Your sign-in provider did not complete the hand-back. Starting again usually works; an email address and a password will get you in meanwhile.',
};

const NEUTRAL =
  'Your sign-in did not complete. Starting again usually works; if it does not, an email address and a password will get you in.';

export function signInProblem(code: string | undefined): string | null {
  if (code === undefined || code.trim() === '') return null;
  return PROBLEMS[code] ?? NEUTRAL;
}
