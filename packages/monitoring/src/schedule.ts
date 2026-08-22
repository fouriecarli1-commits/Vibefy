/**
 * How often a monitored application is re-assessed and pinged.
 *
 * This is the one module in the package that is allowed to know what someone
 * bought, because cadence is coverage: a paying customer is looked at more
 * often. What is *found* when we look, and what it costs them, is decided by
 * `drift.ts` and `regression.ts`, which cannot see any of this.
 */

export type MonitoredPlan = 'free' | 'one_off' | 'certified' | 'agency' | 'organisation';

export interface MonitoringCadence {
  /** Days between scheduled re-assessments. Null means no scheduled re-assessment. */
  readonly reassessEveryDays: number | null;
  /** Minutes between liveness checks. Null means the application is not pinged. */
  readonly livenessEveryMinutes: number | null;
  /** Consecutive failed liveness checks before the badge is suspended. */
  readonly livenessFailuresBeforeSuspension: number;
}

export const CADENCE: Readonly<Record<MonitoredPlan, MonitoringCadence>> = {
  free: { reassessEveryDays: null, livenessEveryMinutes: null, livenessFailuresBeforeSuspension: 0 },
  // A one-off report is a photograph, not a subscription. It is not monitored,
  // and the badge it earns expires rather than being maintained.
  one_off: {
    reassessEveryDays: null,
    livenessEveryMinutes: null,
    livenessFailuresBeforeSuspension: 0,
  },
  certified: {
    reassessEveryDays: 30,
    livenessEveryMinutes: 60,
    livenessFailuresBeforeSuspension: 6,
  },
  agency: { reassessEveryDays: 30, livenessEveryMinutes: 60, livenessFailuresBeforeSuspension: 6 },
  organisation: {
    reassessEveryDays: 14,
    livenessEveryMinutes: 30,
    livenessFailuresBeforeSuspension: 6,
  },
};

export function cadenceFor(plan: MonitoredPlan): MonitoringCadence {
  const cadence = CADENCE[plan];
  if (!cadence) throw new Error(`No monitoring cadence defined for plan "${plan}".`);
  return cadence;
}

export function isMonitored(plan: MonitoredPlan): boolean {
  return cadenceFor(plan).reassessEveryDays !== null;
}

function addDays(from: Date, days: number): Date {
  const result = new Date(from);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * When the next scheduled re-assessment is due, or null if there is not one.
 *
 * An application that has never been assessed is not "overdue" — it is
 * un-started, and the customer asks for the first run themselves.
 */
export function nextReassessmentDue(
  plan: MonitoredPlan,
  lastAssessedAt: Date | null,
): Date | null {
  const { reassessEveryDays } = cadenceFor(plan);
  if (reassessEveryDays === null || !lastAssessedAt) return null;
  return addDays(lastAssessedAt, reassessEveryDays);
}

export function isReassessmentDue(
  plan: MonitoredPlan,
  lastAssessedAt: Date | null,
  now: Date = new Date(),
): boolean {
  const due = nextReassessmentDue(plan, lastAssessedAt);
  return due !== null && due <= now;
}
