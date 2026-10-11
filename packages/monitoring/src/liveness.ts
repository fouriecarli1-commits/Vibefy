/**
 * Deciding what a failed ping means.
 *
 * A badge on a website that no longer exists is the worst artefact this system
 * can produce: it tells a visitor we checked something that is not there. So an
 * application that stops answering loses its badge — but not on one timeout,
 * because taking a working customer's badge down over a thirty-second blip is
 * its own kind of harm.
 *
 * The check itself is a GET to the certified origin, inside the authorised
 * scope, and nothing else. It is not an assessment.
 */

/**
 * A check ends three ways, not two.
 *
 * `refused` is the one that is easy to lose: we declined to make the request,
 * because the certified origin now resolves somewhere the authorisation does
 * not cover. That is a fact about us, not about the application, and folding it
 * into `down` produces the worst artefact in this system after a badge on a
 * dead site — a suspension notice that tells a customer their application
 * stopped responding when it never stopped.
 */
export type LivenessOutcome = 'up' | 'down' | 'refused';

export interface LivenessProbe {
  readonly status: number | null;
  readonly error?: string | undefined;
  /**
   * Why we did not make the request. Present only for a refusal, and the reason
   * `refused` cannot be silently treated as `down`: a probe that carries one has
   * no status to classify, because nothing was ever sent.
   */
  readonly refusedReason?: string | undefined;
}

/**
 * A response is "up" if it answered at all with something that is not a server
 * error. A 404 counts as up: the origin is serving, and whether a particular
 * path exists is an assessment question, not a liveness one.
 */
export function classifyProbe(probe: LivenessProbe): LivenessOutcome {
  if (probe.refusedReason) return 'refused';
  if (probe.status === null) return 'down';
  if (probe.status >= 500) return 'down';
  return 'up';
}

/**
 * How many applications have to fail together before "all of them" means us.
 *
 * Three. With one or two monitored applications, both being down at once is an
 * ordinary coincidence; with three or more it is not, and the cost of being
 * wrong in the cautious direction is a badge that stays up five minutes longer
 * than it should have.
 */
export const SHARED_CAUSE_MINIMUM = 3;

/**
 * What a whole sweep saw, which is more than any one probe can say.
 *
 * `control` is a probe against an address we control, made through the same
 * guard, dispatcher and fetch as every other. It is the difference between "the
 * customers' sites are not answering" and "this process cannot reach the
 * internet".
 */
export interface SweepEvidence {
  readonly control: LivenessOutcome | null;
  /** One outcome per application checked, in any order. */
  readonly outcomes: readonly LivenessOutcome[];
}

/**
 * Whether this sweep's failures are better explained by us than by them.
 *
 * `applyProbe` is careful about one application at a time: a refusal is not an
 * outage, and a suspension needs a run of consecutive failures. It cannot see
 * the thing that matters most, because it is handed one row at a time — that
 * every application failed in the same sweep, which is not evidence about every
 * application. It is evidence about this process.
 *
 * What that costs if nobody checks: the worker loses outbound HTTPS — a broken
 * egress proxy, a DNS resolver, a certificate bundle — and every probe returns
 * `{ status: null, error: 'fetch failed' }`, which classifies as `down`. Each
 * sweep advances every counter, and after the threshold every monitored
 * customer's badge is suspended within minutes of the others, each with an
 * alert and an email telling them their application stopped responding. It did
 * not. This file's own first paragraph calls a badge on a dead site the worst
 * artefact the system can produce and a false suspension the next worst; that
 * is the next worst, delivered to everybody at once, by us.
 *
 * Two layers, because each covers the other's blind spot. The control catches
 * it on a deployment with one monitored application, where no count would. The
 * floor catches the case where the control host happens to be reachable and the
 * wider internet is not — a proxy allowlist, a partial route — where the
 * control would say everything is fine.
 *
 * Returns the reason rather than a boolean, because this is written into a log
 * line somebody reads at two in the morning, and "inconclusive" on its own
 * would send them looking at the customers' sites.
 */
export function sharedCause(evidence: SweepEvidence): string | null {
  if (evidence.control === 'down') {
    return 'The control address did not answer either, so this process could not reach anything. No counter was advanced and no badge was suspended.';
  }

  const checked = evidence.outcomes.length;
  if (checked >= SHARED_CAUSE_MINIMUM && evidence.outcomes.every((one) => one === 'down')) {
    return `All ${checked} applications checked in this sweep failed together, which is far more likely to be us than all of them. No counter was advanced and no badge was suspended.`;
  }

  return null;
}

export interface LivenessState {
  readonly consecutiveFailures: number;
  readonly badgeStatus: 'active' | 'suspended' | 'expired' | 'revoked' | null;
}

export interface LivenessDecision {
  readonly outcome: LivenessOutcome;
  readonly consecutiveFailures: number;
  readonly suspendBadge: boolean;
  readonly restoreBadge: boolean;
  readonly reason: string | null;
}

/**
 * Applies one probe result to the running state.
 *
 * Restoration is automatic and deliberate: an application that comes back up
 * should not need a support ticket to get its badge back, because the badge was
 * never withdrawn on the merits.
 */
export function applyProbe(
  state: LivenessState,
  probe: LivenessProbe,
  failuresBeforeSuspension: number,
): LivenessDecision {
  const outcome = classifyProbe(probe);

  if (outcome === 'refused') {
    // The counter is evidence about the application, and a refusal is not
    // evidence about the application. It is left exactly where it was: neither
    // advanced towards a suspension the customer has not earned, nor reset,
    // which would quietly forgive a genuine outage that is still going on.
    return {
      outcome,
      consecutiveFailures: state.consecutiveFailures,
      suspendBadge: false,
      restoreBadge: false,
      reason: probe.refusedReason ?? 'The check was not made.',
    };
  }

  if (outcome === 'up') {
    return {
      outcome,
      consecutiveFailures: 0,
      suspendBadge: false,
      // Only a suspension we caused is ours to reverse. A badge suspended for a
      // regression, a lapsed subscription or a licence breach stays down.
      restoreBadge:
        state.badgeStatus === 'suspended' && state.consecutiveFailures >= failuresBeforeSuspension,
      reason: null,
    };
  }

  const consecutiveFailures = state.consecutiveFailures + 1;
  const threshold = Math.max(1, failuresBeforeSuspension);
  const crossed = consecutiveFailures >= threshold;

  return {
    outcome,
    consecutiveFailures,
    suspendBadge: crossed && state.badgeStatus === 'active',
    restoreBadge: false,
    reason: crossed
      ? `The application did not respond to ${consecutiveFailures} consecutive checks${probe.error ? ` (${probe.error})` : probe.status !== null ? ` (last status ${probe.status})` : ''}.`
      : null,
  };
}
