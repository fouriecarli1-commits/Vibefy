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
  link_expired:
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
