import { couldNot } from './what-we-could-not-do.ts';

/**
 * Which platform role somebody holds, with "we could not ask" kept apart from
 * "none".
 *
 * Six places asked this and every one of them dropped the error:
 *
 *     const { data: profile } = await supabase
 *       .from('users').select('platform_role').eq('id', user.id).single();
 *     if (profile?.platform_role !== 'reviewer') refuse();
 *
 * The refusal is right and stays: a role we cannot read has not been proved,
 * and the one direction that must never happen here is a failed read letting
 * somebody into the review queue. What was wrong is what the person was told.
 * A reviewer whose own row could not be read was shown "this queue is for
 * VibefyCode reviewers" — a sentence about them, when the truth was a sentence
 * about us — and nothing anywhere recorded that the question had failed.
 *
 * It is the same shape as `whoIsSignedIn`, for the same reason and with the
 * same answer: refuse as before, say which refusal it is, and write the failure
 * down once a minute rather than never.
 */
export type PlatformRole = 'reviewer' | 'admin' | 'none' | 'unknown';

/**
 * The answer, not the client.
 *
 * Taking the client meant describing `from('users').select(...).eq(...)`
 * structurally, and TypeScript gave up matching that against the real client's
 * generics: "type instantiation is excessively deep and possibly infinite".
 * Each caller already writes the query — four chained calls, and the part that
 * varies least — so what this takes is what came back, which is also what makes
 * it testable without a database or a client at all.
 */
export interface RoleRead {
  readonly data: { readonly platform_role?: string | null } | null;
  readonly error: { readonly message?: string; readonly code?: string } | null;
}

/**
 * A row that is not there is not a failure.
 *
 * PostgREST answers `single()` with `PGRST116` when no row matched, which under
 * row-level security is also what somebody sees when the row exists and is not
 * theirs. Either way it is an answer: this account holds no platform role.
 * Reporting it would be a line every time a customer opens a page that happens
 * to ask.
 */
function noRow(error: { code?: string }): boolean {
  return error.code === 'PGRST116';
}

export function roleFrom({ data, error }: RoleRead, userId: string): PlatformRole {
  if (error && !noRow(error)) {
    couldNot(
      'read the platform role of somebody asking for a staff page',
      {
        // What they get, said in the words they would use. The refusal is
        // unchanged; it is the sentence attached to it that was wrong.
        shown: 'the refusal, now saying we could not check rather than that they are not staff',
        userId,
      },
      error.message ?? 'no message',
    );
    return 'unknown';
  }
  const role = data?.platform_role;
  return role === 'reviewer' || role === 'admin' ? role : 'none';
}

/** Staff, for the pages that admit both. Never true of `unknown`. */
export function isPlatformStaff(role: PlatformRole): boolean {
  return role === 'reviewer' || role === 'admin';
}

/**
 * The refusal, in the words the reason deserves.
 *
 * Each page keeps its own ordinary sentence — they differ, and they were all
 * right — and the one this adds is the sentence none of them had: that the
 * question failed rather than that the answer was no. One copy of it, so the
 * day it is reworded it is reworded everywhere.
 */
export function whyTheyCannotBeLetIn(
  role: PlatformRole,
  ordinary: string,
  who: 'reviewer' | 'administrator' = 'reviewer',
): string {
  return role === 'unknown'
    ? `We could not check whether you are a VibefyCode ${who}, so this is not being shown. That is our fault rather than anything about your account, it is in our log, and reloading is worth trying.`
    : ordinary;
}
