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

/**
 * Which threshold produced this action.
 *
 * Separate from the reason text, which carries today's figure and is therefore
 * different every time it is computed. A caller that wants to say a thing once
 * rather than every five minutes needs something stable to compare, and a
 * dollar amount that moves is not it.
 */
export type SpendTrigger = 'daily_ceiling' | 'daily_warning' | 'free_tier_weekly';

export interface SpendAction {
  readonly kind: SpendActionKind;
  readonly trigger: SpendTrigger;
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
      trigger: 'daily_ceiling',
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
      trigger: 'daily_warning',
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
      trigger: 'free_tier_weekly',
      reason: `Free-tier spend this week is $${observation.freeTierThisWeekUsd.toFixed(2)}, past the $${ceilings.freeTierWeeklyAlertUsd.toFixed(2)} budget. Free assessments keep running; this is a number to look at, not a fault.`,
      observedUsd: observation.freeTierThisWeekUsd,
      ceilingUsd: ceilings.freeTierWeeklyAlertUsd,
    });
  }

  return actions;
}

/**
 * What the free tier can cost one account, from the plan's own shape.
 *
 * `freeTierPerAccountMonthlyUsd` is a figure and nothing else: nothing in
 * `evaluateSpend`, in a migration, or on the enqueue path reads it. What
 * actually limits a free account is three numbers in its entitlement — how many
 * applications it may hold, how long it must wait between assessments of one,
 * and the per-run cost ceiling the engine enforces before every model call.
 *
 * Both answers are here because they differ, and the difference is the finding.
 * A new account can assess all three of its applications on the day it signs
 * up; the cooldown only starts biting afterwards.
 */
export interface FreeTierShape {
  readonly maxApps: number;
  /** Null where the plan sets none, which is the same as not waiting at all. */
  readonly cooldownDays: number | null;
  readonly maxRunCostUsd: number;
}

/** Every application assessed at once, which is what a new account can do. */
export function freeTierFirstMonthUsd(shape: FreeTierShape): number {
  return shape.maxApps * shape.maxRunCostUsd;
}

/** The same once the cooldown is running, which is every month after the first. */
export function freeTierSteadyMonthUsd(shape: FreeTierShape): number {
  if (shape.cooldownDays === null || shape.cooldownDays <= 0) {
    return freeTierFirstMonthUsd(shape);
  }
  return shape.maxApps * shape.maxRunCostUsd * (30 / shape.cooldownDays);
}

export interface PublishedCeiling {
  readonly label: string;
  readonly valueUsd: number;
  /**
   * What applies this figure. Never empty, and that is the point: a number with
   * nothing applying it is not a ceiling, and the cost dashboard laid all three
   * out identically with no way to tell which was which.
   */
  readonly appliedBy: string;
}

/**
 * The three ceilings PART 9 asks for, each with what applies it.
 *
 * Here rather than in the page, so that what the dashboard says about them is
 * something a test can read.
 */
export function publishedCeilings(
  freeTier: FreeTierShape,
  ceilings: SpendCeilings = CEILINGS,
): PublishedCeiling[] {
  const money = (value: number) => `$${value.toFixed(2)}`;
  return [
    {
      label: 'Global daily spend',
      valueUsd: ceilings.globalDailyUsd,
      appliedBy:
        'Applied automatically. Crossing it writes a row to spend_pauses, and the worker claims no new work while a pause is live. Lifting one is deliberate and needs a person.',
    },
    {
      label: 'Free-tier weekly budget',
      valueUsd: ceilings.freeTierWeeklyAlertUsd,
      appliedBy:
        'Applied as an alert, deliberately not as a pause: the free tier is a marketing cost, and stopping it silently would look to a prospective customer like a broken product.',
    },
    {
      label: 'Free tier, per account per month',
      valueUsd: ceilings.freeTierPerAccountMonthlyUsd,
      appliedBy:
        `Nothing applies it. What limits a free account is its plan: ${freeTier.maxApps} applications, ` +
        `one assessment each per ${freeTier.cooldownDays ?? 0} days, ${money(freeTier.maxRunCostUsd)} a run. ` +
        `That is ${money(freeTierSteadyMonthUsd(freeTier))} a month once the cooldown is running and ` +
        `${money(freeTierFirstMonthUsd(freeTier))} in the first month, when all three can be assessed at once — ` +
        `so this figure is right from month two and exceeded in month one. Whether to enforce it, raise it, ` +
        `or lower the application limit is in docs/OPEN_ITEMS.md.`,
    },
  ];
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
