/**
 * The stop a runaway loop actually hits.
 *
 * PART 9 asks for three ceilings. Two existed: a per-run cap enforced inside the
 * engine before every model call, and a per-account free-tier cap. The third —
 * a global daily cap with automatic pause and alert — is this file, and it is
 * the one that matters most, because the failure it guards against is not one
 * expensive run. It is a thousand cheap ones started by a loop nobody is
 * watching at three in the morning.
 *
 * Pure and thresholds-as-data, so the numbers live in `config/pricing.json` and
 * changing them is a config change rather than a deploy.
 */
import pricing from '../../../config/pricing.json' with { type: 'json' };

export interface SpendCeilings {
  readonly globalDailyUsd: number;
  readonly freeTierWeeklyAlertUsd: number;
  readonly freeTierPerAccountMonthlyUsd: number;
}

export const CEILINGS: SpendCeilings = {
  globalDailyUsd: pricing.ceilings.globalDailySpendUsd,
  freeTierWeeklyAlertUsd: pricing.ceilings.freeTierWeeklyBudgetAlertUsd,
  freeTierPerAccountMonthlyUsd: pricing.ceilings.freeTierPerAccountMonthlyUsd,
};

export interface SpendObservation {
  readonly todayUsd: number;
  readonly freeTierThisWeekUsd: number;
  readonly alreadyPaused: boolean;
}

export type SpendActionKind = 'pause' | 'alert' | 'none';

export interface SpendAction {
  readonly kind: SpendActionKind;
  readonly reason: string;
  readonly observedUsd: number;
  readonly ceilingUsd: number;
}

/**
 * What to do about today's numbers.
 *
 * The pause is automatic and the lift is not. Getting that the wrong way round —
 * an alert that a human has to act on, with spending continuing meanwhile — is
 * how a capped system produces an uncapped bill.
 */
export function evaluateSpend(
  observation: SpendObservation,
  ceilings: SpendCeilings = CEILINGS,
): SpendAction[] {
  const actions: SpendAction[] = [];

  if (!observation.alreadyPaused && observation.todayUsd >= ceilings.globalDailyUsd) {
    actions.push({
      kind: 'pause',
      reason: `Global spend today reached $${observation.todayUsd.toFixed(2)} against a daily ceiling of $${ceilings.globalDailyUsd.toFixed(2)}. No further assessment work starts until this is lifted by a person.`,
      observedUsd: observation.todayUsd,
      ceilingUsd: ceilings.globalDailyUsd,
    });
  }

  // Warned at four fifths, because a stop that arrives with no warning is a stop
  // that arrives in the middle of a customer's assessment.
  const warnAt = ceilings.globalDailyUsd * 0.8;
  if (
    !observation.alreadyPaused &&
    observation.todayUsd >= warnAt &&
    observation.todayUsd < ceilings.globalDailyUsd
  ) {
    actions.push({
      kind: 'alert',
      reason: `Global spend today is $${observation.todayUsd.toFixed(2)}, four fifths of the $${ceilings.globalDailyUsd.toFixed(2)} daily ceiling. Work pauses automatically at the ceiling.`,
      observedUsd: observation.todayUsd,
      ceilingUsd: ceilings.globalDailyUsd,
    });
  }

  if (observation.freeTierThisWeekUsd >= ceilings.freeTierWeeklyAlertUsd) {
    // An alert, not a pause: the free tier is a marketing cost, and stopping it
    // silently would look to a prospective customer like a broken product.
    actions.push({
      kind: 'alert',
      reason: `Free-tier spend this week is $${observation.freeTierThisWeekUsd.toFixed(2)}, past the $${ceilings.freeTierWeeklyAlertUsd.toFixed(2)} budget. Free assessments keep running; this is a number to look at, not a fault.`,
      observedUsd: observation.freeTierThisWeekUsd,
      ceilingUsd: ceilings.freeTierWeeklyAlertUsd,
    });
  }

  return actions;
}

/** Midnight UTC today, and seven days back. One definition, so two callers cannot disagree. */
export function spendWindows(now: Date = new Date()): { dayStart: Date; weekStart: Date } {
  const dayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
  const weekStart = new Date(dayStart);
  weekStart.setUTCDate(weekStart.getUTCDate() - 7);
  return { dayStart, weekStart };
}
