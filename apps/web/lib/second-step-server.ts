import { createClient } from '@/lib/supabase/server';
import { decideSecondStep } from '@/lib/second-step';

/**
 * Whether this session has answered a second factor, asked on the server.
 *
 * **This is not the enforcement.** The enforcement is a set of restrictive
 * policies in the database, because every write it guards goes through
 * PostgREST with the anon key and a user's access token — anything decided
 * here can be skipped by not using this application.
 *
 * What this is for is the sentence. Without it the database refuses with "new
 * row violates row-level security policy for table reviews", which tells a
 * reviewer nothing about what to do and reads like a fault in the product. So
 * the action asks first and says where to go.
 *
 * The two must not drift, and the thing that keeps them together is that both
 * read the same claim: `session_passed_second_step()` reads `aal` out of
 * `auth.jwt()`, and this reads it out of the access token the same session
 * carries. A test asserts the database refuses what this refuses.
 */
export const SECOND_STEP_REQUIRED =
  'This action needs a second step. Set up an authenticator app under Sign-in security in your console, then try again — enrolling signs you in at the higher level straight away, so there is nothing else to do afterwards.';

export async function sessionPassedSecondStep(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  /*
   * `decideSecondStep`, the same function the sign-in form uses.
   *
   * Not a second reading of the same rule written out again here. Two copies
   * of "what counts as having answered" is how one of them comes to say `aal1`
   * is good enough on a day nobody is looking, and this one is the copy that
   * guards a reviewer approving a badge.
   *
   * `refuse` and `second_step` are both refusals here: the first means we could
   * not read the level, and a level we cannot read has not proved anything. An
   * action that sails past its own check is then refused by Postgres with the
   * unreadable message this exists to avoid.
   */
  return decideSecondStep(error ? null : (data ?? null)).kind === 'continue';
}
