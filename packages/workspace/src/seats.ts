/**
 * Seats, as the console explains them.
 *
 * The database is what *enforces* the limit — a trigger on both memberships and
 * invitations, so the SSO path cannot bypass it either. This module exists only
 * so that the message a human reads says the same thing the trigger decided.
 */
export interface SeatUsage {
  readonly seats: number;
  readonly members: number;
  readonly pendingInvitations: number;
}

export interface SeatVerdict {
  readonly used: number;
  readonly remaining: number;
  readonly canInvite: boolean;
  readonly explanation: string;
}

export function seatVerdict(usage: SeatUsage): SeatVerdict {
  const used = usage.members + usage.pendingInvitations;
  const remaining = Math.max(0, usage.seats - used);
  const pending =
    usage.pendingInvitations > 0
      ? `, including ${usage.pendingInvitations} invitation${usage.pendingInvitations === 1 ? '' : 's'} not yet accepted`
      : '';
  return {
    used,
    remaining,
    canInvite: remaining > 0,
    explanation:
      remaining > 0
        ? `${used} of ${usage.seats} seat${usage.seats === 1 ? '' : 's'} in use${pending}. ${remaining} free.`
        : `All ${usage.seats} seat${usage.seats === 1 ? '' : 's'} are in use${pending}. Add seats on the billing page, or withdraw an invitation, before inviting anyone else.`,
  };
}
