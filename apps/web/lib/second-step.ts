/**
 * Whether a password was enough.
 *
 * Its own module, and a pure function over two strings, because the mistake it
 * exists to prevent is invisible in a browser: `signInWithPassword` succeeds
 * against an account with an authenticator app enrolled and returns a session
 * at assurance level one. Navigating on that success lets a password alone
 * reach the console of an account whose owner believes they have turned that
 * off — the setting page would say "enrolled" and nothing would ever ask.
 *
 * Nothing here talks to Supabase, so every case can be exercised, including the
 * one that matters and the ones that only happen when something is wrong.
 */

/** What Supabase reports for a session. Either may be null on an odd response. */
export interface AssuranceLevels {
  readonly currentLevel: string | null;
  readonly nextLevel: string | null;
}

export type SecondStepDecision =
  | { readonly kind: 'continue' }
  | { readonly kind: 'second_step' }
  | { readonly kind: 'refuse'; readonly because: string };

/**
 * `refuse` is a real outcome and not an error path.
 *
 * Where we cannot tell what this account requires, the session in the browser
 * may be one step short of it. Continuing would be a guess in the customer's
 * favour on exactly the question they asked us to be strict about, so the
 * caller signs out and says so. A lookup we could not complete is not a pass.
 */
export function decideSecondStep(assurance: AssuranceLevels | null): SecondStepDecision {
  if (assurance === null || assurance.nextLevel === null) {
    return {
      kind: 'refuse',
      because:
        'We could not check whether this account needs a second step, so the session was ended rather than trusted.',
    };
  }
  if (assurance.nextLevel !== 'aal2') return { kind: 'continue' };
  return assurance.currentLevel === 'aal2' ? { kind: 'continue' } : { kind: 'second_step' };
}
