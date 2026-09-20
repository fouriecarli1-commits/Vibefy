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
