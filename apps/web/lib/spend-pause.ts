import type { PoolClient } from 'pg';

/**
 * Lifting the stop the platform put on itself.
 *
 * `sweepSpendCap` writes a `spend_pauses` row when the day's spend crosses the
 * global ceiling, and the worker claims no new work while one is live. The
 * table has carried the three columns for the other half since the first
 * migration — `lifted_at`, `lifted_by`, `lift_reason`, with a constraint
 * requiring a reason of real length — and nothing ever wrote them. Its own
 * comment says "lifting one requires a written reason and is kept", and until
 * now the only way to do it was a statement typed against the database by hand,
 * by a founder who says plainly that she does not know where a SQL statement
 * should begin.
 *
 * The pause is automatic and the lift is not, deliberately: `spend.ts` says
 * getting that the wrong way round is how a capped system produces an uncapped
 * bill. So this is a person pressing a button and saying why, and the saying is
 * kept with their name on it.
 *
 * The write is separated from the page so it can be tested against a real
 * database rather than asserted about in prose.
 */

/** The constraint in the schema, in the one place the sentence is written. */
export const SHORTEST_LIFT_REASON = 10;

/**
 * Why a lift will not be accepted, or null.
 *
 * Checked here as well as by the database. `spend_lift_needs_reason` refuses
 * the row, and what Postgres says about a violated check constraint is not a
 * sentence to put in front of somebody who has just stopped a platform outage.
 */
export function whyALiftIsRefused(reason: string): string | null {
  const written = reason.trim();
  if (written.length === 0) {
    return 'Say why spending may start again. It is kept with your name on it, and it is what somebody reads when they ask why the ceiling was lifted that day.';
  }
  if (written.length < SHORTEST_LIFT_REASON) {
    return `That reason is ${written.length} characters. Write at least ${SHORTEST_LIFT_REASON} — the record is read by somebody who was not there.`;
  }
  return null;
}

export interface LiftOutcome {
  /** How many pauses were live. At most one can be, by a unique index. */
  readonly lifted: number;
}

/**
 * Lifts the live pause, if there is one.
 *
 * `where lifted_at is null` rather than by id: the row is found by being the
 * live one, which is the same condition `spending_is_paused()` reads and the
 * same one the unique index enforces. A lift aimed at an id could be aimed at a
 * pause somebody else already lifted, and report success for doing nothing.
 */
export async function liftLivePause(
  client: Pick<PoolClient, 'query'>,
  lift: { userId: string; reason: string },
): Promise<LiftOutcome> {
  const refused = whyALiftIsRefused(lift.reason);
  if (refused) throw new Error(refused);

  const { rowCount } = await client.query(
    `update public.spend_pauses
        set lifted_at = now(), lifted_by = $1, lift_reason = $2
      where lifted_at is null`,
    [lift.userId, lift.reason.trim()],
  );
  return { lifted: rowCount ?? 0 };
}
