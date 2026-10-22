import { couldNot } from './what-we-could-not-do.ts';

/**
 * Who is signed in, with "we could not ask" told apart from "nobody".
 *
 * Seventy places in this app did this:
 *
 *     const {
 *       data: { user },
 *     } = await supabase.auth.getUser();
 *     if (!user) redirect('/sign-in');
 *
 * The error was dropped in every one of them. `getUser` reaches the auth
 * service over the network, so a failure there — the service down, a 500 from
 * the token endpoint, a refresh that could not be completed — produced exactly
 * the same `user: null` as a visitor who has never signed in. A customer with a
 * live session was then sent to the sign-in page, which is the page that looks
 * like the problem is theirs, and nothing anywhere recorded that the question
 * had failed.
 *
 * That is not a hypothetical. This product spent days on a sign-in nobody could
 * explain, and the only reason it was eventually explained is that a person sat
 * and read the code; the running system said nothing the whole time, because
 * every surface that could have said something was treating a failed question
 * as a "no".
 *
 * What the caller gets back is unchanged — the user, or null — so this does not
 * decide anything differently. It makes the failure audible, once a minute per
 * message, through the same `couldNot` every other degrading read in this app
 * uses.
 */
/**
 * The shape of the library's own answer, which is a union and has to stay one.
 *
 * Written structurally rather than as `Awaited<ReturnType<typeof createClient>>`
 * so that nothing here pulls `next/headers` into a module the tests compile
 * directly — the first version did, and the root typecheck, which covers
 * `tests/` and `tools/` from outside every workspace package, could not resolve
 * it.
 *
 * The union is the point. A flattened `{ user: U | null; error: E | null }`
 * compiles and will not accept the real client, because flattening it is
 * exactly the step that loses the distinction this function exists to make.
 */
interface AuthFailure {
  readonly name?: string | undefined;
  readonly message?: string | undefined;
  readonly status?: number | undefined;
}

interface AsksWhoIsSignedIn<U> {
  auth: {
    getUser(): Promise<
      { data: { user: U }; error: null } | { data: { user: null }; error: AuthFailure }
    >;
  };
}

/**
 * A signed-out visitor, which is not a failure.
 *
 * `getUser` answers with `AuthSessionMissingError` when there is no session at
 * all, and that is the ordinary case on every public page: saying it out loud
 * would be a line per pageview about nothing being wrong. Matched on the name
 * the library sets, with the message as a fallback for the day it renames the
 * class — in that direction a rename costs one quiet line, where the other
 * direction would cost the one line worth reading.
 */
function nobodyIsSignedIn(error: AuthFailure): boolean {
  if (error.name === 'AuthSessionMissingError') return true;
  return /session|jwt/i.test(error.message ?? '') && /missing|not found/i.test(error.message ?? '');
}

export async function whoIsSignedIn<U>(client: AsksWhoIsSignedIn<U>): Promise<U | null> {
  const { data, error } = await client.auth.getUser();
  if (error && !nobodyIsSignedIn(error)) {
    couldNot(
      'ask the auth service who is signed in',
      {
        // The whole of the consequence, in the words the reader would use: they
        // are treated as signed out, which on most of these pages means being
        // sent to the page that implies their password is the problem.
        shown: 'the signed-out view, and a redirect to sign in on the pages that require one',
        ...(error.status === undefined ? {} : { status: error.status }),
      },
      /*
       * The message rather than the object.
       *
       * `couldNot` falls back to `String(error)` for anything that is not an
       * `Error`, and the auth library's errors are `Error` subclasses today —
       * but the line it writes, and the key it rations by, are both built from
       * that string. A shape it does not recognise would make every fault read
       * as "[object Object]" and, worse, make them all the same fault, so the
       * second one would be held back while the first was still happening.
       */
      error.message,
    );
    return null;
  }
  return data.user ?? null;
}
